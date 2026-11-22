import type { EnrichmentProgress, ImportReport, ProfileSummary } from "../shared/ipc";

const metrics = [
  ["movies", "Films enregistrés"], ["seen", "Films vus"],
  ["evaluated", "Films évalués"], ["unseen", "Explicitement non vus"],
] as const;

const enrichmentMessages: Record<EnrichmentProgress["status"], string> = {
  waiting: "En attente", working: "En arrière-plan", complete: "Terminé", unconfigured: "Jeton TMDB requis",
  offline: "Reprise au retour du réseau", limited: "Pause demandée par TMDB",
  unauthorized: "Vérifiez le jeton TMDB", unavailable: "TMDB indisponible, reprise automatique",
};

export function CatalogueSummary({ summary }: { summary?: ProfileSummary }) {
  if (!summary) return null;
  return <>
    <dl className="metrics">{metrics.map(([key, label]) => <div key={key}>
      <dt>{label}</dt><dd>{summary[key]}</dd>
    </div>)}</dl>
    <section className="library-section">
      <h2>Favoris</h2>
      {summary.favorites.length === 0
        ? <p className="muted">Aucun favori spontané enregistré.</p>
        : <ul className="favorites">{summary.favorites.map(({ id, title, year }) =>
          <li key={id}>{title}{year !== null && <span>{year}</span>}</li>)}</ul>}
    </section>
  </>;
}

export function Enrichment({ progress }: { progress?: EnrichmentProgress }) {
  if (!progress?.total) return null;
  return <section className="enrichment" aria-label="Enrichissement TMDB">
    <h2>Enrichissement TMDB</h2>
    <progress aria-label="Films traités" max={progress.total} value={progress.enriched + progress.skipped} />
    <p>{progress.enriched} enrichi(s) sur {progress.total}
      {progress.skipped > 0 && ` · ${progress.skipped} sans rapprochement certain`}
      {progress.pending > 0 && ` · ${progress.pending} restant(s)`}
    </p>
    <p className="muted">{enrichmentMessages[progress.status]}</p>
  </section>;
}

export function ImportFeedback({ error, cancelled, report }: {
  error: string; cancelled: boolean; report?: ImportReport;
}) {
  return <>
    {error && <p className="notice error" role="alert">{error}</p>}
    {cancelled && <p className="notice" role="status">Import annulé.</p>}
    {report && <section className="notice" aria-live="polite">
      <h2>Résultat de l’import</h2>
      <p>{report.created} créée(s), {report.updated} mise(s) à jour, {report.duplicates} inchangée(s), {report.ambiguities.length} ambiguïté(s), {report.errors.length} erreur(s).</p>
      {[...report.ambiguities, ...report.errors].map(({ entry, path, message }, index) =>
        <p className="warning" key={index}>{[entry && `Entrée ${entry}`, path, message].filter(Boolean).join(" · ")}</p>)}
    </section>}
  </>;
}
