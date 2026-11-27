import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { criteriaSchema, recentSelectionLimit, selectionCategories, selectionSize } from "../shared/recommendation";
import { diagnoseRecommendation, engineVersion, previousGenreEngineVersion, tonightAffinityModel, tonightRanking } from "../domain/recommendation";
import { selectionGenreExclusions } from "../domain/selection-category";
import { normalizeTitle } from "../domain/ratings";
import { reportDirectory, withLocalSnapshot } from "./cli";
import { defaultSelectionCriteria, readRecentEntries, readSelectionSnapshot } from "./selection";

const clean = (value: string) => value.replace(/[|<>\r\n]/g, " ");

export async function writeGenreEditorialAudit(options: { sqlite: string; output: string; date: string; criteria?: unknown }) {
  const referenceDate = z.iso.date().parse(options.date);
  const filters = criteriaSchema.parse(options.criteria ?? defaultSelectionCriteria);
  if (filters.mood !== "surprise") throw new Error("Utilisez mood: surprise pour comparer les catégories.");

  const report = await withLocalSnapshot(options.sqlite, async (db) => {
    const { catalogue, signals, recent, excludedIds } = await readSelectionSnapshot(db);
    const recentEntries = await readRecentEntries(db);
    const describe = ({ id, title, year }: (typeof catalogue)[number]) => ({ id, title, year });
    const animated = (film: (typeof catalogue)[number]) =>
      film.metadata.release?.genres?.some(({ id }) => id === 16) ||
      film.metadata.genres.some((genre) => normalizeTitle(genre) === "animation");
    const categories = (["horror", "thriller"] as const).map((selectionCategory) => {
      const criteria = { ...filters, selectionCategory };
      const simulate = (genreTagsOnly: boolean) => {
        const run = (history: ReadonlySet<number>) => diagnoseRecommendation(catalogue, signals, criteria, history,
          { referenceDate, excludedIds, genreTagsOnly }, tonightAffinityModel, tonightRanking, undefined, selectionSize);
        const ids = (trace: ReturnType<typeof run>) => new Set(trace.exclusions.filter(({ causes }) =>
          !Object.entries(causes).some(([key, excluded]) => key !== "periodLimit" && excluded)).map(({ id }) => id));
        const all = ids(run(new Set()));
        const rotated = run(recent);
        const available = ids(rotated);
        let history = recentEntries;
        let trace = rotated;
        const sessions = Array.from({ length: 3 }, (_, index) => {
          if (index) trace = run(new Set(history));
          const films = trace.result.films.map(describe);
          history = [...films.map(({ id }) => id), ...history].slice(0, recentSelectionLimit);
          return { count: films.length, available: ids(trace).size, films };
        });
        return { all, available, sessions, causes: new Map(rotated.exclusions.map(({ id, causes }) => [id, causes])) };
      };
      const before = simulate(true);
      const after = simulate(false);
      const removed = catalogue.filter(({ id }) => before.all.has(id) && !after.all.has(id)).map(describe);
      const added = catalogue.filter(({ id }) => !before.all.has(id) && after.all.has(id)).map(describe);
      const familyExclusions = catalogue.filter((film) => selectionGenreExclusions(film, selectionCategory).familyHorror)
        .map((film) => ({ ...describe(film), wasAdmissible: before.all.has(film.id), wasAvailable: before.available.has(film.id),
          previousCauses: Object.entries(before.causes.get(film.id) ?? {}).filter(([, excluded]) => excluded).map(([reason]) => reason),
          reason: "Genre familial et marqueur jeunesse concordants." }));
      const keptAnimation = catalogue.filter((film) => after.all.has(film.id) && animated(film)).map(describe);
      const summary = (state: typeof before) => ({ admissible: state.all.size, available: state.available.size, sessions: state.sessions });
      return { selectionCategory, before: summary(before), after: summary(after), removed, added, familyExclusions, keptAnimation };
    });
    return { format: "after-dark-genre-editorial-v1", referenceDate, baseline: previousGenreEngineVersion, engineVersion,
      catalogue: catalogue.length, signals: signals.length, recent: recent.size, filters, categories };
  });
  const titles = (films: { title: string; year: number | null }[]) => films.map(({ title, year }) =>
    `${clean(title)} (${year ?? "—"})`).join(", ") || "—";
  const markdown = [
    "# Audit éditorial Horreur et Thriller", "",
    `${report.catalogue} films et ${report.signals} films sources de signaux · ${referenceDate} · moteur ${report.baseline} → ${engineVersion}`, "",
    "| Catégorie | Admissibles avant rotation | Admissibles après rotation | Propositions sur trois séances |",
    "| --- | --- | --- | --- |",
    ...report.categories.map(({ selectionCategory, before, after }) =>
      `| ${selectionCategories[selectionCategory]} | ${before.admissible} → ${after.admissible} | ${before.available} → ${after.available} | ${before.sessions.map(({ count }) => count).join(" / ")} → ${after.sessions.map(({ count }) => count).join(" / ")} |`),
    "", ...report.categories.flatMap(({ selectionCategory, before, after, removed, added, familyExclusions, keptAnimation }) => [
      `## ${selectionCategories[selectionCategory]}`, "",
      `- Sorties du vivier admissible · ${titles(removed)}`,
      `- Entrées dans le vivier admissible · ${titles(added)}`,
      `- Films d’animation admissibles · ${titles(keptAnimation)}`,
      ...familyExclusions.map((film) => `- ${titles([film])} · ${film.reason} ${film.wasAdmissible ? "Admissible auparavant." : `Autres motifs : ${film.previousCauses.join(", ")}.`}`),
      ...before.sessions.flatMap(({ films }, index) => [
        `- Séance ${index + 1}, référence · ${titles(films)}`,
        `- Séance ${index + 1}, nouvelle politique · ${titles(after.sessions[index].films)}`,
      ]), "",
    ]),
    "Comparaison hors ligne sur un instantané unique. La rotation part de l’historique existant et avance séparément dans chaque simulation. Les conditions de classement et la limite de dix propositions sont communes. Ce test mesure la couverture et la cohérence des métadonnées.", "",
  ].join("\n");
  const output = await reportDirectory(options.output, true);
  const write = (name: string, contents: string) => writeFile(join(output, name), contents, { flag: "wx", mode: 0o600 });
  await write("genre-editorial.md", markdown);
  await write("genre-editorial.json", JSON.stringify(report, null, 2) + "\n");
}
