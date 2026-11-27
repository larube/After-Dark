import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { diagnoseRecommendation, engineVersion, previousCompositionEngineVersion, tonightAffinityModel, tonightRanking, type Film } from "../domain/recommendation";
import { decadeOf, selectionPreferences, tonightDefaults } from "../domain/tonight-preferences";
import { criteriaSchema, recentSelectionLimit, selectionCategories, selectionSize, type Criteria, type SelectionCategory } from "../shared/recommendation";
import { reportDirectory, withLocalSnapshot } from "./cli";
import { defaultSelectionCriteria, readRecentEntries, readSelectionSnapshot } from "./selection";

function tally(keys: string[]) {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}
function distribution(films: Film[]) {
  return {
    count: films.length,
    before1980: films.filter(({ year }) => year !== null && year > 0 && year < 1980).length,
    since1980: films.filter(({ year }) => year !== null && year >= 1980).length,
    unknownYear: films.filter(({ year }) => decadeOf(year) === null).length,
    decades: tally(films.map(({ year }) => String(decadeOf(year) ?? "inconnue"))),
    countries: tally(films.flatMap(({ metadata }) => metadata.countries.length ? [...new Set(metadata.countries)] : ["inconnu"])),
  };
}
const categories = Object.keys(selectionCategories) as SelectionCategory[];

export function compareComposition(snapshot: Awaited<ReturnType<typeof readSelectionSnapshot>>, history: number[],
  criteria: Criteria, referenceDate: string, acquisition?: unknown) {
  const { catalogue, signals, excludedIds } = snapshot;
  const byId = new Map(catalogue.map((film) => [film.id, film]));
  const policy = { referenceDate, excludedIds };
  const past = acquisition === undefined ? undefined : z.object({
    referenceDate: z.iso.date(), network: z.boolean(),
    results: z.array(z.object({ category: z.enum(categories), arms: z.array(z.object({
      strategy: z.enum(["baseline", "profile"]), rounds: z.array(z.object({
        report: z.object({ discovered: z.array(z.number().int().positive()) }),
      })),
    })) })),
  }).parse(acquisition);
  const moviesByTmdb = new Map(snapshot.movies.flatMap(({ id, tmdbId }) => tmdbId ? [[tmdbId, byId.get(id)!] as const] : []));
  const historicalAcquisition = past && {
    date: past.referenceDate, network: past.network,
    categories: past.results.flatMap(({ category, arms }) => arms.map(({ strategy, rounds }) => {
      const ids = [...new Set(rounds.flatMap(({ report }) => report.discovered))];
      const matched = ids.flatMap((id) => moviesByTmdb.get(id) ?? []);
      return { category, strategy, discovered: ids.length, matched: distribution(matched) };
    })),
  };
  const run = (category: SelectionCategory, recent: number[], balanced: boolean) => {
    const trace = diagnoseRecommendation(catalogue, signals, { ...criteria, selectionCategory: category },
      new Set(recent), policy, tonightAffinityModel, tonightRanking, balanced ? selectionPreferences : tonightDefaults, selectionSize);
    const admissible = new Set(trace.exclusions.filter(({ causes }) => !Object.entries(causes).some(([key, active]) =>
      key !== "periodLimit" && active)).map(({ id }) => id));
    const ranked = trace.base.filter(({ id }) => admissible.has(id));
    const scores = new Map(ranked.map((row) => [row.id, row]));
    const picked = trace.result.films;
    return {
      eligible: distribution([...admissible].map((id) => byId.get(id)!)),
      topScores: distribution(ranked.slice(0, selectionSize).map(({ id }) => byId.get(id)!)),
      selected: distribution(picked),
      films: picked.map(({ id, title, year, metadata }, i) => ({
        id, title, year, countries: metadata.countries, affinity: scores.get(id)!.affinity.score,
        score: scores.get(id)!.score, finalScore: trace.steps[i].ranking[0].score, composition: trace.steps[i].composition,
      })),
    };
  };
  const byCategory = categories.map((category) => {
    let baselineHistory = history;
    let balancedHistory = history;
    const rounds = Array.from({ length: 6 }, () => {
      const before = run(category, baselineHistory, false);
      const controlled = run(category, baselineHistory, true);
      const after = run(category, balancedHistory, true);
      baselineHistory = [...before.films.map(({ id }) => id), ...baselineHistory].slice(0, recentSelectionLimit);
      balancedHistory = [...after.films.map(({ id }) => id), ...balancedHistory].slice(0, recentSelectionLimit);
      return { before, controlled, after };
    });
    return { category, rounds };
  });
  return { format: "selection-composition-v1", referenceDate, baseline: previousCompositionEngineVersion,
    engine: engineVersion, criteria, catalogue: distribution(catalogue), signals: signals.length, historicalAcquisition, byCategory };
}

const safe = (title: string) => title.replace(/[|<>\r\n]/g, " ");
type CompositionReport = ReturnType<typeof compareComposition>;
function markdown(report: CompositionReport) {
  const metrics = (row: CompositionReport["byCategory"][number]["rounds"][number]["after"]) =>
    `${row.selected.count} / ${row.selected.before1980} / ${row.selected.countries.IN ?? 0}`;
  const differences = (from: { id: number }[], to: CompositionReport["byCategory"][number]["rounds"][number]["after"]["films"]) =>
    to.filter(({ id }) => !from.some((film) => film.id === id)).map(({ title, affinity, score }) =>
      `${safe(title)} (affinité ${affinity.toFixed(2)}, score ${score.toFixed(2)})`).join(" · ") || "—";
  return [
    "# Comparaison de la composition de Sélection",
    "", `${report.catalogue.count} films, ${report.signals} sources de signaux · ${report.referenceDate} · ${report.baseline} → ${report.engine}`,
    "", "Six rotations hors ligne par catégorie. Le contrôle rejoue la nouvelle composition avec l’historique de l’ancien moteur à chaque tour. Le bras Après conserve son propre historique.",
    "", "Les valeurs indiquent le nombre de propositions, de films d’avant 1980 et de productions incluant l’Inde. Les coproductions sont comptées par présence dans les distributions descriptives. Les distributions complètes, pays et décennies, sont dans le JSON.",
    "", "| Catégorie | Tour | Vivier avant | Top scores avant | Avant | Contrôle | Après | Entrants (contrôle) | Sortants (contrôle) |",
    "| --- | ---: | ---: | --- | --- | --- | --- | --- | --- |",
    ...report.byCategory.flatMap(({ category, rounds }) => rounds.map(({ before, controlled, after }, i) =>
      `| ${selectionCategories[category]} | ${i + 1} | ${before.eligible.count} | ${before.topScores.count} / ${before.topScores.before1980} / ${before.topScores.countries.IN ?? 0} | ${metrics(before)} | ${metrics(controlled)} | ${metrics(after)} | ${differences(before.films, controlled.films)} | ${differences(controlled.films, before.films)} |`)),
    ...(report.historicalAcquisition ? [
      "", "## Acquisition antérieure", "",
      `Rapport du ${report.historicalAcquisition.date} · réseau activé : ${report.historicalAcquisition.network ? "oui" : "non"}. Les identifiants Discover sont rapprochés du catalogue actuel. Les IDs absents du catalogue ne peuvent pas être ventilés. Cette observation porte sur un autre instantané.`, "",
      "| Catégorie | Stratégie | IDs distincts | Correspondances locales | Avant 1980 | Production incluant l’Inde |",
      "| --- | --- | ---: | ---: | ---: | ---: |",
      ...report.historicalAcquisition.categories.map(({ category, strategy, discovered, matched }) =>
        `| ${selectionCategories[category]} | ${strategy} | ${discovered} | ${matched.count} | ${matched.before1980} | ${matched.countries.IN ?? 0} |`),
    ] : []),
    "", "Le rejeu n’acquiert aucun film. Les exports de séance existants mesurent séparément les correspondances TMDB, l’admissibilité et la sélection. Les scores décrivent le choix du moteur.",
  ].join("\n") + "\n";
}

export async function writeCompositionAudit(options: { sqlite: string; output: string; date: string; criteria?: unknown; acquisition?: unknown }) {
  const date = z.iso.date().parse(options.date);
  const criteria = criteriaSchema.parse(options.criteria ?? defaultSelectionCriteria);
  const report = await withLocalSnapshot(options.sqlite, async (db) =>
    compareComposition(await readSelectionSnapshot(db), await readRecentEntries(db), criteria, date, options.acquisition));
  const directory = await reportDirectory(options.output, true);
  const write = (name: string, body: string) => writeFile(join(directory, name), body, { flag: "wx", mode: 0o600 });
  await write("selection-composition.md", markdown(report));
  await write("selection-composition.json", JSON.stringify(report, null, 2) + "\n");
}
