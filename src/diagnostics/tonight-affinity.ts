import { desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { franchiseExclusions } from "../db/franchises";
import { readCatalogue } from "../db/recommendations";
import { moodSessions, recommendationHistory } from "../db/schema";
import { affinityModels, catalogueFrequency, type TonightAffinityModel } from "../domain/affinity";
import { diagnoseRecommendation, tonightAffinityModel, tonightRanking, type RankingPolicy } from "../domain/recommendation";
import { criteriaSchema, recentSelectionLimit, selectionSize } from "../shared/recommendation";
import { withLocalSnapshot } from "./cli";

const captureSchema = z.object({
  format: z.literal("after-dark-tonight-v1"), date: z.iso.datetime(), criteria: criteriaSchema,
  allowRecent: z.boolean(), acquisition: z.object({ after: z.number().int().nonnegative() }),
  selected: z.array(z.object({ id: z.number().int(), title: z.string() })).max(selectionSize),
  size: z.number().int().min(1).max(selectionSize).default(5),
  recentLimit: z.number().int().min(1).max(recentSelectionLimit).default(15),
  preferences: z.object({
    period: z.object({
      fromYear: z.number().int(), penalty: z.number(), maxExceptions: z.number().int(),
      minimumAffinity: z.number(), minimumReputationWithMood: z.number(),
    }).nullable(), animationPenalty: z.number(), repeatedDecadePenalty: z.number(),
  }),
});

export async function compareTonightAffinity(sqlite: string, rawCapture: unknown) {
  const capture = captureSchema.parse(rawCapture);
  return withLocalSnapshot(sqlite, async (db) => {
    const session = await db.select({ id: moodSessions.id }).from(moodSessions).where(eq(moodSessions.date, capture.date)).get();
    if (!session) throw Error("Séance absente de cette base.");
    const history = capture.allowRecent ? [] : await db.select({ id: recommendationHistory.movieId }).from(recommendationHistory)
      .where(lt(recommendationHistory.moodSessionId, session.id))
      .orderBy(desc(recommendationHistory.moodSessionId), recommendationHistory.rank).limit(capture.recentLimit);
    const { catalogue, signals, movies } = await readCatalogue(db);
    const excludedIds = await franchiseExclusions(db, movies);
    const policy = { referenceDate: capture.date.slice(0, 10), excludedIds };
    const recent = new Set(history.map(({ id }) => id));
    const byId = new Map(catalogue.map((film) => [film.id, film]));
    const hasVotes = (id: number) => (byId.get(id)?.metadata.reputation?.count ?? 0) > 0;
    const catalogueStats = catalogueFrequency(catalogue);
    const masked = catalogue.map((film) => ({ ...film, metadata: { ...film.metadata, reputation: undefined } }));
    type Row = ReturnType<typeof diagnoseRecommendation>["base"][number];
    const summarize = (rows: Row[]) => {
      const scores = rows.map(({ affinity }) => affinity.score).sort((a, b) => a - b);
      const matches = rows.flatMap(({ affinity }) => affinity.matches);
      const sum = (items: typeof matches) => items.reduce((total, { contribution }) => total + Math.abs(contribution), 0);
      const total = sum(matches);
      const keywords = matches.filter(({ key }) => key === "keyword");
      const generic = keywords.filter(({ id }) => (catalogueStats.counts.get(id) ?? 0) >= catalogueStats.total * 0.05);
      const metadata = rows.map(({ id }) => byId.get(id)!.metadata);
      return {
        coverage: {
          genres: metadata.filter(({ genres }) => genres.length > 0).length,
          directors: metadata.filter(({ directors }) => directors.length > 0).length,
          keywords: metadata.filter(({ keywords }) => keywords.length > 0).length,
          medianKeywordCount: metadata.map(({ keywords }) => keywords.length).sort((a, b) => a - b)[Math.floor((metadata.length - 1) / 2)] ?? null,
        },
        count: rows.length, withVotes: rows.filter(({ id }) => hasVotes(id)).length,
        capped: scores.filter((score) => score === 4).length,
        quantiles: [0, 0.25, 0.5, 0.75, 1].map((q) => scores[Math.floor(q * (scores.length - 1))] ?? null),
        keywordShare: total ? sum(keywords) / total : null,
        commonKeywordShare: total ? sum(generic) / total : null,
        isolatedPositiveShare: total ? sum(matches.filter(({ signalCount, contribution }) => signalCount === 1 && contribution > 0)) / total : null,
        negativeTraitMatches: matches.filter(({ contribution }) => contribution < 0).length,
      };
    };
    const variants: { model: TonightAffinityModel; ranking: RankingPolicy }[] = [
      ...affinityModels.map((model) => ({ model, ranking: "relevance" as const })),
      { model: tonightAffinityModel, ranking: "relevance" },
      { model: tonightAffinityModel, ranking: tonightRanking },
    ];
    return {
      captureDate: capture.date, capturedCatalogueSize: capture.acquisition.after, snapshotCatalogueSize: catalogue.length,
      catalogueWithVotes: catalogue.filter(({ id }) => hasVotes(id)).length, trainingSignals: signals.length,
      capturedTitles: capture.selected.map(({ title }) => title),
      variants: variants.map(({ model, ranking }) => {
        const run = (pool: typeof catalogue) => diagnoseRecommendation(pool, signals, capture.criteria, recent, policy, model, ranking, capture.preferences, capture.size);
        const trace = run(catalogue);
        const withoutVotes = run(masked);
        const top = trace.base.slice(0, 35);
        const topIds = new Set(top.map(({ id }) => id));
        const maskedTop = withoutVotes.base.slice(0, 35);
        const titles = trace.result.films.map(({ id, title }) => ({ title, withVotes: hasVotes(id),
          affinity: trace.base.find((row) => row.id === id)!.affinity.score }));
        const exclusionCounts = { seen: 0, dismissed: 0, blocked: 0 };
        for (const { causes } of trace.exclusions) {
          for (const key of Object.keys(exclusionCounts) as (keyof typeof exclusionCounts)[]) exclusionCounts[key] += Number(causes[key]);
        }
        const forbiddenSelections = trace.result.films.filter(({ id }) => {
          const film = byId.get(id)!;
          return film.dismissed || film.status === "seen" || excludedIds.has(id);
        }).length;
        return {
          model, ranking, pool: summarize(trace.base), withVotes: summarize(trace.base.filter(({ id }) => hasVotes(id))),
          withoutVotes: summarize(trace.base.filter(({ id }) => !hasVotes(id))), top35: summarize(top),
          selected: titles, top35Titles: top.map(({ id }) => byId.get(id)!.title),
          masked: {
            top35OriginallyWithVotes: maskedTop.filter(({ id }) => hasVotes(id)).length,
            top35Replacements: maskedTop.filter(({ id }) => !topIds.has(id)).length,
            selected: withoutVotes.result.films.map(({ title }) => title),
          },
          matchesCapture: trace.result.films.map(({ id }) => id).join() === capture.selected.map(({ id }) => id).join(),
          exclusionCounts, forbiddenSelections,
        };
      }),
    };
  });
}
