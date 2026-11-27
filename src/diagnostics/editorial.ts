import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { movieTitles } from "../db/schema";
import { affinityDetails, buildAffinity, catalogueFrequency, uniqueFeatures } from "../domain/affinity";
import { classifyContent } from "../domain/candidate-quality";
import { normalizeTitle } from "../domain/ratings";
import { previousGenreEngineVersion, previousEditorialEngineVersion, tonightAffinityModel } from "../domain/recommendation";
import { matchesSelectionGenre, previousEditorialPolicy, type EditorialExperiment } from "../domain/selection-category";
import { criteriaSchema, selectionCategories, type Criteria } from "../shared/recommendation";
import { reportDirectory, withLocalSnapshot } from "./cli";
import { auditSelection, readRecentEntries, readSelectionSnapshot, selectionMarkdown } from "./selection";

const targets = [
  ["Joyeux Halloween, Scooby-Doo !", "Happy Halloween, Scooby-Doo!"],
  ["Scooby-Doo ! Sur l'île aux zombies", "Scooby-Doo on Zombie Island"],
  ["Cure", "Kyua"],
  ["The Witch", "The VVitch: A New-England Folktale"],
  ["The Host", "Gwoemul", "Les Âmes vagabondes"],
];

type Snapshot = Awaited<ReturnType<typeof readSelectionSnapshot>>;
type Category = "classics" | "gems";
type Preset = { category: Category; name: string; experiment: EditorialExperiment };

export const editorialVariants: Preset[] = [
  ...(["current", "admit", "half", "none", "no-decade"] as const).flatMap((period) =>
    [1, 0.75, 0.5, 0.25].map((bonusScale) => ({
      category: "classics" as const, name: `${period} / ${bonusScale * 100}%`, experiment: { classics: { period, bonusScale } },
    }))),
  ...[1, 0.9, 0.8, 0.7, null].map((minimumAffinity) => ({
    category: "gems" as const, name: minimumAffinity === null ? "Sans seuil éditorial" : `Seuil ${minimumAffinity}`,
    experiment: { gems: { minimumAffinity } },
  })),
  { category: "gems", name: "Sans seuil éditorial, affinité ×2 au classement", experiment: { gems: { minimumAffinity: null, affinityScale: 2 } } },
];

const overlap = <T extends { id: number }>(a: T[], b: { id: number }[]) => {
  const ids = new Set(b.map(({ id }) => id));
  return a.filter(({ id }) => ids.has(id)).length;
};

export function compareEditorial(snapshot: Snapshot, criteria: Criteria, date: string, aliases: { movieId: number; title: string }[], recentEntries: number[]) {
  const baseline = auditSelection(snapshot, criteria, date, { experiment: previousEditorialPolicy, engineVersion: previousEditorialEngineVersion });
  const variants = editorialVariants.map(({ category, name, experiment }) => {
    const options = { category, experiment, recentEntries, engineVersion: previousEditorialEngineVersion };
    const { reports: [report] } = auditSelection(snapshot, criteria, date, options);
    const original = baseline.reports.find((row) => row.category === category)!;
    const changed = <T extends { id: number }>(next: T[], previous: { id: number }[]) => {
      const ids = new Set(previous.map(({ id }) => id));
      return next.filter(({ id }) => !ids.has(id));
    };
    return { category, experiment, name, report,
      entrantCandidates: changed(report.candidates ?? [], original.candidates ?? []).sort((a, b) => b.affinity - a.affinity || a.id - b.id),
      selectedIn: changed(report.selected, original.selected), selectedOut: changed(original.selected, report.selected),
      unrotatedIn: changed(report.withoutRotation, original.withoutRotation),
      unrotatedOut: changed(original.withoutRotation, report.withoutRotation),
      overlap: baseline.reports.filter((row) => row.category !== category).map((row) => ({ category: row.category,
        rotated: overlap(report.selected, row.selected), unrotated: overlap(report.withoutRotation, row.withoutRotation) })),
    };
  });

  const traits = buildAffinity(snapshot.signals, undefined, true);
  const frequency = catalogueFrequency(snapshot.catalogue);
  const sources = new Map<string, { title: string; year: number | null; value: number }[]>();
  for (const signal of snapshot.signals) {
    for (const [id, { sum }] of buildAffinity([signal], undefined, true)) {
      const entries = sources.get(id) ?? [];
      entries.push({ title: signal.film.title, year: signal.film.year, value: sum });
      sources.set(id, entries);
    }
  }
  const names = new Map<number, Set<string>>();
  for (const { movieId, title } of aliases) {
    const namesForFilm = names.get(movieId) ?? new Set<string>();
    namesForFilm.add(normalizeTitle(title));
    names.set(movieId, namesForFilm);
  }
  const movies = new Map(snapshot.movies.map((movie) => [movie.id, movie]));
  const horror = baseline.reports.find(({ category }) => category === "horror")!;
  const affinity = targets.map(([label, ...alternative]) => {
    const keys = [label, ...alternative].map(normalizeTitle);
    const matches = snapshot.catalogue.filter((film) => {
      const original = movies.get(film.id)?.originalTitle;
      const filmTitles = [normalizeTitle(film.title), ...(original ? [normalizeTitle(original)] : []), ...names.get(film.id) ?? []];
      return keys.some((key) => filmTitles.includes(key));
    }).map((film) => {
      const { raw, score, matches } = affinityDetails(film, traits, tonightAffinityModel, frequency);
      const movie = movies.get(film.id);
      return {
        title: film.title, year: film.year, tmdbId: movie?.tmdbId ?? null, raw, score,
        metadata: { genres: film.metadata.genres, directors: film.metadata.directors, countries: film.metadata.countries,
          keywords: film.metadata.keywords, reputation: film.metadata.reputation ?? null },
        unmatched: uniqueFeatures(film.metadata).filter(({ id }) => !traits.has(id)).map(({ label }) => label),
        matches: matches.map((match) => ({ ...match, sources: sources.get(match.id) ?? [] })),
        horrorGenre: matchesSelectionGenre(film, "horror"), seen: film.status === "seen", dismissed: !!film.dismissed,
        blocked: snapshot.excludedIds.has(film.id), recent: snapshot.recent.has(film.id),
        contentReasons: classifyContent(film.metadata, date).exclusionReasons,
        selectedHorror: horror.selected.some(({ id }) => id === film.id),
      };
    });
    return { label, matches };
  });
  return { version: "editorial-calibration-v1", baseline, variants, affinity };
}

type Comparison = ReturnType<typeof compareEditorial>;
const n = (value: number | null | undefined) => value == null ? "—" : value.toFixed(3);
const escape = (value: string) => value.replace(/[&<>|]/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "|": "&#124;" })[char]!).replace(/\s+/g, " ");
const titles = (entries: { title: string; affinity: number }[]) =>
  entries.map(({ title, affinity }) => `${escape(title)} (${n(affinity)})`).join(" · ") || "—";

export function editorialMarkdown({ version, baseline, variants, affinity }: Comparison) {
  const classic = variants.find(({ name }) => name === "admit / 25%")!;
  const gems = variants.find(({ name }) => name === "Seuil 0.8")!;
  const originalClassic = baseline.reports.find(({ category }) => category === "classics")!;
  const originalGems = variants.find(({ name }) => name === "Seuil 1")!;
  return [
    "# Calibration éditoriale · PR27", "",
    `${version} · moteur ${baseline.engineVersion} · ${baseline.referenceDate} · ${baseline.catalogue} films · ${baseline.signals} sources de signaux · ${baseline.recent} films en rotation.`, "",
    `Les six catégories hors calibration restent sur leur politique de production. Horreur dispose de ${baseline.reports.find(({ category }) => category === "horror")?.withRotation} candidats après rotation.`, "",
    "Toutes les variantes utilisent le même instantané privé. Le classement personnalisé, le seuil général de pertinence, les exclusions, l’exposition et la réputation de Pépites restent fixes. Les médianes sont les médianes basses, comme en PR26.", "",
    ...(["classics", "gems"] as const).flatMap((category) => {
      const original = baseline.reports.find((row) => row.category === category)!;
      return [
        `## ${selectionCategories[category]}`, "",
        `**Production avec rotation** · ${titles(original.selected)}`, "",
        `**Production sans rotation** · ${titles(original.withoutRotation)}`, "",
        "| Variante | Admissibles avant / après rotation | Affinité médiane du vivier | Proposés avec / sans rotation | Affinité médiane avec / sans rotation | Réputation standard médiane | Bonus de catégorie médian | Films communs avec / sans rotation | Filtre éditorial OK mais pertinence générale faible | Suivante (admissibles / proposés) |",
        "| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | --- |",
        ...variants.filter((variant) => variant.category === category).map(({ name, report }) => {
          const median = (key: string) => report.proposed.contributions.find(([k]) => k === key)?.[1].median;
          const unrotatedAffinity = report.withoutRotation.map(({ affinity }) => affinity).sort((a, b) => a - b);
          return `| ${name} | ${report.admissible.count} / ${report.withRotation} | ${n(report.admissible.affinity.median)} | ${report.selected.length} / ${report.withoutRotation.length} | ${n(report.proposed.affinity.median)} / ${n(unrotatedAffinity[Math.floor((unrotatedAffinity.length - 1) / 2)])} | ${n(median("reputation"))} | ${n(median("selectionCategory"))} | ${report.retained} | ${report.categoryPassedButWeak} | ${report.next?.admissible ?? "—"} / ${report.next?.selected.length ?? "—"} |`;
        }),
        ...variants.filter((variant) => variant.category === category).flatMap((variant) => {
          const { name, report, selectedIn, selectedOut, unrotatedIn, unrotatedOut, entrantCandidates, overlap } = variant;
          return ["", `### ${name}`, "",
            `- Décennies avec rotation · ${report.proposed.decades.map(([decade, count]) => `${decade} (${count})`).join(", ") || "—"}.`,
            `- Ordre avec rotation · ${titles(report.selected)}.`,
            `- Ordre sans rotation · ${titles(report.withoutRotation)}.`,
            `- Entrées / sorties avec rotation · ${titles(selectedIn)} / ${titles(selectedOut)}.`,
            `- Entrées / sorties sans rotation · ${titles(unrotatedIn)} / ${titles(unrotatedOut)}.`,
            `- ${entrantCandidates.length} candidats supplémentaires avant rotation · ${titles(entrantCandidates.slice(0, 10))}${entrantCandidates.length > 10 ? " (dix plus fortes affinités, liste complète dans le JSON)" : ""}.`,
            `- Films communs avec les listes de production des autres catégories (avec / sans rotation) · ${overlap.map((row) => `${selectionCategories[row.category]} ${row.rotated}/${row.unrotated}`).join(", ")}.`,
          ];
        }),
      ];
    }),
    "", "## Décomposition des cinq recherches de titres", "",
    "La recherche se fait par titre exact normalisé, titre original ou alias local. Les homonymes restent distincts. Valeur d’apprentissage = moyenne des votes transformés, plus les bonus de favoris. Les sommes et contributions proviennent du calcul de production. Le score est 4 × tanh(brut / 4). Les films sources et valeurs dérivées figurent ici uniquement dans le rapport privé.", "",
    ...affinity.flatMap(({ label, matches }) => [
      `### ${escape(label)}`, "",
      ...(matches.length ? matches.flatMap((film) => [
        `**${escape(film.title)} (${film.year ?? "—"}) · TMDB ${film.tmdbId ?? "—"}** · affinité ${n(film.score)}, somme brute ${n(film.raw)}.`, "",
        `Genres · ${film.metadata.genres.map(escape).join(", ") || "—"}. Réalisation · ${film.metadata.directors.map(escape).join(", ") || "—"}. Pays · ${film.metadata.countries.join(", ") || "—"}. Mots-clés · ${film.metadata.keywords.length}.`,
        `Attributs sans signal · ${film.unmatched.map(escape).join(", ") || "—"}.`,
        `Genre Horreur ${film.horrorGenre ? "oui" : "non"} · vu ${film.seen ? "oui" : "non"} · refus ${film.dismissed ? "oui" : "non"} · franchise bloquée ${film.blocked ? "oui" : "non"} · récent ${film.recent ? "oui" : "non"} · proposé en Horreur ${film.selectedHorror ? "oui" : "non"} · exclusions de contenu ${film.contentReasons.map(escape).join(", ") || "—"}.`, "",
        "| Trait | Contribution | Somme / signaux | Négatifs | Poids de base | Normalisation | Rareté | Fréquence | Confiance positive |",
        "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ...film.matches.map((match) => `| ${match.key} · ${escape(match.label)} | ${n(match.contribution)} | ${n(match.signalSum)} / ${match.signalCount} | ${match.negativeCount} | ${n(match.baseContribution)} | ${n(match.normalization)} | ${n(match.rarity)} | ${match.documentCount} | ${n(match.positiveConfidence)} |`),
        "", ...film.matches.map((match) => `- **${escape(match.label)}** · ${match.sources.map(({ title, year, value }) => `${escape(title)} (${year ?? "—"}, ${n(value)})`).join(" · ")}`), "",
      ]) : ["Aucune correspondance exacte dans cet instantané.", ""]),
    ]),
    "## Variantes à examiner à l’aveugle", "",
    `- **Cultes, admit / 25 %** · la médiane d’affinité avec rotation passe de ${n(originalClassic.proposed.affinity.median)} à ${n(classic.report.proposed.affinity.median)}. ${classic.selectedIn.length} titres entrent et ${classic.overlap.find(({ category }) => category === "personal")?.rotated} titres sont communs à Pour moi. Comparer au groupe de contrôle en examinant la représentativité des décennies et la légitimité éditoriale des titres.`,
    `- **Pépites, seuil 0,8** · ${originalGems.report.withRotation} → ${gems.report.withRotation} admissibles après rotation, ${originalGems.report.next?.selected.length} → ${gems.report.next?.selected.length} propositions à la deuxième sélection simulée, ${gems.selectedIn.length} entrées à la première. Comparer les réponses sur les nouveaux candidats avant de relâcher davantage le seuil.`,
    "", "## Limites", "",
    "La sélection suivante simulée préfixe les films proposés aux dernières entrées d’historique, puis tronque à 30 avant de dédupliquer, comme en production. Elle conserve le catalogue et les signaux fixes et n’inclut pas les acquisitions futures. La qualité subjective, le caractère culte et les erreurs de métadonnées nécessitent une revue humaine. Un seul profil et un seul instantané exposent au surajustement. Garder le moteur en production et valider les variantes à l’aveugle avant toute activation.", "",
  ].join("\n");
}

export async function writeEditorialAudit(options: { sqlite: string; output: string; date: string; criteria?: unknown; production?: boolean }) {
  const date = z.iso.date().parse(options.date);
  const criteria = criteriaSchema.parse(options.criteria ?? {
    mood: "surprise", preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [],
  });
  if (criteria.mood !== "surprise") throw new Error("Utilisez mood: surprise et les filtres communs aux catégories.");
  const files = await withLocalSnapshot(options.sqlite, async (db) => {
    const snapshot = await readSelectionSnapshot(db);
    const recentEntries = await readRecentEntries(db);
    if (options.production) {
      const { report, markdown } = compareEditorialProduction(snapshot, criteria, date, recentEntries);
      return {
        "editorial-production.md": markdown,
        "editorial-production.json": JSON.stringify(report, null, 2) + "\n",
        "selection-audit.md": selectionMarkdown(report.after),
      };
    }
    const report = compareEditorial(snapshot, criteria, date, await db.select().from(movieTitles), recentEntries);
    return {
      "editorial-calibration.md": editorialMarkdown(report),
      "editorial-calibration.json": JSON.stringify(report, null, 2) + "\n",
    };
  });
  const directory = await reportDirectory(options.output, true);
  for (const [name, body] of Object.entries(files)) {
    if (body !== undefined) await writeFile(join(directory, name), body, { flag: "wx", mode: 0o600 });
  }
}

export function compareEditorialProduction(snapshot: Snapshot, criteria: Criteria, date: string, recentEntries: number[]) {
  const before = auditSelection(snapshot, criteria, date,
    { experiment: previousEditorialPolicy, engineVersion: previousEditorialEngineVersion, recentEntries });
  const after = auditSelection(snapshot, criteria, date, { recentEntries, engineVersion: previousGenreEngineVersion });
  const eligible = (rows: typeof after.reports[number]["candidates"]) => rows?.map(({ id }) => id);
  const signature = (row: typeof after.reports[number]) =>
    [eligible(row.candidates), row.withRotation, row.selected, row.withoutRotation, row.next, row.exclusions];
  const categories = (["classics", "gems"] as const).map((category) => {
    const historical = before.reports.find((row) => row.category === category)!;
    const production = after.reports.find((row) => row.category === category)!;
    const preset = editorialVariants.find((row) => row.category === category &&
      row.name === (category === "classics" ? "admit / 25%" : "Seuil 0.8"))!;
    const { reports: [experimental] } = auditSelection(snapshot, criteria, date,
      { category, experiment: preset.experiment, recentEntries });
    return { category, historical, production,
      matchesExperiment: JSON.stringify(signature(production)) === JSON.stringify(signature(experimental)) };
  });
  const lines = [
    "# Calibration éditoriale en production · PR28", "",
    `${previousEditorialEngineVersion} → ${previousGenreEngineVersion} · ${date} · ${after.catalogue} films · ${after.signals} sources de signaux.`, "",
    "Les deux moteurs utilisent le même instantané, les mêmes critères et le même historique, hors ligne.", "",
    "| Catégorie | Admissibles avant rotation | Admissibles après rotation | Affinité médiane avec rotation | Affinité médiane sans rotation | Sélection suivante (admissibles / proposés) | Variante PR27 reproduite |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  type Row = typeof after.reports[number];
  const median = ({ withoutRotation }: Row) =>
    withoutRotation.map(({ affinity }) => affinity).sort((a, b) => a - b)[Math.floor((withoutRotation.length - 1) / 2)];
  const next = (row: Row) => `${row.next?.admissible ?? 0} / ${row.next?.selected.length ?? 0}`;
  for (const { category, historical: a, production: b, matchesExperiment } of categories) {
    lines.push(`| ${selectionCategories[category]} | ${a.admissible.count} → ${b.admissible.count} | ${a.withRotation} → ${b.withRotation} | ${n(a.proposed.affinity.median)} → ${n(b.proposed.affinity.median)} | ${n(median(a))} → ${n(median(b))} | ${next(a)} → ${next(b)} | ${matchesExperiment ? "Oui" : "Écart détecté"} |`);
  }
  for (const { category, historical, production, matchesExperiment } of categories) {
    lines.push("", `## ${selectionCategories[category]}`, "",
      matchesExperiment ? "Les viviers, les exclusions et les listes avec et sans rotation et au tour suivant correspondent à la variante PR27." :
        "Les résultats diffèrent. Comparer les viviers, les exclusions et les sélections dans le JSON.", "");
    const tables = [
      { label: "Avec rotation", before: historical.selected, after: production.selected },
      { label: "Sans rotation", before: historical.withoutRotation, after: production.withoutRotation },
      { label: "Sélection suivante", before: historical.next?.selected ?? [], after: production.next?.selected ?? [] },
    ];
    for (const table of tables) {
      lines.push(`### ${table.label}`, "",
        `Entrées · ${titles(table.after.filter(({ id }) => !table.before.some((row) => row.id === id)))}.`,
        `Sorties · ${titles(table.before.filter(({ id }) => !table.after.some((row) => row.id === id)))}.`, "");
      for (const [label, films] of [["Avant", table.before], ["Après", table.after]] as const) {
        lines.push(`**${label}**`, "",
          "| Film | Affinité | Score de base | Contributions signées | Pénalité de diversité | Score de sélection |",
          "| --- | ---: | ---: | --- | ---: | ---: |",
          ...films.map((film) => `| ${escape(film.title)} | ${n(film.affinity)} | ${n(film.score)} | ${Object.entries(film.contributions).map(([key, value]) => `${key} ${n(value)}`).join(" · ")} | ${n(film.diversity)} | ${n(film.finalScore)} |`), "");
      }
    }
  }
  return { report: { version: "editorial-production-v1", before, after, categories }, markdown: lines.join("\n") };
}
