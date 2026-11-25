import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openDatabase } from "../db/client";
import { readCatalogue, readHistory, saveRecommendation } from "../db/recommendations";
import { acquisitionProfile } from "../domain/acquisition-profile";
import { diagnoseRecommendation, engineVersion, tonightAffinityModel, tonightRanking } from "../domain/recommendation";
import { decadeOf, tonightDefaults } from "../domain/tonight-preferences";
import { acquireTonight } from "../main/acquire";
import { localTmdb } from "../main/recommend";
import { TmdbError, type TmdbClient } from "../main/tmdb";
import { criteriaSchema, recentSelectionLimit, selectionCategories, selectionSize, type SelectionCategory } from "../shared/recommendation";
import { reportDirectory, withSnapshotFile } from "./cli";

const strategies = ["baseline", "profile"] as const;
const categories = Object.keys(selectionCategories) as SelectionCategory[];
const neutral = { mood: "surprise", preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [] };
const cell = (value: string) => value.replace(/[|<>\n\r]/g, " ");
const distinct = (values: unknown[]) => new Set(values).size;

export async function compareAcquisition(options: {
  snapshot: string; date: Date; migrations?: string; criteria?: unknown;
  client: () => Promise<TmdbClient | undefined>; categories?: SelectionCategory[];
}) {
  const referenceDate = options.date.toISOString().slice(0, 10);
  const criteria = criteriaSchema.parse(options.criteria ?? neutral);
  const results = [];
  for (const category of options.categories ?? categories) {
    const arms = [];
    for (const strategy of strategies) {
      const result = await withSnapshotFile(options.snapshot, async (copy) => {
        const { db, close } = await openDatabase(copy, options.migrations ?? "drizzle");
        try {
          const profile = await readCatalogue(db);
          const signals = acquisitionProfile(profile.catalogue, profile.signals, profile.movies);
          const rounds = [];
          for (let index = 0; index < 2; index++) {
            const history = await readHistory(db, recentSelectionLimit);
            const initial = index === 0 ? profile : await readCatalogue(db);
            const timer = performance.now();
            const input = { ...criteria, mood: "surprise" as const, selectionCategory: category };
            const { state, blocked, report } = await acquireTonight(db, initial, input, history.recent,
              history.round, options.date, options.client, tonightDefaults, { strategy });
            const milliseconds = Math.round(performance.now() - timer);
            const trace = diagnoseRecommendation(state.catalogue, state.signals, input, history.recent,
              { referenceDate, excludedIds: blocked }, tonightAffinityModel, tonightRanking, tonightDefaults, selectionSize);
            await saveRecommendation(db, input, { ...trace.result, connection: report.connection }, options.date.toISOString());

            const identities = new Map(state.movies.map(({ id, tmdbId }) => [id, tmdbId === null ? `local:${id}` : `tmdb:${tmdbId}`]));
            const previous = new Set(initial.catalogue.map(({ id }) => id));
            const newFilms = state.catalogue.filter(({ id }) => !previous.has(id));
            const newIds = new Set(newFilms.map(({ id }) => id));
            const scores = new Map(trace.base.map(({ id, affinity, score }) => [id, { affinity: affinity.score, score }]));
            const out = trace.exclusions.filter(({ id }) => newIds.has(id));
            const admissible = new Set(out.filter(({ causes }) =>
              !Object.entries(causes).some(([cause, applies]) => cause !== "periodLimit" && applies)).map(({ id }) => id));
            const tmdbIds = new Set(state.movies.flatMap(({ id, tmdbId }) => admissible.has(id) && tmdbId !== null ? [tmdbId] : []));
            const yields = report.sources.map(({ kind, ids, parameters }) => ({
              kind: kind ?? "general", parameters,
              admissible: new Set(ids?.filter((id) => tmdbIds.has(id))).size,
            }));
            const rawIds = report.sources.reduce((sum, { forwarded }) => sum + forwarded, 0);
            const exclusions: Record<string, number> = {};
            for (const row of out) {
              for (const [reason, applies] of Object.entries(row.causes)) {
                if (applies) exclusions[reason] = (exclusions[reason] ?? 0) + 1;
              }
            }
            rounds.push({
              milliseconds, report, yields, newFilms: newFilms.length, admissible: admissible.size,
              affinities: newFilms.flatMap(({ id }) => admissible.has(id) ? [scores.get(id)!.affinity] : []).sort((a, b) => a - b),
              exclusions, duplicates: rawIds && report.discovered.length ? 1 - report.discovered.length / rawIds : null,
              diversity: {
                directors: distinct(newFilms.flatMap(({ metadata }) => metadata.directors)),
                countries: distinct(newFilms.flatMap(({ metadata }) => metadata.countries)),
                decades: distinct(newFilms.flatMap(({ year }) => decadeOf(year) ?? [])),
              },
              selected: trace.result.films.map(({ id, title, year }) => ({ id, key: identities.get(id)!, title, year, ...scores.get(id), acquired: newIds.has(id) })),
            });
          }
          return { strategy, catalogue: profile.catalogue.length, signals: profile.signals.length,
            profileSources: { directors: signals.directors.length, keywords: signals.keywords.length }, rounds };
        } finally {
          close();
        }
      });
      arms.push(result);
    }
    results.push({ category, arms });
  }
  return { format: "after-dark-acquisition-v1", engineVersion, referenceDate, criteria, results };
}

type Comparison = Awaited<ReturnType<typeof compareAcquisition>>;

export function acquisitionMarkdown(comparison: Comparison, network: boolean) {
  const affinity = (values: number[]) => values.length ? values[Math.floor(values.length / 2)].toFixed(2) : "—";
  return [
    "# Acquisition des candidats", "",
    `Moteur ${comparison.engineVersion} · ${comparison.referenceDate} · ${network ? "requêtes TMDB réelles" : "mode hors ligne"}`, "",
    ...comparison.results.slice(0, 1).map(({ arms: [arm] }) =>
      `Instantané de ${arm.catalogue} films et ${arm.signals} signaux. Sources exploitables : ${arm.profileSources.directors} réalisateurs et ${arm.profileSources.keywords} mots-clés.`), "",
    "| Catégorie | Stratégie | Séance | Discover / détails | IDs distincts | Doublons | Nouveaux / admissibles | Affinité médiane | Vivier après rotation | Diversité réal. / pays / décennies | Durée | Arrêt |",
    "| --- | --- | ---: | --- | ---: | ---: | --- | ---: | --- | --- | ---: | --- |",
    ...comparison.results.flatMap(({ category, arms }) => arms.flatMap(({ strategy, rounds }) => rounds.map((row, index) => {
      const { pool, discovered, connection } = row.report;
      return `| ${selectionCategories[category]} | ${strategy} | ${index + 1} | ${pool?.discoveryRequests} / ${pool?.detailRequests} | ${discovered.length} | ${row.duplicates === null ? "—" : (row.duplicates * 100).toFixed(0) + " %"} | ${row.newFilms} / ${row.admissible} | ${affinity(row.affinities)} | ${pool?.before.afterRotation} → ${pool?.after.afterRotation} | ${row.diversity.directors} / ${row.diversity.countries} / ${row.diversity.decades} | ${row.milliseconds} ms | ${pool?.stop} (${connection}) |`;
    }))), "",
    "## Titres, rotation et exclusions", "",
    ...comparison.results.flatMap(({ category, arms: [baseline, profile] }) => [
      `### ${selectionCategories[category]}`, "",
      ...baseline.rounds.flatMap((before, index) => {
        const after = profile.rounds[index];
        const old = new Set(before.selected.map(({ key }) => key));
        const current = new Set(after.selected.map(({ key }) => key));
        const titles = (rows: typeof before.selected) => rows.map(({ title, year, acquired }) =>
          `${cell(title)} (${year ?? "—"})${acquired ? " [acquis]" : ""}`).join(" · ") || "—";
        const exclusions = (reasons: Record<string, number>) => Object.entries(reasons).map(([name, value]) => `${name} ${value}`).join(", ") || "—";
        const renewal = (rounds: typeof baseline.rounds) => rounds[1].selected.filter(({ id }) => !rounds[0].selected.some((film) => film.id === id)).length;
        return [
          `- Séance ${index + 1}, référence. ${titles(before.selected)}.`,
          `- Séance ${index + 1}, profil. ${titles(after.selected)}.`,
          `- Entrants avec la stratégie profil. ${titles(after.selected.filter(({ key }) => !old.has(key)))}.`,
          `- Sortants avec la stratégie profil. ${titles(before.selected.filter(({ key }) => !current.has(key)))}.`,
          `- Exclusions des nouvelles fiches, référence / profil. ${exclusions(before.exclusions)} / ${exclusions(after.exclusions)}.`,
          ...(index === 1 ? [`- Titres renouvelés entre les séances, référence / profil. ${renewal(baseline.rounds)} / ${renewal(profile.rounds)}.`] : []),
          "",
        ];
      }),
    ]),
    "## Méthode et limites", "",
    "Chaque bras et chaque catégorie partent d’une copie du même instantané. La seconde séance hérite de la rotation et des fiches de la première. Les causes d’exclusion se cumulent. Le vivier comptabilise les films avant le quota de composition final. Un candidat peut être attribué à plusieurs flux. Le taux de doublons compare les identifiants distincts aux résultats transmis par les flux.", "",
    "Le budget de détail est identique. Le tableau quantifie les appels logiques Discover et détail ainsi que les temps observés, client et SQLite compris. En cas de limitation, le client peut refuser un appel logique sans l’envoyer. Les réponses et latences réelles de TMDB peuvent varier. La date de référence fixe les critères locaux. Le volume, l’affinité calculée et les retours utilisateur mesurent des choses différentes.", "",
  ].join("\n");
}

export async function writeAcquisitionAudit(options: { sqlite: string; date: string; output: string; network?: boolean; criteria?: unknown }) {
  const date = new Date(options.date + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== options.date) {
    throw new Error("Date de référence invalide.");
  }
  const output = await reportDirectory(options.output, true);
  const client = options.network ? await localTmdb(dirname(options.sqlite)) : undefined;
  if (options.network && !client) throw new TmdbError("unauthorized");
  const comparison = await withSnapshotFile(options.sqlite, (snapshot) =>
    compareAcquisition({ snapshot, date, criteria: options.criteria, client: async () => client }));
  const write = (name: string, data: string) => writeFile(join(output, name), data, { flag: "wx", mode: 0o600 });
  await write("acquisition-audit.md", acquisitionMarkdown(comparison, !!options.network));
  await write("acquisition-audit.json", JSON.stringify(comparison, null, 2) + "\n");
}
