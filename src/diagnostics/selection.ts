import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CinemaDatabase } from "../db/client";
import { franchiseExclusions } from "../db/franchises";
import { readCatalogue, readHistory } from "../db/recommendations";
import { diagnoseRecommendation, engineVersion, tonightAffinityModel, tonightRanking } from "../domain/recommendation";
import { matchesSelectionGenre, type EditorialExperiment } from "../domain/selection-category";
import { decadeOf, tonightDefaults } from "../domain/tonight-preferences";
import { discoveryQueries } from "../main/tmdb";
import { criteriaSchema, recentSelectionLimit, selectionCategories, selectionSize, type Criteria, type SelectionCategory } from "../shared/recommendation";
import { reportDirectory, withLocalSnapshot } from "./cli";

type Snapshot = Pick<Awaited<ReturnType<typeof readCatalogue>>, "catalogue" | "signals"> &
  Awaited<ReturnType<typeof readHistory>> & { excludedIds: ReadonlySet<number> };
const categories = Object.keys(selectionCategories) as SelectionCategory[];
type Trace = ReturnType<typeof diagnoseRecommendation>;

function tally(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b, "fr"));
}

function distribution(values: (number | undefined)[]) {
  const known = values.filter((value) => value !== undefined).sort((a, b) => a - b);
  function quantile(q: number) {
    return known.length ? known[Math.floor(q * (known.length - 1))] : null;
  }
  return { known: known.length, total: values.length, min: quantile(0), median: quantile(0.5), max: quantile(1) };
}

export function auditSelection(snapshot: Snapshot, criteria: Criteria, referenceDate: string,
  options?: { experiment?: EditorialExperiment; category?: "classics" | "gems"; recentEntries?: number[]; engineVersion?: string }) {
  const { catalogue, signals, recent, excludedIds, round } = snapshot;
  const policy = { referenceDate, excludedIds };
  const run = (input: Criteria, history: ReadonlySet<number>) =>
    diagnoseRecommendation(catalogue, signals, input, history, policy, tonightAffinityModel, tonightRanking, tonightDefaults, selectionSize, options?.experiment);
  const byId = new Map(catalogue.map((film) => [film.id, film]));
  const neutral = { ...criteria, mood: "surprise" as const, selectionCategory: undefined };
  const year = Number(referenceDate.slice(0, 4));
  const overlap = (a: number[], b: number[]) => a.filter((id) => b.includes(id)).length;
  const reports = (options?.category ? [options.category] : categories).map((category) => {
    const input = { ...neutral, selectionCategory: category };
    const unrotated = run(input, new Set());
    const rotated = run(input, recent);
    const causes = new Map(unrotated.exclusions.map(({ id, causes }) => [id, causes]));
    const base = new Map(unrotated.base.map((row) => [row.id, row]));
    // periodLimit is a list composition decision, after individual eligibility.
    const eligible = (trace: Trace) => trace.exclusions.filter(({ causes }) =>
      !Object.entries(causes).some(([key, value]) => key !== "periodLimit" && value)).map(({ id }) => id);
    const summarize = (ids: number[]) => {
      const films = ids.map((id) => byId.get(id)!);
      const scores = ids.map((id) => base.get(id)!);
      return {
        count: ids.length,
        affinity: distribution(scores.map(({ affinity }) => affinity.score)),
        reputation: distribution(films.map(({ metadata }) => metadata.reputation?.average)),
        votes: distribution(films.map(({ metadata }) => metadata.reputation?.count)),
        popularity: distribution(films.map(({ metadata }) => metadata.popularity)),
        decades: tally(films.map(({ year }) => String(decadeOf(year) ?? "Inconnue"))),
        genres: tally(films.flatMap(({ metadata: { genres } }) => genres.length ? [...new Set(genres)] : ["Inconnu"])),
        countries: tally(films.flatMap(({ metadata: { countries } }) => countries.length ? countries : ["Inconnu"])),
        contributions: [...new Set(scores.flatMap(({ contributions }) => Object.keys(contributions)))].map((key) => [
          key, distribution(scores.map(({ contributions }) => (contributions as Record<string, number>)[key] ?? 0)),
        ] as const),
      };
    };
    const selections = (trace: Trace) => trace.result.films.map(({ id, title, year, metadata }, index) => {
      const score = base.get(id)!;
      return { id, title, year, genres: metadata.genres, reputation: metadata.reputation ?? null, popularity: metadata.popularity ?? null,
        affinity: score.affinity.score, decadePenalty: trace.steps[index].ranking[0].decadePenalty, baseRankWithoutRotation: score.rank, contributions: score.contributions, score: score.score,
        diversity: trace.steps[index].ranking[0].penalty, finalScore: trace.steps[index].ranking[0].score };
    });
    const selected = selections(rotated);
    const withoutRotation = selections(unrotated);
    const admissible = eligible(unrotated);
    const next = options?.recentEntries ? run(input,
      new Set([...selected.map(({ id }) => id), ...options.recentEntries].slice(0, recentSelectionLimit))) : undefined;
    const state = {
      next: next ? { admissible: eligible(next).length, status: next.result.status, selected: selections(next) } : undefined,
      candidates: options ? admissible.map((id) => ({ id, title: byId.get(id)!.title, affinity: base.get(id)!.affinity.score })) : undefined,
      categoryPassedButWeak: options ? unrotated.base.filter(({ id }) =>
        !causes.get(id)?.categoryEvidence && causes.get(id)?.weakEvidence).length : undefined,
      category, status: rotated.result.status, admissible: summarize(admissible), withRotation: eligible(rotated).length,
      proposed: summarize(selected.map(({ id }) => id)), selected, withoutRotation,
      retained: overlap(selected.map(({ id }) => id), withoutRotation.map(({ id }) => id)),
      exclusions: tally(rotated.exclusions.flatMap(({ causes }) => Object.entries(causes).flatMap(([key, value]) => value ? [key] : []))),
      recentAdmissible: admissible.filter((id) => recent.has(id)).length,
      offGenre: selected.filter(({ id }) => !matchesSelectionGenre(byId.get(id)!, category)).length,
      forbidden: selected.filter(({ id }) => causes.get(id)?.seen || causes.get(id)?.dismissed || causes.get(id)?.blocked).length,
    };
    const nearMisses = category === "gems" ? unrotated.base.flatMap((row) => {
      const failures = Object.entries(row.categoryChecks ?? {}).filter(([, passed]) => !passed).map(([key]) => key);
      const gates = causes.get(row.id)!;
      if (failures.length !== 1 || gates.periodMismatch || (gates.weakEvidence && failures[0] !== "affinity")) return [];
      const film = byId.get(row.id)!;
      return [{ title: film.title, year: film.year, failure: failures[0], weakEvidence: gates.weakEvidence,
        affinity: row.affinity.score, reputation: film.metadata.reputation ?? null, popularity: film.metadata.popularity ?? null,
        exposureRank: row.lessExposedThan ?? null }];
    }) : [];
    const classicConflicts = category === "classics" ? unrotated.base.filter(({ id, categoryChecks }) =>
      categoryChecks && Object.values(categoryChecks).every(Boolean) && !causes.get(id)?.weakEvidence
      && (causes.get(id)?.periodMismatch || causes.get(id)?.periodLimit))
      .map(({ id, affinity, contributions }) => ({ title: byId.get(id)!.title, year: byId.get(id)!.year, affinity: affinity.score,
        period: contributions.period, reason: causes.get(id)?.periodMismatch ? "affinité requise pour la période" : "limite d’exceptions" })) : [];
    return { ...state, nearMisses, classicConflicts };
  });
  const personal = run({ ...neutral, selectionCategory: "personal" }, recent);
  const legacy = run(neutral, recent);
  return {
    version: "selection-audit-v1", engineVersion: options?.engineVersion ?? engineVersion, referenceDate, criteria: neutral, round, recent: recent.size,
    catalogue: catalogue.length, signals: signals.length, reports,
    personalParity: JSON.stringify(personal.result) === JSON.stringify(legacy.result)
      && JSON.stringify(personal.steps) === JSON.stringify(legacy.steps) && JSON.stringify(personal.base) === JSON.stringify(legacy.base),
    overlaps: reports.map((a) => reports.map((b) => ({
      rotated: overlap(a.selected.map(({ id }) => id), b.selected.map(({ id }) => id)),
      unrotated: overlap(a.withoutRotation.map(({ id }) => id), b.withoutRotation.map(({ id }) => id)),
    }))),
    acquisition: (["classics", "gems"] as const).map((category) => {
      const build = (filters: Partial<Criteria>) => discoveryQueries({ ...neutral, selectionCategory: category, ...filters }, round, year);
      return { category, actual: build({}),
        neutral: build({ preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [] }),
        preferred: build({ preferredCountries: ["FR"], requiredCountries: [], preferredLanguages: ["fr"], requiredLanguages: [] }),
        strictSingle: build({ requiredCountries: ["FR"], requiredLanguages: ["fr"] }),
        strictMultiple: build({ requiredCountries: ["FR", "US"], requiredLanguages: ["fr", "en"] }) };
    }),
  };
}

type Audit = ReturnType<typeof auditSelection>;
const number = (value: number | null) => value === null ? "—" : value.toFixed(2);
const cell = (value: string) => value.replace(/[&<>|]/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "|": "&#124;" })[char]!).replace(/\s+/g, " ");
const counts = (items: [string, number][]) => items.map(([key, count]) => `${cell(key)} (${count})`).join(", ") || "—";

export function selectionMarkdown(audit: Audit) {
  const { reports } = audit;
  const labels = reports.map(({ category }) => selectionCategories[category]);
  const range = ({ min, median, max, known, total }: ReturnType<typeof distribution>) =>
    `${number(min)} / ${number(median)} / ${number(max)} · ${known}/${total}`;
  const overlapTable = (key: "rotated" | "unrotated") => [
    `| Catégorie | ${labels.join(" | ")} |`, `| --- | ${labels.map(() => "---:").join(" | ")} |`,
    ...audit.overlaps.map((row, index) => `| ${labels[index]} | ${row.map((item) => item[key]).join(" | ")} |`),
  ];
  return [
    "# Audit des catégories de Sélection", "",
    `${audit.version} · moteur ${audit.engineVersion} · référence ${audit.referenceDate} · tour ${audit.round}`, "",
    `Catalogue de ${audit.catalogue} films, ${audit.signals} films sources de signaux, ${audit.recent} identifiants en rotation.`,
    `Pour moi et l’ancien critère surprise donnent ${audit.personalParity ? "le même résultat, les mêmes scores et les mêmes étapes de classement" : "des résultats, scores ou étapes différents"} sur cet instantané.`, "",
    "| Catégorie | Admissibles avant rotation | Après rotation | Proposés | Sans rotation | En commun | Affinité médiane | Réputation médiane | Popularité médiane |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...reports.map((r) => `| ${selectionCategories[r.category]} | ${r.admissible.count} | ${r.withRotation} | ${r.selected.length} | ${r.withoutRotation.length} | ${r.retained} | ${number(r.proposed.affinity.median)} | ${number(r.proposed.reputation.median)} | ${number(r.proposed.popularity.median)} |`),
    "", "### Films en commun avec rotation", "", ...overlapTable("rotated"),
    "", "### Films en commun sans rotation", "", ...overlapTable("unrotated"),
    ...reports.flatMap((r) => [
      "", `## ${selectionCategories[r.category]}`, "",
      `État ${r.status}. ${r.recentAdmissible} admissibles écartés par rotation, ${r.offGenre} hors genre et ${r.forbidden} interdits parmi les propositions.`,
      `Causes cumulables dans le catalogue · ${counts(r.exclusions)}.`, "",
      ...([["Admissibles", r.admissible], ["Proposés", r.proposed]] as const).flatMap(([label, stats]) => [
        `**${label}**`, "",
        `- Décennies · ${counts(stats.decades)}`, `- Genres · ${counts(stats.genres)}`, `- Pays · ${counts(stats.countries)}`,
        `- Affinité · ${range(stats.affinity)}`, `- Réputation · ${range(stats.reputation)}`,
        `- Votes · ${range(stats.votes)}`, `- Popularité · ${range(stats.popularity)}`,
        `- Contributions (min. / médiane / max.) · ${stats.contributions.map(([name, values]) => `${name} ${range(values)}`).join(" ; ") || "—"}`, "",
      ]),
      "| Film | Année | Affinité | TMDB (votes) | Popularité | Base | Diversité + décennie (pénalité) | Score de sélection |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...r.selected.map((film) => `| ${cell(film.title)} | ${film.year ?? "—"} | ${number(film.affinity)} | ${film.reputation ? `${number(film.reputation.average)} (${film.reputation.count})` : "—"} | ${number(film.popularity)} | ${number(film.score)} | ${number(film.diversity)} | ${number(film.finalScore)} |`),
      "", `Sans rotation, dans l’ordre · ${r.withoutRotation.map(({ title }) => cell(title)).join(" · ") || "—"}.`,
      ...(r.category === "gems" ? ["", "### Pépites à un seul critère éditorial près", "",
        ...(r.nearMisses.length ? r.nearMisses.map((row) => `- ${cell(row.title)} (${row.year ?? "—"}) · ${row.failure} · affinité ${number(row.affinity)}, TMDB ${number(row.reputation?.average ?? null)} (${row.reputation?.count ?? "—"} votes), popularité ${number(row.popularity)}, rang d’exposition ${number(row.exposureRank)}${row.weakEvidence ? " · filtre général de pertinence également échoué" : ""}`) : ["Aucun cas."])] : []),
      ...(r.category === "classics" ? ["", "### Conflits entre Cultes et la politique de période", "",
        ...(r.classicConflicts.length ? r.classicConflicts.map((row) => `- ${cell(row.title)} (${row.year ?? "—"}) · ${row.reason}, affinité ${number(row.affinity)}, contribution de période ${number(row.period)}`) : ["Aucun cas."])] : []),
    ]),
    "", "## Acquisition TMDB", "",
    "Comparaison des paramètres produits par le code de production au même tour. Aucune requête réseau.", "",
    ...audit.acquisition.map(({ category, actual, neutral, preferred, strictSingle, strictMultiple }) =>
      `- ${selectionCategories[category]} · préférence FR/fr ${JSON.stringify(preferred) === JSON.stringify(neutral) ? "sans effet sur les requêtes" : "modifie les requêtes"}. Langue stricte unique · ${strictSingle.map((query) => query.with_original_language ?? "—").join(", ")}. Langues strictes multiples · ${strictMultiple.map((query) => query.with_original_language ?? "—").join(", ")}. Pays stricts transmis · ${strictSingle.some((query) => query.with_origin_country) ? "oui" : "non"}. Sources avec les critères de l’audit · ${actual.length}.`),
    "", "## Points à examiner", "",
    ...reports.flatMap((r) => [
      ...(r.offGenre || r.forbidden ? [`- ${selectionCategories[r.category]} · ${r.offGenre} films hors genre, ${r.forbidden} films interdits.`] : []),
      ...(r.withRotation < selectionSize ? [`- ${selectionCategories[r.category]} · seulement ${r.withRotation} candidats admissibles après rotation.`] : []),
      ...(r.classicConflicts.length ? [`- Cultes · ${r.classicConflicts.length} films satisfont le filtre éditorial et la pertinence générale, mais rencontrent une limite de période sans rotation.`] : []),
      ...(r.nearMisses.length ? [`- Pépites · ${r.nearMisses.length} films échouent à un seul critère éditorial, dont ${r.nearMisses.filter((row) => !row.weakEvidence).length} satisfont aussi le filtre général de pertinence. Par critère · ${counts(tally(r.nearMisses.map(({ failure }) => failure)))}.`] : []),
    ]),
    "", "## Limites et suites", "",
    "- Les distributions donnent minimum, médiane basse et maximum, puis couverture. Genres et pays peuvent se cumuler. Le plafond d’exceptions de période intervient après l’admissibilité individuelle.",
    "- La réputation et la popularité mesurent des signaux TMDB. Le statut culturel d’un film et l’intérêt du spectateur nécessitent un jugement indépendant. L’audit conserve le catalogue local, y compris ses lacunes.",
    "- Priorité 1 · évaluer à l’aveugle l’intérêt des films proposés, surtout lorsque l’affinité est faible. Comparer ensuite l’accord avec les signaux TMDB.",
    "- Priorité 2 · examiner les Pépites à un seul critère près avant toute modification de seuil et vérifier l’effet séparé des données manquantes.",
    "- Priorité 3 · vérifier les conflits de période dans Cultes. Si des préférences linguistiques ou géographiques donnent des listes courtes, mesurer le rappel de l’acquisition sur un instantané réseau distinct.",
    "",
  ].join("\n");
}

const defaultCriteria = { mood: "surprise", preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [] };

export async function readSelectionSnapshot(db: CinemaDatabase) {
  const { catalogue, signals, movies } = await readCatalogue(db);
  const history = await readHistory(db, recentSelectionLimit);
  const excludedIds = await franchiseExclusions(db, movies);
  return { catalogue, signals, movies, excludedIds, ...history };
}

export async function writeSelectionAudit(options: { sqlite: string; output: string; date: string; criteria?: unknown }) {
  const date = z.iso.date().parse(options.date);
  const criteria = criteriaSchema.parse(options.criteria ?? defaultCriteria);
  if (criteria.mood !== "surprise") throw new Error("Utilisez mood: surprise et les filtres communs aux huit catégories.");
  const audit = await withLocalSnapshot(options.sqlite, async (db) =>
    auditSelection(await readSelectionSnapshot(db), criteria, date));
  const directory = await reportDirectory(options.output, true);
  const write = (name: string, body: string) => writeFile(join(directory, name), body, { flag: "wx", mode: 0o600 });
  await write("selection-audit.md", selectionMarkdown(audit));
  await write("selection-audit.json", JSON.stringify(audit, null, 2) + "\n");
}
