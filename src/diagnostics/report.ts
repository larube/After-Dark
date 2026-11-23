import { createHash } from "node:crypto";
import { calendarDate, contentTypes, todayUtc, type CandidatePolicy } from "../domain/candidate-quality";
import { z } from "zod";
import { diagnoseRecommendation, engineVersion, holdoutInputs, recommend } from "../domain/recommendation";
import { criteriaSchema, metadataSchema, moods, type Criteria } from "../shared/recommendation";

const filmSchema = z.strictObject({
  id: z.number().int(), title: z.string(), year: z.number().int().nullable(),
  status: z.enum(["seen", "unseen", "unknown"]).optional(), metadata: metadataSchema.strict(),
});
const inputSchema = z.strictObject({
  catalogue: z.array(filmSchema),
  signals: z.array(z.strictObject({
    id: z.number().int(),
    ratings: z.array(z.strictObject({ numeric: z.number().min(0).max(10).optional(), qualitative: z.string().optional() })),
    spontaneous: z.boolean(), memorable: z.boolean(), rewatch: z.boolean(),
  })),
  recent: z.array(z.number().int()),
});

export type Input = z.infer<typeof inputSchema>;
const neutral: Criteria = { mood: "surprise", preferredCountries: [], preferredLanguages: [], requiredCountries: [], requiredLanguages: [] };
export const scenarios: { id: string; criteria: Criteria }[] = [
  ...Object.keys(moods).map((mood) => ({ id: mood, criteria: criteriaSchema.parse({ ...neutral, mood }) })),
  { id: "duration", criteria: { ...neutral, maxMinutes: 105 } },
  { id: "country", criteria: { ...neutral, requiredCountries: ["ES", "JP"], preferredCountries: ["JP"] } },
  { id: "language", criteria: { ...neutral, requiredLanguages: ["es", "ja"], preferredLanguages: ["es"] } },
  { id: "avoid", criteria: { ...neutral, mood: "emotion", avoid: "tension" } },
  { id: "combined", criteria: { ...neutral, requiredCountries: ["ES", "JP"], requiredLanguages: ["es", "ja"], maxMinutes: 105, avoid: "strange" } },
];
export const evaluationConfig = { folds: 5, minimumRating: 8, cutoff: 5, criteria: neutral, split: "sha256-id-v1" };
const formatVersion = 2;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  }
  return JSON.stringify(value);
}

const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

export function parseInput(value: unknown): Input {
  const input = inputSchema.parse(value);
  const ids = new Set(input.catalogue.map(({ id }) => id));
  if (ids.size !== input.catalogue.length || new Set(input.signals.map(({ id }) => id)).size !== input.signals.length
    || input.signals.some(({ id }) => !ids.has(id))) throw new Error("Identifiants de catalogue ou de signaux invalides.");
  return input;
}

function diversity(films: ReturnType<typeof recommend>["films"]) {
  const dimensions = ["genres", "directors", "countries", "language"] as const;
  const overlapDimensions = [...dimensions, "keywords"] as const;
  const values = (film: (typeof films)[number], key: (typeof overlapDimensions)[number]) =>
    new Set([film.metadata[key] ?? []].flat().map((label) => label.toLowerCase().trim()));
  const overlap = films.flatMap((left, index) => films.slice(index + 1).map((right) => ({
    ids: [left.id, right.id],
    shared: Object.fromEntries(overlapDimensions.map((key) => [key, [...values(left, key)].filter((value) => values(right, key).has(value))])),
  })));
  return {
    dimensions: Object.fromEntries(dimensions.map((key) => [key, {
      distinct: new Set(films.flatMap((film) => [...values(film, key)])).size,
      missing: films.filter((film) => !values(film, key).size).length,
    }])),
    categories: Object.fromEntries(["safe", "gem", "wildcard"].map((category) => [category, films.filter((film) => film.category === category).length])),
    overlap,
  };
}

function evaluate(catalogue: Input["catalogue"], signals: Parameters<typeof recommend>[1], recent: Set<number>, policy: CandidatePolicy) {
  const targets = signals.flatMap(({ film, ratings }) => {
    const numeric = ratings.flatMap(({ numeric }) => numeric === undefined ? [] : [numeric]);
    if (!numeric.length) return [];
    const mean = numeric.reduce((sum, score) => sum + score, 0) / numeric.length;
    return mean < evaluationConfig.minimumRating ? [] : [{ id: film.id, numeric, mean, key: hash(["holdout-v1", film.id]) }];
  }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.id - b.id);
  const count = Math.min(evaluationConfig.folds, targets.length);
  const folds = Array.from({ length: count }, (_, index) => {
    const sample = targets.filter((_, position) => position % count === index);
    const heldOut = new Set(sample.map(({ id }) => id));
    const { candidates, training } = holdoutInputs(catalogue, signals, heldOut);
    const history = new Set([...recent].filter((id) => !heldOut.has(id)));
    const trace = diagnoseRecommendation(candidates, training, evaluationConfig.criteria, history, policy);
    const ranks = new Map(trace.base.map(({ id, rank }) => [id, rank]));
    const policyExclusions = new Map(trace.exclusions.filter(({ causes }) => causes.content)
      .map(({ id, quality }) => [id, quality.exclusionReasons]));
    const eligibleTargets = sample.filter(({ id }) => ranks.has(id)).length;
    const selected = trace.result.films.map(({ id }) => id);
    const discount = (position: number) => 1 / Math.log2(position + 2);
    const dcg = selected.reduce((sum, id, position) => sum + (heldOut.has(id) ? discount(position) : 0), 0);
    const ideal = sample.slice(0, evaluationConfig.cutoff).reduce((sum, _, position) => sum + discount(position), 0);
    return {
      index: index + 1, eligibleTargets, trainingSignals: training.length, rankedCandidates: trace.base.length, selected,
      targets: sample.map(({ id, numeric, mean }) => ({
        id, numeric, mean, exclusions: policyExclusions.get(id) ?? [],
        baseRank: ranks.get(id) ?? null, selectedRank: selected.includes(id) ? selected.indexOf(id) + 1 : null,
      })),
      recallAt5: selected.filter((id) => heldOut.has(id)).length / sample.length,
      ndcgAt5: dcg / ideal,
    };
  });
  return {
    config: evaluationConfig, targets: targets.length, eligibleTargets: folds.reduce((sum, fold) => sum + fold.eligibleTargets, 0), folds,
    recallAt5: count ? folds.reduce((sum, fold) => sum + fold.recallAt5, 0) / count : null,
    ndcgAt5: count ? folds.reduce((sum, fold) => sum + fold.ndcgAt5, 0) / count : null,
  };
}

export function createReport(raw: unknown, { referenceDate = todayUtc(), mode = "classic" }: Partial<CandidatePolicy> = {}) {
  if (calendarDate(referenceDate) !== referenceDate) throw new Error("Date de référence invalide. Format attendu AAAA-MM-JJ.");
  const policy = { referenceDate, mode } as const;
  const input = parseInput(raw);
  const { catalogue } = input;
  const byId = new Map(catalogue.map((film) => [film.id, film]));
  const signals = input.signals.map(({ id, ...signal }) => ({ ...signal, film: byId.get(id)! }));
  const recent = new Set([...input.recent].sort((a, b) => a - b));
  const popularity = catalogue.flatMap(({ metadata }) => metadata.popularity === undefined ? [] : [metadata.popularity]).sort((a, b) => a - b);
  const median = popularity.length ? (popularity[Math.floor((popularity.length - 1) / 2)] + popularity[Math.floor(popularity.length / 2)]) / 2 : null;
  return {
    formatVersion, engineVersion: mode === "legacy" ? "1.1.0" : engineVersion, policy,
    fingerprint: hash({ catalogue, signals: input.signals, recent: [...recent], scenarios, evaluationConfig, referenceDate }),
    catalogue: {
      total: catalogue.length, signals: signals.length,
      films: catalogue.map(({ id, title }) => ({ id, title })),
      missing: Object.fromEntries(Object.keys(metadataSchema.shape).map((key) => [key, catalogue.filter(({ metadata }) => {
        const value = metadata[key as keyof typeof metadata];
        return value === undefined || (Array.isArray(value) && !value.length);
      }).length])),
      popularity: {
        known: popularity.length, median,
        belowMedian: catalogue.flatMap(({ id, metadata }) => median !== null && metadata.popularity !== undefined
          && metadata.popularity < median ? [{ id, value: metadata.popularity }] : []).sort((a, b) => a.value - b.value || a.id - b.id),
      },
    },
    scenarios: scenarios.map(({ id, criteria }) => {
      const trace = diagnoseRecommendation(catalogue, signals, criteria, recent, policy);
      const qualityById = new Map(trace.exclusions.map(({ id, quality }) => [id, quality]));
      const counts = { seen: 0, country: 0, language: 0, duration: 0, content: 0, recent: 0 };
      let eligible = 0;
      let eligibleBeforePolicy = 0;
      const distribution = Object.fromEntries(contentTypes.map((type) => [type, 0]));
      const exclusionsByType = Object.fromEntries(contentTypes.map((type) => [type, 0]));
      const exclusionsByReason: Record<string, number> = {};
      const retainedUnknown: number[] = [];
      for (const { id, causes, quality } of trace.exclusions) {
        counts.seen += Number(causes.seen);
        counts.country += Number(causes.country);
        counts.language += Number(causes.language);
        counts.duration += Number(causes.duration);
        counts.recent += Number(causes.recent);
        counts.content += Number(causes.content);
        distribution[quality.category]++;
        const otherwiseEligible = !causes.seen && !causes.country && !causes.language && !causes.duration;
        eligibleBeforePolicy += Number(otherwiseEligible);
        eligible += Number(otherwiseEligible && !causes.content);
        if (otherwiseEligible && causes.content) {
          exclusionsByType[quality.category]++;
          for (const reason of quality.exclusionReasons) exclusionsByReason[reason] = (exclusionsByReason[reason] ?? 0) + 1;
        }
        if (otherwiseEligible && !causes.content && quality.category === "unknown") retainedUnknown.push(id);
      }
      return {
        id, criteria, counts, eligible, eligibleBeforePolicy,
        content: { distribution, uncertain: distribution.unknown, exclusionsByType, exclusionsByReason, retainedUnknown,
          unknownShare: eligible ? retainedUnknown.length / eligible : null },
        removedByRecent: eligible - trace.base.length,
        ...trace, diversity: diversity(trace.result.films),
        discovery: trace.result.films.map(({ id, metadata }) => ({
          id, type: qualityById.get(id)!.category, popularity: metadata.popularity ?? null,
          belowCatalogueMedian: metadata.popularity === undefined || median === null ? null : metadata.popularity < median,
        })),
      };
    }),
    holdout: evaluate(catalogue, signals, recent, policy),
  };
}

export type Report = ReturnType<typeof createReport>;

export function compareReports(baseline: Report, current: Report) {
  if (baseline.formatVersion !== current.formatVersion || baseline.fingerprint !== current.fingerprint) {
    throw new Error("Comparaison impossible : format, données ou configuration différents.");
  }
  const pair = <T>(before: T, after: T) => ({ before, after });
  const changed = <T>({ before, after }: { before: T; after: T }) => canonical(before) !== canonical(after);
  return {
    engine: pair(baseline.engineVersion, current.engineVersion),
    policy: pair(baseline.policy, current.policy),
    scenarios: current.scenarios.map((scenario) => {
      const prior = baseline.scenarios.find(({ id }) => id === scenario.id);
      if (!prior) throw new Error("Scénario absent du rapport de référence.");
      const index = (run: typeof scenario) => ({
        base: new Map(run.base.map((row) => [row.id, row])),
        slots: run.steps.map(({ ranking }) => new Map(ranking.map((row) => [row.id, row]))),
        selected: new Map(run.result.films.map((film, position) => [film.id, position + 1])),
      });
      const before = index(prior);
      const after = index(scenario);
      const ids = new Set([...before.base.keys(), ...after.base.keys()]);
      const describe = (run: ReturnType<typeof index>, id: number) => ({
        base: run.base.get(id) ?? null,
        slots: run.slots.map((slot) => slot.get(id) ?? null),
        selected: run.selected.get(id) ?? null,
      });
      return {
        id: scenario.id,
        selection: pair(prior.result.films.map(({ id, category }) => ({ id, category })), scenario.result.films.map(({ id, category }) => ({ id, category }))),
        changes: [...ids].flatMap((id) => {
          const diff = pair(describe(before, id), describe(after, id));
          return changed(diff) ? [{ id, ...diff }] : [];
        }),
        diversity: pair(prior.diversity, scenario.diversity),
        discovery: pair(prior.discovery, scenario.discovery),
        content: pair(prior.content, scenario.content),
        eligibility: pair(prior.eligible, scenario.eligible),
        exclusionChanges: scenario.exclusions.flatMap((row, index) =>
          changed(pair(prior.exclusions[index], row)) ? [{ id: row.id, ...pair(prior.exclusions[index], row) }] : []),
        exclusionsChanged: changed(pair(prior.exclusions, scenario.exclusions)),
      };
    }),
    holdout: pair(baseline.holdout, current.holdout),
  };
}
