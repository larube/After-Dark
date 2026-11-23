import { moods } from "../shared/recommendation";
import { type Report, compareReports } from "./report";

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const decimal = (value: number | null) => value === null ? "—" : value.toFixed(4);
const table = (headers: string[], rows: string[][]) => `<div class="scroll" tabindex="0" role="region" aria-label="${escape(headers.join(", "))}"><table><thead><tr>${headers.map((head) => `<th scope="col">${escape(head)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const details = (label: string, content: string) => `<details><summary>${escape(label)}</summary>${content}</details>`;
const json = (data: unknown) => `<pre>${escape(JSON.stringify(data, null, 2))}</pre>`;

const categoryNames = { safe: "Valeur sûre", gem: "Pépite", wildcard: "Wildcard" };
const causeNames = { seen: "Déjà vu", dismissed: "Refus explicite", blocked: "Exclusion du profil", weakEvidence: "Indices insuffisants", periodMismatch: "Exception de période insuffisamment étayée", periodLimit: "Limite d’exceptions de période", country: "Pays", language: "Langue", duration: "Durée", content: "Politique de séance", recent: "Historique récent" };
const scenarioNames: Record<string, string> = {
  ...moods, duration: "Durée maximale", country: "Pays de production", language: "Langue originale",
  avoid: "Ambiance à éviter", combined: "Contraintes combinées",
};
const typeNames: Record<string, string> = {
  feature_film: "Long métrage", short_film: "Court métrage", concert: "Concert",
  stage_performance: "Spectacle filmé", other_special: "Programme spécial", tv_program: "Programme ou épisode TV", tv_movie: "Téléfilm", unknown: "Inconnu", future_release: "Sortie future",
};
const components = {
  affinity: "Affinité", mood: "Humeur", country: "Pays préféré", language: "Langue préférée",
  energy: "Énergie", avoided: "Ambiance évitée", exploration: "Exploration", reputation: "Réputation TMDB", period: "Période", animation: "Animation",
} as const;

export function renderReport(report: Report, comparison?: ReturnType<typeof compareReports>) {
  const titles = new Map(report.catalogue.films.map(({ id, title }) => [id, `${title} (#${id})`]));
  const title = (id: number) => titles.get(id) ?? `#${id}`;
  const sections = report.scenarios.map((scenario) => {
    const selected = scenario.result.films.map((film, index) => {
      const step = scenario.steps[index].ranking[0];
      return [String(index + 1), title(film.id), categoryNames[film.category], decimal(step.bonus),
        decimal(step.penalty), decimal(step.score), typeNames[scenario.discovery[index].type], [...film.reasons, ...film.warnings].join(" ")];
    });
    const base = scenario.base.map((row) => [String(row.rank), title(row.id), decimal(row.score),
      ...Object.keys(components).map((key) => decimal(row.contributions[key as keyof typeof components]))]);
    const exclusions = scenario.exclusions.filter(({ excluded }) => excluded).map(({ id, causes }) => [
      title(id), Object.keys(causeNames).filter((key) => causes[key as keyof typeof causes]).map((key) => causeNames[key as keyof typeof causeNames]).join(", "),
    ]);
    const affinities = scenario.base.flatMap(({ id, affinity }) => affinity.matches.map((match) => [
      title(id), match.key, match.label, String(match.signalCount), decimal(match.contribution), decimal(affinity.raw), decimal(affinity.score),
    ]));
    const lists = scenario.steps.map(({ category, ranking }, index) => details(`${index + 1}. ${categoryNames[category]}`,
      table(["Rang", "Film", "Bonus", "Pénalité", "Score de sélection"], ranking.map(({ rank, id, bonus, penalty, score }) =>
        [String(rank), title(id), decimal(bonus), decimal(penalty), decimal(score)])))).join("");
    return `<section id="s-${escape(scenario.id)}"><h2>${escape(scenarioNames[scenario.id])}</h2>
      <p>${report.catalogue.total} films · ${scenario.eligibleBeforePolicy} admissibles avant la politique · ${scenario.eligible} après la politique et avant l’historique · ${scenario.removedByRecent} écartés à cette étape · ${selected.length} proposés</p>
      ${details("Critères", json(scenario.criteria))}
      ${table(["Décennie", "Candidats après historique", "Admissibles avant composition", "Proposés"],
        Object.entries(scenario.decades.candidates).map(([decade, count]) => [
          decade === "unknown" ? "Inconnue" : decade, String(count),
          String(scenario.decades.selectable[decade] ?? 0), String(scenario.decades.selected[decade] ?? 0),
        ]))}
      ${table(["Choix", "Film", "Catégorie", "Bonus", "Pénalité", "Score final", "Type de contenu", "Justifications de production"], selected)}
      ${details("Décomposition des scores avant diversité", table(["Rang", "Film", "Base", ...Object.values(components)], base))}
      ${details("Qualité des candidats",
        `<p>${scenario.content.uncertain} classifications incertaines dans le catalogue.</p>` +
        table(["Type", "Dans le catalogue", "Retirés du pool admissible"], Object.entries(scenario.content.distribution).map(([type, count]) =>
          [typeNames[type], String(count), String(scenario.content.exclusionsByType[type])])) +
        table(["Cause cumulable", "Retirés du pool admissible"], Object.entries(scenario.content.exclusionsByReason).map(([reason, count]) =>
          [typeNames[reason], String(count)])) +
        table(["Film", "Type", "Décision de la politique", "Indices", "Champs manquants"],
          scenario.exclusions.filter(({ id, causes }) => causes.content || scenario.content.retainedUnknown.includes(id))
            .map(({ id, quality, causes }) => [title(id), typeNames[quality.category],
              causes.content ? quality.exclusionReasons.map((reason) => typeNames[reason]).join(", ") : "Inconnu conservé avant historique",
              quality.evidence.join(", "), quality.missing.join(", ")])))}
      ${details("Affinités par trait", table(["Film", "Trait", "Valeur", "Signaux", "Contribution", "Affinité brute", "Affinité bornée"], affinities))}
      ${details("Classements et scores à chaque choix", lists)}
      ${details("Candidats exclus", table(["Cause", "Films"], Object.entries(scenario.counts).map(([key, count]) => [causeNames[key as keyof typeof causeNames], String(count)])) +
        table(["Film", "Causes cumulables"], exclusions))}
      ${details("Diversité et exploration",
        table(["Dimension", "Valeurs distinctes", "Films sans valeur"], Object.entries(scenario.diversity.dimensions).map(([key, value]) =>
          [key, String(value.distinct), String(value.missing)])) +
        table(["Catégorie", "Films"], Object.entries(scenario.diversity.categories).map(([key, value]) => [categoryNames[key as keyof typeof categoryNames], String(value)])) +
        table(["Paire", "Genres", "Réalisateurs", "Pays", "Langues", "Mots-clés"], scenario.diversity.overlap.map(({ ids, shared }) =>
          [ids.map(title).join(" / "), ...["genres", "directors", "countries", "language", "keywords"].map((key) => shared[key].join(", ") || "—")])) +
        table(["Film", "Popularité TMDB", "Sous la médiane locale"], scenario.discovery.map(({ id, popularity, belowCatalogueMedian }) =>
          [title(id), popularity === null ? "Manquante" : String(popularity), belowCatalogueMedian === null ? "—" : belowCatalogueMedian ? "Oui" : "Non"])))}
      </section>`;
  }).join("");
  const holdout = report.holdout;
  const comparisonSection = comparison ? `<section id="comparison"><h2>Comparaison</h2>
    <p>Moteur ${escape(comparison.engine.before)} → ${escape(comparison.engine.after)}. Empreinte des entrées identique. Date UTC ${escape(report.policy.referenceDate)}.</p>
    ${comparison.affinityModel.before === comparison.affinityModel.after ? "" :
      `<p>Affinité ${escape(comparison.affinityModel.before)} → ${escape(comparison.affinityModel.after)}.</p>`}
    ${table(["Scénario", "Classements ou scores modifiés", "Admissibles", "Part inconnue", "Sélection de référence", "Sélection actuelle"],
      comparison.scenarios.map((run) => [scenarioNames[run.id], String(run.changes.length),
        `${run.eligibility.before} → ${run.eligibility.after}`,
        `${decimal(run.content.before.unknownShare)} → ${decimal(run.content.after.unknownShare)}`,
        run.selection.before.map(({ id, category }) => `${title(id)} · ${categoryNames[category]}`).join(", "),
        run.selection.after.map(({ id, category }) => `${title(id)} · ${categoryNames[category]}`).join(", ")]))}
    ${table(["Mesure", "Référence", "Actuel"], [
      ["Cibles admissibles / cibles totales", ...[comparison.holdout.before, comparison.holdout.after].map((run) => `${run.eligibleTargets}/${run.targets}`)],
      ["Recall@5", decimal(comparison.holdout.before.recallAt5), decimal(comparison.holdout.after.recallAt5)],
      ["NDCG@5", decimal(comparison.holdout.before.ndcgAt5), decimal(comparison.holdout.after.ndcgAt5)],
    ])}
    ${comparison.scenarios.map((run) => details(scenarioNames[run.id],
      (run.changes.length ? json(run.changes) : "<p>Aucun changement de rang, de score ou de sélection.</p>") +
      (run.exclusionsChanged ? details("Changements d’exclusion", json(run.exclusionChanges)) : "") +
      (JSON.stringify(run.diversity.before) === JSON.stringify(run.diversity.after) ? "" : details("Mesures de diversité", json(run.diversity))) +
      (JSON.stringify(run.discovery.before) === JSON.stringify(run.discovery.after) ? "" : details("Mesures de découverte", json(run.discovery))))).join("")}
    </section>` : "";
  return `<!doctype html>
<html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>After Dark · Diagnostic du moteur</title>
<style>
:root{color-scheme:dark;background:#171310;color:#f1e5ce;font:16px system-ui,sans-serif}body{max-width:85rem;margin:auto;padding:1.5rem}
h1,h2{font-family:Georgia,serif;line-height:1.05}h1{font-size:clamp(2.5rem,8vw,5rem);margin:.25em 0}
a,summary,.brand{color:#ffad80}a:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid #ffad80;outline-offset:3px}
nav{display:flex;flex-wrap:wrap;gap:.7rem 1.1rem}section{border-top:1px solid #82604a;margin-top:2rem;padding-top:1rem}
details{margin:.7rem 0;padding:.6rem;border:1px solid #604b3d}summary{cursor:pointer}
.scroll,pre{overflow:auto}table{border-collapse:collapse;width:100%;text-align:left;margin:.7rem 0}th,td{padding:.55rem;border-bottom:1px solid #604b3d;vertical-align:top}
th{background:#33251d}code{overflow-wrap:anywhere}p{line-height:1.55}.brand{text-transform:uppercase;letter-spacing:.12em}
</style>
<header><p class="brand">After Dark</p><h1>Diagnostic du moteur</h1><p>Format ${report.formatVersion} · moteur ${escape(report.engineVersion)}${report.affinityModel ? " · affinité expérimentale " + escape(report.affinityModel) : ""} · date UTC ${escape(report.policy.referenceDate)}<br><code>${escape(report.fingerprint)}</code></p></header>
<nav aria-label="Sections"><a href="#catalogue">Catalogue</a>${report.scenarios.map(({ id }) =>
    `<a href="#s-${escape(id)}">${escape(scenarioNames[id])}</a>`).join("")}<a href="#holdout">Hors échantillon</a>${comparison ? '<a href="#comparison">Comparaison</a>' : ""}</nav>
<main><section id="catalogue"><h2>Catalogue et métadonnées</h2><p>${report.catalogue.total} films, ${report.catalogue.signals} films sources de signaux, ${report.catalogue.popularity.known} popularités TMDB renseignées. Médiane locale ${decimal(report.catalogue.popularity.median)}.</p>
<p>Les causes d’exclusion peuvent se cumuler. La popularité est un indicateur TMDB relatif à ce catalogue. Elle ne mesure ni la qualité, ni la notoriété réelle, ni la rareté historique.</p>
${table(["Métadonnée", "Films sans valeur"], Object.entries(report.catalogue.missing).map(([key, value]) => [key, String(value)]))}
${details("Films du catalogue sous la médiane de popularité", table(["Film", "Popularité TMDB"], report.catalogue.popularity.belowMedian.map(({ id, value }) => [title(id), String(value)])))}</section>
${sections}
<section id="holdout"><h2>Évaluation hors échantillon</h2>
<p>${holdout.targets} films dont la moyenne des notes numériques atteint ${holdout.config.minimumRating}/10. Recall@5 moyen ${decimal(holdout.recallAt5)} · NDCG@5 moyen ${decimal(holdout.ndcgAt5)}. Couverture ${holdout.eligibleTargets}/${holdout.targets} cibles admissibles.</p>
<p>Les demi-points entrent dans la moyenne sans arrondi. Les films retenus sont retirés des signaux et de l’historique récent. Leur statut vu est neutralisé. La politique de séance continue de s’appliquer. Les cibles exclues restent au dénominateur. Le rang de base précède les bonus de catégorie et la diversité. Ces résultats décrivent le protocole sur ce catalogue.</p>
${holdout.folds.map((fold) => details(`Échantillon ${fold.index} · Recall@5 ${decimal(fold.recallAt5)} · NDCG@5 ${decimal(fold.ndcgAt5)}`,
    `<p>${fold.trainingSignals} films sources de signaux · ${fold.rankedCandidates} candidats classés · Sélection ${escape(fold.selected.map(title).join(", "))}</p>` +
      table(["Film apprécié", "Notes", "Moyenne", "Rang de base", "Rang dans les cinq", "Exclusions"], fold.targets.map((row) =>
        [title(row.id), row.numeric.join(", "), String(row.mean), String(row.baseRank ?? "—"), String(row.selectedRank ?? "—"), row.exclusions.map((reason) => typeNames[reason]).join(", ")])))).join("")}</section>
${comparisonSection}</main></html>\n`;
}
