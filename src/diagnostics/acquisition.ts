import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openDatabase } from "../db/client";
import { readCatalogue, readHistory, saveRecommendation } from "../db/recommendations";
import { acquisitionPolicy } from "../domain/acquisition-policy";
import { acquisitionProfile } from "../domain/acquisition-profile";
import { diagnoseRecommendation, engineVersion, tonightAffinityModel, tonightRanking, type Film } from "../domain/recommendation";
import { decadeOf, tonightDefaults } from "../domain/tonight-preferences";
import { acquireTonight, type AcquisitionBudget } from "../main/acquire";
import { localTmdb } from "../main/recommend";
import { TmdbError, type TmdbClient } from "../main/tmdb";
import { criteriaSchema, recentSelectionLimit, selectionCategories, selectionSize, type SelectionCategory } from "../shared/recommendation";
import { reportDirectory, withSnapshotFile } from "./cli";

const strategies = ["baseline", "profile"] as const;
const categories = Object.keys(selectionCategories) as SelectionCategory[];
const neutral = { mood: "surprise", preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [] };
const cell = (value: string) => value.replace(/[|<>\n\r]/g, " ");
const distinct = (values: unknown[]) => new Set(values).size;

export const defaultAcquisitionSessions = 6;
const maxSessions = 20;

function sessionCount(value = defaultAcquisitionSessions) {
  if (!Number.isInteger(value) || value < 1 || value > maxSessions) throw new Error(`Choisissez entre 1 et ${maxSessions} séances.`);
  return value;
}

function diversity(films: Film[]) {
  return {
    directors: distinct(films.flatMap(({ metadata }) => metadata.directors)),
    countries: distinct(films.flatMap(({ metadata }) => metadata.countries)),
    decades: distinct(films.flatMap(({ year }) => decadeOf(year) ?? [])),
    languages: distinct(films.flatMap(({ metadata }) => metadata.language ?? [])),
    genres: distinct(films.flatMap(({ metadata }) => metadata.genres)),
  };
}

export async function compareAcquisition(options: {
  snapshot: string; date: Date; migrations?: string; criteria?: unknown;
  client: () => Promise<TmdbClient | undefined>; categories?: SelectionCategory[]; sessions?: number; budget?: AcquisitionBudget;
}) {
  const referenceDate = options.date.toISOString().slice(0, 10);
  const criteria = criteriaSchema.parse(options.criteria ?? neutral);
  const sessions = sessionCount(options.sessions);
  if (options.budget && (!Number.isInteger(options.budget.pages) || options.budget.pages < 1 ||
    options.budget.pages > acquisitionPolicy.discoveryRequests || !Number.isInteger(options.budget.details) ||
    options.budget.details < 1 || options.budget.details > acquisitionPolicy.details)) throw new Error("Budget TMDB invalide.");
  const results = [];
  for (const [categoryIndex, category] of (options.categories ?? categories).entries()) {
    const arms = [];
    // Alternate order to reduce a systematic advantage from time of observation.
    for (const strategy of categoryIndex % 2 ? [...strategies].reverse() : strategies) {
      const result = await withSnapshotFile(options.snapshot, async (copy) => {
        const { db, close } = await openDatabase(copy, options.migrations ?? "drizzle");
        try {
          const profile = await readCatalogue(db);
          const signals = acquisitionProfile(profile.catalogue, profile.signals, profile.movies);
          const rounds = [];
          const originalIds = new Set(profile.catalogue.map(({ id }) => id));
          const presented = new Set<number>();
          const acquired = new Map<number, Film>();
          const selected = new Map<number, Film>();
          let previousSelection: Set<number> | undefined;
          for (let index = 0; index < sessions; index++) {
            const history = await readHistory(db, recentSelectionLimit);
            const initial = index === 0 ? profile : await readCatalogue(db);
            const timer = performance.now();
            const input = { ...criteria, mood: "surprise" as const, selectionCategory: category };
            const { state, blocked, report } = await acquireTonight(db, initial, input, history.recent,
              history.round, options.date, options.client, tonightDefaults, { strategy, budget: options.budget });

            const trace = diagnoseRecommendation(state.catalogue, state.signals, input, history.recent,
              { referenceDate, excludedIds: blocked }, tonightAffinityModel, tonightRanking, tonightDefaults, selectionSize);
            await saveRecommendation(db, input, { ...trace.result, connection: report.connection }, options.date.toISOString());

            const milliseconds = Math.round(performance.now() - timer);
            const identities = new Map(state.movies.map(({ id, tmdbId }) => [id, originalIds.has(id) || tmdbId === null ? `local:${id}` : `tmdb:${tmdbId}`]));
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
            for (const film of newFilms) acquired.set(film.id, film);
            const selection = trace.result.films.map(({ id, title, year, metadata, reasons }) => ({
              id, key: identities.get(id)!, title, year, ...scores.get(id),
              genres: metadata.genres, directors: metadata.directors, synopsis: metadata.fullSynopsis ?? metadata.synopsis, reasons,
              origin: originalIds.has(id) ? "initial" as const : newIds.has(id) ? "acquired-now" as const : "acquired-earlier" as const,
              repeated: presented.has(id), recent: history.recent.has(id),
            }));
            for (const film of trace.result.films) {
              presented.add(film.id);
              selected.set(film.id, state.catalogue.find(({ id }) => id === film.id)!);
            }
            const newSincePrevious = previousSelection
              ? selection.filter(({ id }) => !previousSelection!.has(id)).length : null;
            previousSelection = new Set(selection.map(({ id }) => id));
            rounds.push({
              newSincePrevious, milliseconds, report, yields, newFilms: newFilms.length, admissible: admissible.size,
              affinities: newFilms.flatMap(({ id }) => admissible.has(id) ? [scores.get(id)!.affinity] : []).sort((a, b) => a - b),
              exclusions, duplicates: rawIds && report.discovered.length ? 1 - report.discovered.length / rawIds : null,
              diversity: diversity(newFilms), selectionDiversity: diversity([...selected.values()].filter(({ id }) => selection.some((film) => film.id === id))),
              selected: selection,
            });
          }
          return { strategy, catalogue: profile.catalogue.length, signals: profile.signals.length,
            profileSources: { directors: signals.directors.length, keywords: signals.keywords.length }, rounds,
            summary: summarizeAcquisition(rounds, diversity([...acquired.values()]), diversity([...selected.values()])),
          };
        } finally {
          close();
        }
      });
      arms.push(result);
    }
    const baseline = arms.find(({ strategy }) => strategy === "baseline")!;
    const profile = arms.find(({ strategy }) => strategy === "profile")!;
    results.push({ category, arms: [baseline, profile] as const, decision: acquisitionDecision(baseline.summary, profile.summary),
      differences: baseline.rounds.map(({ selected }, index) => {
        const other = profile.rounds[index].selected;
        return {
          profileOnly: other.filter(({ key }) => !selected.some((film) => film.key === key)),
          baselineOnly: selected.filter(({ key }) => !other.some((film) => film.key === key)),
        };
      }),
    });
  }
  const categoryCount = results.length;
  return { format: "after-dark-acquisition-v3", engineVersion, referenceDate, criteria, sessions, perSessionBudget: options.budget,
    budget: { maximumDiscover: categoryCount * sessions * (options.budget ? 2 * options.budget.pages : 4 + acquisitionPolicy.discoveryRequests),
      maximumDetails: categoryCount * sessions * 2 * (options.budget?.details ?? acquisitionPolicy.details) },
    results };
}

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted.length ? sorted[Math.floor(q * (sorted.length - 1))] : null;
  return { count: sorted.length, min: at(0), q1: at(0.25), median: at(0.5), q3: at(0.75), max: at(1) };
}

type MetricRound = {
  newSincePrevious: number | null; newFilms: number; admissible: number; milliseconds: number; affinities: number[];
  report: Awaited<ReturnType<typeof acquireTonight>>["report"];
  selected: { key: string; origin: "initial" | "acquired-now" | "acquired-earlier"; repeated: boolean; recent: boolean; affinity?: number }[];
};

function summarizeAcquisition(rounds: MetricRound[], newDiversity: ReturnType<typeof diversity>, selectionDiversity: ReturnType<typeof diversity>) {
  const sum = (value: (round: MetricRound) => number) => rounds.reduce((total, round) => total + value(round), 0);
  const discover = sum(({ report }) => report.pool?.discoveryRequests ?? 0);
  const details = sum(({ report }) => report.pool?.detailRequests ?? 0);
  const newAdmissible = sum(({ admissible }) => admissible);
  const selected = rounds.flatMap((round) => round.selected);
  const acquisitions = selected.filter(({ origin }) => origin !== "initial");
  const uniqueSelectedAcquisitions = new Set(acquisitions.map(({ key }) => key)).size;
  return {
    newFilms: sum((round) => round.newFilms), newAdmissible,
    selected: selected.length, selectedFromAcquisition: acquisitions.length, uniqueSelectedAcquisitions,
    renewedSincePrevious: sum((round) => round.newSincePrevious ?? 0),
    repeated: selected.filter((film) => film.repeated).length, recentSelected: selected.filter((film) => film.recent).length,
    eligibleHiddenByRotation: sum(({ report: { pool } }) => pool ? pool.after.beforeRotation - pool.after.afterRotation : 0),
    incomplete: rounds.filter((round) => round.selected.length < selectionSize).length,
    discover, details, requests: discover + details, milliseconds: sum((round) => round.milliseconds),
    costPerAdmissible: newAdmissible ? (discover + details) / newAdmissible : null,
    costPerSelectedAcquisition: uniqueSelectedAcquisitions ? (discover + details) / uniqueSelectedAcquisitions : null,
    yieldPerRequest: discover + details ? newAdmissible / (discover + details) : null,
    unavailable: rounds.filter(({ report }) => report.pool?.stop === "tmdb-unavailable").length,
    newAffinity: distribution(rounds.flatMap(({ affinities }) => affinities)),
    selectedAffinity: distribution(selected.flatMap(({ affinity }) => affinity === undefined ? [] : [affinity])),
    newDiversity, selectionDiversity,
  };
}

function acquisitionDecision(baseline: ReturnType<typeof summarizeAcquisition>, profile: ReturnType<typeof summarizeAcquisition>) {
  const fields = ["newFilms", "newAdmissible", "selected", "selectedFromAcquisition", "uniqueSelectedAcquisitions", "renewedSincePrevious", "repeated", "incomplete", "requests", "milliseconds"] as const;
  const delta = Object.fromEntries(fields.map((field) => [field, profile[field] - baseline[field]]));
  // Compare operational improvements without converting affinity or latency into a quality score.
  const directions = [delta.newAdmissible, delta.selected, -delta.repeated, -delta.incomplete, -delta.requests];
  const better = directions.some((value) => value > 0);
  const worse = directions.some((value) => value < 0);
  const verdict: "indecis" | "benefice" | "regression" = !baseline.requests || !profile.requests || baseline.unavailable || profile.unavailable || better === worse
    ? "indecis" : better ? "benefice" : "regression";
  return { delta, verdict, confidence: "exploratoire" as const,
    recommendation: verdict === "regression" ? "conserver_baseline" : "poursuivre_experimentation",
    qualitative: "non_evalue" as const,
  };
}

export type AcquisitionComparison = Awaited<ReturnType<typeof compareAcquisition>>;

export function acquisitionMarkdown(comparison: AcquisitionComparison, network: boolean) {
  const affinity = (values: number[]) => values.length ? values[Math.floor(values.length / 2)].toFixed(2) : "—";
  return [
    "# Acquisition des candidats", "",
    `Moteur ${comparison.engineVersion} · ${comparison.referenceDate} · ${network ? "requêtes TMDB réelles" : "mode hors ligne"}`, "",
    ...comparison.results.slice(0, 1).map(({ arms: [arm] }) =>
      `Instantané de ${arm.catalogue} films et ${arm.signals} signaux. Sources exploitables : ${arm.profileSources.directors} réalisateurs et ${arm.profileSources.keywords} mots-clés.`), "",
    `${comparison.sessions} séances par catégorie et stratégie. ${comparison.perSessionBudget ? `Plafond par bras et séance : ${comparison.perSessionBudget.pages} pages et ${comparison.perSessionBudget.details} détails. ` : ""}Plafond théorique cumulé : ${comparison.budget.maximumDiscover} pages Discover et ${comparison.budget.maximumDetails} détails.`, "",
    "## Bilan par catégorie", "",
    "| Catégorie | Stratégie | Nouveaux / admissibles | Propositions acquises / total | Répétées / déjà récentes / masquées par rotation | Séances incomplètes | Discover / détails | Admissibles par 100 appels | Appels par admissible / titre acquis distinct proposé | Durée |",
    "| --- | --- | --- | --- | --- | ---: | --- | ---: | --- | ---: |",
    ...comparison.results.flatMap(({ category, arms }) => arms.map(({ strategy, summary: s }) =>
      `| ${selectionCategories[category]} | ${strategy} | ${s.newFilms} / ${s.newAdmissible} | ${s.selectedFromAcquisition} / ${s.selected} | ${s.repeated} / ${s.recentSelected} / ${s.eligibleHiddenByRotation} | ${s.incomplete} | ${s.discover} / ${s.details} | ${s.yieldPerRequest === null ? "—" : (100 * s.yieldPerRequest).toFixed(1)} | ${s.costPerAdmissible?.toFixed(1) ?? "—"} / ${s.costPerSelectedAcquisition?.toFixed(1) ?? "—"} | ${s.milliseconds} ms |`)), "",
    "## Décision", "",
    "Décisions possibles par catégorie : conserver baseline, poursuivre l’expérimentation ou envisager une activation contrôlée. Le bilan technique propose seulement les deux premières. Le questionnaire séparé permet de recueillir des réponses humaines.", "",
    ...comparison.results.map(({ category, decision, arms }) => {
      const labels = { benefice: "bénéfice observé", regression: "régression", indecis: "résultat indécis" };
      const { delta, verdict } = decision;
      const [before, after] = arms.map(({ summary }) => summary);
      const small = Math.min(before.newAffinity.count, after.newAffinity.count);
      return `- **${selectionCategories[category]}** — ${labels[verdict]}. Écarts profil − référence : ${delta.newAdmissible} nouveaux admissibles, ${delta.selected} propositions, ${delta.incomplete} séances incomplètes, ${delta.repeated} répétitions et ${delta.requests} appels. Recommandation : ${decision.recommendation === "conserver_baseline" ? "conserver baseline" : "poursuivre l’expérimentation"}. Confiance exploratoire. Affinités de nouveaux admissibles : ${before.newAffinity.count} / ${after.newAffinity.count} observations${small < comparison.sessions ? " (échantillon limité)" : ""}.`;
    }), "",
    "Conserver baseline en production et poursuivre l’expérimentation. Le bilan par catégorie décrit des compromis opérationnels. Une activation nécessite aussi des retours utilisateur et une validation sur plusieurs instantanés.", "",
    "## Diversité et affinité", "",
    "| Catégorie | Stratégie | Réal. / décennies / langues / genres des acquis | Réal. / décennies / langues / genres des proposés | Affinité médiane acquis admissibles / proposés |",
    "| --- | --- | --- | --- | --- |",
    ...comparison.results.flatMap(({ category, arms }) => arms.map(({ strategy, summary }) => {
      const describe = ({ directors, decades, languages, genres }: ReturnType<typeof diversity>) => `${directors} / ${decades} / ${languages} / ${genres}`;
      return `| ${selectionCategories[category]} | ${strategy} | ${describe(summary.newDiversity)} | ${describe(summary.selectionDiversity)} | ${summary.newAffinity.median?.toFixed(2) ?? "—"} / ${summary.selectedAffinity.median?.toFixed(2) ?? "—"} |`;
    })), "",
    "## Détail des séances", "",
    "| Catégorie | Stratégie | Séance | Discover / détails | IDs distincts | Doublons | Nouveaux / admissibles | Affinité médiane | Vivier après rotation | Diversité réal. / pays / décennies | Durée | Arrêt |",
    "| --- | --- | ---: | --- | ---: | ---: | --- | ---: | --- | --- | ---: | --- |",
    ...comparison.results.flatMap(({ category, arms }) => arms.flatMap(({ strategy, rounds }) => rounds.map((row, index) => {
      const { pool, discovered, connection } = row.report;
      return `| ${selectionCategories[category]} | ${strategy} | ${index + 1} | ${pool?.discoveryRequests} / ${pool?.detailRequests} | ${discovered.length} | ${row.duplicates === null ? "—" : (row.duplicates * 100).toFixed(0) + " %"} | ${row.newFilms} / ${row.admissible} | ${affinity(row.affinities)} | ${pool?.before.afterRotation} → ${pool?.after.afterRotation} | ${row.diversity.directors} / ${row.diversity.countries} / ${row.diversity.decades} | ${row.milliseconds} ms | ${pool?.stop} (${connection}) |`;
    }))), "",
    "## Titres, rotation et exclusions", "",
    ...comparison.results.flatMap(({ category, arms: [baseline, profile], differences }) => [
      `### ${selectionCategories[category]}`, "",
      ...baseline.rounds.flatMap((before, index) => {
        const after = profile.rounds[index];
        const { profileOnly, baselineOnly } = differences[index];
        const titles = (rows: typeof before.selected) => rows.map(({ title, year, origin }) =>
          `${cell(title)} (${year ?? "—"})${origin === "initial" ? "" : origin === "acquired-now" ? " [acquis cette séance]" : " [acquis auparavant]"}`).join(" · ") || "—";
        const exclusions = (reasons: Record<string, number>) => Object.entries(reasons).map(([name, value]) => `${name} ${value}`).join(", ") || "—";
        return [
          `- Séance ${index + 1}, référence. ${titles(before.selected)}.`,
          `- Séance ${index + 1}, profil. ${titles(after.selected)}.`,
          `- Entrants avec la stratégie profil. ${titles(profileOnly)}.`,
          `- Sortants avec la stratégie profil. ${titles(baselineOnly)}.`,
          `- Exclusions des nouvelles fiches, référence / profil. ${exclusions(before.exclusions)} / ${exclusions(after.exclusions)}.`,
          `- Renouvellement depuis la séance précédente, référence / profil. ${before.newSincePrevious ?? "—"} / ${after.newSincePrevious ?? "—"}.`,
          `- Répétitions depuis le début du bras, référence / profil. ${before.selected.filter((film) => film.repeated).length} / ${after.selected.filter((film) => film.repeated).length}.`,
          "",
        ];
      }),
    ]),
    "## Méthode et limites", "",
    "Chaque bras et chaque catégorie partent d’une copie du même instantané. Chaque séance hérite de la rotation et des fiches du même bras. Les films répétés comptent les réapparitions depuis le début du bras. Les candidats masqués par rotation sont cumulés par séance. Les propositions acquises incluent les acquisitions de séances antérieures. Les causes d’exclusion se cumulent. Le vivier comptabilise les films avant le quota de composition final. Un candidat peut être attribué à plusieurs flux. Le taux de doublons compare les identifiants distincts aux résultats transmis par les flux.", "",
    "Sous plafond commun, la référence conserve ses deux à quatre flux disponibles et la variante exploite sa réserve dans la limite fixée. Aucun bras ne remplit artificiellement le budget. Le tableau quantifie les appels logiques Discover et détail ainsi que les temps observés, client et SQLite compris. En cas de limitation, le client peut refuser un appel logique sans l’envoyer. Les réponses et latences réelles de TMDB peuvent varier. La date de référence fixe les critères locaux. Le volume, l’affinité calculée et les retours utilisateur mesurent des choses différentes. Le verdict repose sur les variations du volume admissible, des propositions, des répétitions, des séances incomplètes et des requêtes. Des variations en sens opposés ou une indisponibilité réseau donnent un résultat indécis. Les identifiants de réalisateurs absents du cache limitent la couverture de ce flux.", "",
  ].join("\n");
}

export async function writeAcquisitionAudit(options: { sqlite: string; date: string; output: string; network?: boolean; criteria?: unknown; sessions?: number; pages?: number[]; details?: number; categories?: SelectionCategory[] }) {
  const date = new Date(options.date + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== options.date) {
    throw new Error("Date de référence invalide.");
  }
  const output = await reportDirectory(options.output, true);
  const client = options.network ? await localTmdb(dirname(options.sqlite)) : undefined;
  if (options.network && !client) throw new TmdbError("unauthorized");
  if (options.pages && (!options.pages.length || new Set(options.pages).size !== options.pages.length ||
    options.pages.some((page) => !Number.isInteger(page) || page < 1 || page > acquisitionPolicy.discoveryRequests))) {
    throw new Error("Plafonds Discover invalides ou dupliqués.");
  }
  if (options.categories && (!options.categories.length || new Set(options.categories).size !== options.categories.length ||
    options.categories.some((category) => !Object.hasOwn(selectionCategories, category)))) throw new Error("Catégories invalides ou dupliquées.");
  await withSnapshotFile(options.sqlite, async (snapshot) => {
    for (const pages of options.pages ?? [undefined]) {
      const budget = pages === undefined ? undefined : { pages, details: options.details ?? acquisitionPolicy.details };
      const comparison = await compareAcquisition({ snapshot, date, criteria: options.criteria, sessions: options.sessions,
        categories: options.categories, budget, client: async () => client });
      const suffix = pages === undefined ? "" : `-pages-${pages}`;
      const write = (extension: string, data: string) =>
        writeFile(join(output, `acquisition-audit${suffix}.${extension}`), data, { flag: "wx", mode: 0o600 });
      await write("md", acquisitionMarkdown(comparison, !!options.network));
      await write("json", JSON.stringify({ ...comparison, network: !!options.network }, null, 2) + "\n");
    }
  });
}
