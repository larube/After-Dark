import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopApi, EnrichmentProgress, ImportReport, ProfileSummary } from "../shared/ipc";
import { AppShell, type Page } from "./shell";
import { CatalogueSummary, Enrichment, ImportFeedback } from "./library";
import type { FeedbackEntry, FeedbackRequest } from "../shared/feedback";
import { FeedbackCollection, FilmActions } from "./feedback";
import { Tonight } from "./tonight";
import "./style.css";

declare global {
  interface Window { afterDark: DesktopApi }
}

function App() {
  const [collection, setCollection] = useState<FeedbackEntry[]>();
  const [collectionError, setCollectionError] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const feedbackInFlight = useRef(false);
  const feedbackStatus = useRef<HTMLParagraphElement>(null);
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
    void refreshCollection();
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

  async function refreshCollection() {
    setCollectionError("");
    try {
      const reply = await window.afterDark.collection();
      if (reply.ok) setCollection(reply.data);
      else setCollectionError(reply.error);
    } catch {
      setCollectionError("Impossible de lire les retours enregistrés.");
    }
  }

  async function save(request: FeedbackRequest) {
    if (feedbackInFlight.current) throw new Error("Un enregistrement est déjà en cours.");
    feedbackInFlight.current = true;
    setSaving(true);
    setFeedbackMessage("");
    try {
      const reply = await window.afterDark.saveFeedback(request);
      if (!reply.ok) throw new Error(reply.error);
      setCollection((current) => {
        const entries = (current ?? []).filter((entry) => entry.movieId !== request.movieId);
        return reply.data ? [...entries, reply.data] : entries;
      });
      setFeedbackMessage(request.action === "seen" ? "Visionnage enregistré." :
        request.action === "undo_seen" ? "Marquage vu annulé." : request.intention === "none" ? "Intention retirée." : "Intention enregistrée.");
      if (page === "collection" && request.action !== "seen") {
        requestAnimationFrame(() => feedbackStatus.current?.focus({ preventScroll: true }));
      }
      await refreshSummary();
    } finally {
      feedbackInFlight.current = false;
      setSaving(false);
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
        await refreshCollection();
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
    <p className="feedback-live" role="status" tabIndex={-1} ref={feedbackStatus}>{feedbackMessage}</p>
    <div hidden={page !== "tonight"}>
      <Tonight ready={!!summary && !importing && !saving} onComplete={() => void refreshSummary()}
        filmActions={(film, loading) => <FilmActions movieId={film.id} title={film.title}
          entry={collection?.find((entry) => entry.movieId === film.id)}
          disabled={!collection || !!collectionError || importing || saving || loading} save={save} />} />
      <Enrichment progress={enrichment} />
    </div>
    {page === "collection" && <>
      <header className="page-heading"><h1>Ma collection</h1><p>Vos films enregistrés et vos favoris.</p></header>
      {collectionError && <button className="button" onClick={() => void refreshCollection()}>Recharger les retours</button>}
      <FeedbackCollection entries={collection} error={collectionError} disabled={importing || saving} save={save} />
      <CatalogueSummary summary={summary} />
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
      <button className="button button-primary" onClick={chooseProfile} disabled={!summary || importing || saving}>
        {importing ? "Import en cours…" : "Importer un profil"}
      </button>
      <ImportFeedback error={importError} cancelled={cancelled} report={report} />
      <Enrichment progress={enrichment} />
      <div className="library-section"><CatalogueSummary summary={summary} /></div>
    </>}
  </AppShell>;
}

createRoot(document.getElementById("root")!).render(<App />);
