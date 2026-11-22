import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopApi, EnrichmentProgress, ImportReport, ProfileSummary } from "../shared/ipc";
import { AppShell, type Page } from "./shell";
import { CatalogueSummary, Enrichment, ImportFeedback } from "./library";
import { Tonight } from "./tonight";
import "./style.css";

declare global {
  interface Window { afterDark: DesktopApi }
}

function App() {
  const [page, setPage] = useState<Page>("tonight");
  const [enrichment, setEnrichment] = useState<EnrichmentProgress>();
  const [summary, setSummary] = useState<ProfileSummary>();
  const [databaseError, setDatabaseError] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport>();
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    void refreshSummary();
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function loadProgress() {
      try {
        const reply = await window.afterDark.enrichment();
        if (alive && reply.ok) setEnrichment(reply.data);
      } finally {
        if (alive) timer = setTimeout(() => void loadProgress().catch(() => undefined), 3000);
      }
    }
    void loadProgress().catch(() => undefined);
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  async function refreshSummary() {
    try {
      const result = await window.afterDark.summary();
      if (result.ok) {
        setDatabaseError("");
        setSummary(result.data);
      } else setDatabaseError(result.error);
    } catch {
      setDatabaseError("Impossible de lire l’état de la base locale.");
    }
  }

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

  function navigate(next: Page) {
    if (page === next) return;
    setPage(next);
    window.scrollTo(0, 0);
  }

  const status = databaseError ? "Base locale indisponible" : summary ? "Base locale prête" : "Ouverture de la base locale…";
  return <AppShell page={page} navigate={navigate} status={status}>
    {databaseError && <p className="notice error" role="alert">{databaseError}</p>}
    <div hidden={page !== "tonight"}>
      <Tonight ready={!!summary && !importing} onComplete={() => void refreshSummary()} />
      <Enrichment progress={enrichment} />
    </div>
    {page === "collection" && <>
      <header className="page-heading"><h1>Ma collection</h1><p>Vos films enregistrés et vos favoris.</p></header>
      <CatalogueSummary summary={summary} />
      <p className="notice">À venir · La liste détaillée des films.</p>
      <button className="button" onClick={() => navigate("profile")}>Importer un profil</button>
    </>}
    {page === "discover" && <>
      <header className="page-heading"><h1>Découvertes</h1><p>Retrouvez les propositions de votre séance dans « Ce soir ».</p></header>
      <p className="notice">À venir · Une vue dédiée aux découvertes.</p>
      <button className="button button-primary" onClick={() => navigate("tonight")}>Retour à Ce soir</button>
    </>}
    {page === "history" && <>
      <header className="page-heading"><h1>Historique</h1></header>
      <p className="notice">À venir · La consultation des recommandations passées.</p>
    </>}
    {page === "profile" && <>
      <header className="page-heading"><h1>Profil</h1><p>Votre profil cinéphile est enregistré sur ce Mac.</p></header>
      <button className="button button-primary" onClick={chooseProfile} disabled={!summary || importing}>
        {importing ? "Import en cours…" : "Importer un profil"}
      </button>
      <ImportFeedback error={importError} cancelled={cancelled} report={report} />
      <Enrichment progress={enrichment} />
      <div className="library-section"><CatalogueSummary summary={summary} /></div>
    </>}
  </AppShell>;
}

createRoot(document.getElementById("root")!).render(<App />);
