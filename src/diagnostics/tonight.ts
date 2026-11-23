import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { filmFranchise } from "../domain/franchises";
import { engineVersion, tonightAffinityModel, tonightRanking, type Film, type diagnoseRecommendation } from "../domain/recommendation";
import { normalizeTitle } from "../domain/ratings";
import { decadeOf, tonightDefaults, type TonightPreferences } from "../domain/tonight-preferences";
import type { Criteria, Recommendation } from "../shared/recommendation";

export type Acquisition = {
  round: number;
  before: number;
  after: number;
  connection: Recommendation["connection"];
  sources: { parameters: Record<string, string>; listed: number; forwarded: number }[];
  discovered: number[];
  lookups: { tmdbId: number; result: "fresh-cache" | "over-budget" | "interrupted" | "cached" | "unmatched" | "missing" | "failed" }[];
};

type Movie = Parameters<typeof filmFranchise>[0] & { id: number };
type Trace = ReturnType<typeof diagnoseRecommendation>;

const specialKeywords = new Set([
  "sequel", "prequel", "based on tv series", "based on television series",
  "experimental film", "experimental cinema", "avant garde",
]);

function summarize(films: Film[]) {
  const decades: Record<string, number> = {};
  const genres: Record<string, number> = {};
  let withVotes = 0;
  for (const film of films) {
    const decade = decadeOf(film.year) ?? "unknown";
    decades[decade] = (decades[decade] ?? 0) + 1;
    for (const genre of new Set(film.metadata.genres)) {
      const key = normalizeTitle(genre);
      if (key) genres[key] = (Object.hasOwn(genres, key) ? genres[key] : 0) + 1;
    }
    withVotes += Number((film.metadata.reputation?.count ?? 0) > 0);
  }
  return { count: films.length, decades, genres, withVotes };
}

export function tonightDiagnostic(input: {
  date: string; criteria: Criteria; allowRecent: boolean; preferences?: TonightPreferences; size?: number; recentLimit?: number;
  acquisition: Acquisition; catalogue: Film[]; movies: Movie[]; trace: Trace;
}) {
  const { trace, acquisition } = input;
  const catalogue = new Map(input.catalogue.map((film) => [film.id, film]));
  const movies = new Map(input.movies.map((movie) => [movie.id, movie]));
  const exclusions = new Map(trace.exclusions.map((entry) => [entry.id, entry]));
  const acquisitionById = new Map(acquisition.lookups.map((row) => [row.tmdbId, row.result]));
  const selected = new Map(trace.result.films.map((film, index) => [film.id, { film, position: index + 1 }]));
  const base = new Map(trace.base.map((row) => [row.id, row]));
  const describe = (row: Trace["base"][number]) => {
    const film = catalogue.get(row.id)!;
    const movie = movies.get(row.id);
    const tmdbId = movie?.tmdbId ?? null;
    const exclusion = exclusions.get(row.id)!;
    const selection = selected.get(row.id);
    const collection = movie && filmFranchise(movie);
    const steps = trace.steps.flatMap(({ ranking }, index) => {
      const position = index + 1;
      const candidate = ranking.find(({ id }) => id === row.id);
      return candidate ? [{ position, ...candidate, winnerId: ranking[0].id, winnerScore: ranking[0].score }] : [];
    });
    return {
      id: film.id, tmdbId, title: film.title, year: film.year, genres: film.metadata.genres,
      reputation: film.metadata.reputation ?? null,
      acquisition: tmdbId === null ? "local-only" : acquisitionById.get(tmdbId) ?? (movie?.metadata?.tmdb ? "previously-cached" : "local-tmdb-id"),
      baseRank: row.rank, score: row.score, contributions: row.contributions, affinity: row.affinity,
      mood: row.mood ?? null, avoided: row.avoided ?? null, steps,
      exclusions: exclusion.causes,
      decision: selection ? { kind: "selected", reasons: selection.film.reasons, position: selection.position }
        : { kind: exclusion.excluded ? "excluded" : "outranked", reasons: row.reasons },
      warnings: row.warnings,
      review: {
        content: exclusion.quality,
        franchise: collection ? { key: collection.key, name: collection.name } : null,
        metadataKeywords: film.metadata.keywords.filter((keyword) => specialKeywords.has(normalizeTitle(keyword))),
        sharedKeywords: trace.result.films.filter(({ id }) => id !== film.id).flatMap((other) => {
          const otherKeywords = new Set(other.metadata.keywords.map(normalizeTitle));
          const keywords = [...new Set(film.metadata.keywords.filter((keyword) => otherKeywords.has(normalizeTitle(keyword))))];
          return keywords.length ? [{ id: other.id, keywords }] : [];
        }),
      },
    };
  };
  const acquired = new Set(acquisition.discovered);
  const counts: Record<string, number> = {};
  for (const { causes } of trace.exclusions) {
    for (const [cause, value] of Object.entries(causes)) counts[cause] = (counts[cause] ?? 0) + Number(value);
  }
  const alternatives = trace.base.filter(({ id }) => !selected.has(id)).slice(0, 30).map(describe);
  const selection = trace.result.films.map(({ id }) => describe(base.get(id)!));
  return {
    format: "after-dark-tonight-v1", engineVersion, affinityModel: tonightAffinityModel, ranking: tonightRanking, date: input.date, criteria: input.criteria,
    allowRecent: input.allowRecent, size: input.size, recentLimit: input.recentLimit, preferences: input.preferences ?? tonightDefaults,
    acquisition,
    pool: {
      afterAcquisition: summarize(input.catalogue),
      foundByTmdb: summarize(input.catalogue.filter(({ id }) => acquired.has(movies.get(id)?.tmdbId ?? -1))),
      scored: summarize(trace.base.map(({ id }) => catalogue.get(id)!)),
      selected: summarize(trace.result.films),
      overlappingExclusionCounts: counts,
    },
    status: trace.result.status, selected: selection, alternatives,
  };
}

export type TonightDiagnostic = ReturnType<typeof tonightDiagnostic>;

const causesFr: Record<string, string> = {
  seen: "déjà vu", dismissed: "refus explicite", country: "pays requis", language: "langue requise",
  duration: "durée maximale", content: "politique de contenu", blocked: "franchise exclue",
  recent: "historique récent", weakEvidence: "indices insuffisants", periodMismatch: "exception de période insuffisamment étayée",
  periodLimit: "limite d’exceptions de période",
};
const cell = (value: string | number) => String(value).replace(/[\r\n]+/g, " ")
  .replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!)
  .replace(/[\\|[\]!`]/g, (character) => "\\" + character);
const number = (value: number) => value.toFixed(2);

export function tonightMarkdown(report: TonightDiagnostic) {
  type Candidate = TonightDiagnostic["selected"][number];
  const line = (row: Candidate) => {
    const excluded = Object.entries(row.exclusions).filter(([, active]) => active).map(([key]) => causesFr[key]).join(", ");
    const winnerStep = row.steps.find((step) => step.position === ("position" in row.decision ? row.decision.position : undefined));
    const bestAttempt = [...row.steps].sort((a, b) => a.rank - b.rank)[0];
    const decision = winnerStep ? `Choix ${winnerStep.position} · meilleur score à cette étape (${number(winnerStep.score)})`
      : excluded || (bestAttempt ? `Dépassé à chaque étape accessible · meilleur rang ${bestAttempt.rank}` : "Non retenu");
    const flags = [row.review.content.category === "unknown" ? "Type incertain" : row.review.content.category !== "feature_film" ? row.review.content.category : undefined, row.review.franchise?.name, ...row.review.metadataKeywords,
      ...row.review.sharedKeywords.map(({ id, keywords }) => `avec #${id} : ${keywords.join(", ")}`)].filter(Boolean);
    return [`#${row.id} ${row.title} (${row.year ?? "date inconnue"})`, row.genres.join(", ") || "—",
      row.reputation ? `${row.reputation.average}/10 (${row.reputation.count} votes)` : "—", number(row.score), number(row.affinity.score),
      row.acquisition, decision, flags.join(" · ") || "—", row.decision.reasons.join(" ") || "—", ""].map(cell).join(" | ");
  };
  const table = (rows: Candidate[]) => [
    "| Film | Genres | TMDB | Score de base | Affinité | Source | Décision | Indices à vérifier | Explication du moteur | Avis utilisateur |",
    "| --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${line(row)} |`),
  ].join("\n");
  return [
    "# Diagnostic de la séance « Ce soir »", "",
    `Séance UTC ${report.date} · moteur ${report.engineVersion} · humeur ${report.criteria.mood}`, "",
    "## Acquisition et vivier", "",
    `Catalogue avant puis après acquisition : ${report.acquisition.before} → ${report.acquisition.after}. État TMDB : ${report.acquisition.connection}.`,
    `Identifiants renvoyés par Discover : ${report.acquisition.discovered.length}. Films correspondants dans le vivier réel : ${report.pool.foundByTmdb.count}. Films scorés après exclusions initiales : ${report.pool.scored.count}.`, "",
    ...report.acquisition.sources.map(({ parameters, listed, forwarded }) => `- ${Object.entries(parameters).map(([key, value]) => `${key}=${value}`).join(" · ")} — ${listed} fiches valides, ${forwarded} transmises.`),
    "", "| Étape | Décennies (effectifs) | Genres les plus fréquents | Avis TMDB disponibles |",
    "| --- | --- | --- | ---: |",
    ...([["Catalogue après acquisition", report.pool.afterAcquisition], ["Correspondances Discover", report.pool.foundByTmdb],
      ["Candidats scorés", report.pool.scored], ["Sélection", report.pool.selected]] as const).map(([name, counts]) =>
      `| ${name} | ${Object.entries(counts.decades).map(([decade, count]) => `${decade} (${count})`).join(", ")} | ${Object.entries(counts.genres)
        .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([genre, count]) => `${genre} (${count})`).join(", ")} | ${counts.withVotes}/${counts.count} |`),
    "", "Les films déjà présents dans le catalogue peuvent être retenus sans avoir été renvoyés par Discover. Comparer le vivier et les alternatives avec les choix avant d’attribuer l’écart à l’acquisition ou au classement.", "",
    "## Films proposés", "", table(report.selected), "", "## Meilleurs films non retenus", "", table(report.alternatives), "",
    "Le JSON contient les contributions et le départage à chaque étape. Les alternatives sont triées par score de base et incluent les rejets postérieurs au calcul du score. Les exclusions antérieures au score apparaissent dans les compteurs cumulables.", "",
    "Une appartenance à une franchise ou un mot-clé TMDB constitue un indice à vérifier. Ces données ne suffisent pas à établir des prérequis narratifs. Les thèmes communs listés correspondent à des mots-clés effectivement partagés.", "",
    "Pour chaque film, noter l’intérêt réel, le contexte préalable nécessaire et la clarté de l’explication dans la dernière colonne.", "",
  ].join("\n");
}

export async function writeTonightDiagnostic(directory: string, report: TonightDiagnostic) {
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, "tonight.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await writeFile(join(directory, "tonight.md"), tonightMarkdown(report), { mode: 0o600, flag: "wx" });
}
