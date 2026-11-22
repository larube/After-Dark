import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopApi, ImportReport, ProfileSummary } from "../shared/ipc";
import "./style.css";

declare global {
  interface Window { afterDark: DesktopApi }
}

const metrics = [
  ["movies", "Films enregistrés"], ["seen", "Films vus"],
  ["evaluated", "Films évalués"], ["unseen", "Films explicitement non vus"],
] as const;

function App() {
  const [summary, setSummary] = useState<ProfileSummary>();
  const [databaseError, setDatabaseError] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport>();
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    async function loadSummary() {
      try {
        const result = await window.afterDark.summary();
        if (result.ok) setSummary(result.data);
        else setDatabaseError(result.error);
      } catch {
        setDatabaseError("Impossible de lire l’état de la base locale.");
      }
    }
    void loadSummary();
  }, []);

  async function chooseProfile() {
    setImporting(true);
    setImportError("");
    setReport(undefined);
    setCancelled(false);
    try {
      const result = await window.afterDark.importProfile();
      if (!result.ok) setImportError(result.error);
      else if (result.data.status === "cancelled") setCancelled(true);
      else {
        setReport(result.data.report);
        setSummary(result.data.summary);
      }
    } catch {
      setImportError("Impossible de terminer l’import.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-7 py-9">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">After Dark</h1>
        <button className="rounded-md bg-violet-200 px-4 py-2 font-medium text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-200 disabled:opacity-50"
          onClick={chooseProfile} disabled={!summary || importing}>
          {importing ? "Import en cours…" : "Importer un profil"}
        </button>
      </header>
      <p className="mt-3 text-zinc-400" role="status">
        {databaseError ? "Base locale indisponible" : summary ? "Base locale prête" : "Ouverture de la base locale…"}
      </p>
      {databaseError && <p className="mt-2 text-rose-200" role="alert">{databaseError}</p>}
      {summary && (
        <>
          <dl className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {metrics.map(([key, label]) => (
              <div key={key} className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
                <dt className="text-sm text-zinc-300">{label}</dt>
                <dd className="mt-2 text-2xl tabular-nums">{summary[key]}</dd>
              </div>
            ))}
          </dl>
          {summary.movies === 0 && <p className="mt-4 text-zinc-300">Importez un profil JSON pour commencer.</p>}
          <section className="mt-7" aria-labelledby="favorites">
            <h2 id="favorites" className="text-xl font-semibold">Favoris</h2>
            {summary.favorites.length === 0
              ? <p className="mt-2 text-zinc-400">Aucun favori spontané enregistré.</p>
              : <ul className="mt-2 divide-y divide-zinc-800">
                {summary.favorites.map(({ id, title, year }) => <li className="py-2" key={id}>{title}{year !== null && ` (${year})`}</li>)}
              </ul>}
          </section>
        </>
      )}
      {importError && <p className="mt-5 text-rose-200" role="alert">{importError}</p>}
      {cancelled && <p className="mt-5 text-zinc-300" role="status">Import annulé.</p>}
      {report && (
        <section className="mt-7 border-t border-zinc-700 pt-4" aria-labelledby="report" aria-live="polite">
          <h2 id="report" className="text-xl font-semibold">Résultat de l’import</h2>
          <p className="mt-2 text-zinc-300">
            {report.created} créée(s), {report.updated} mise(s) à jour, {report.duplicates} inchangée(s), {report.ambiguities.length} ambiguïté(s), {report.errors.length} erreur(s).
          </p>
          {[...report.ambiguities, ...report.errors].map(({ entry, path, message }, index) => (
            <p className="mt-2 text-amber-200" key={index}>{[entry && `Entrée ${entry}`, path, message].filter(Boolean).join(" · ")}</p>
          ))}
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
