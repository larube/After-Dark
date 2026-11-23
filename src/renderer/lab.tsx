import { useEffect, useRef, useState } from "react";
import { labInterests, type LabAnswer, type LabResults, type LabState } from "../shared/lab";
import { moods, type Criteria } from "../shared/recommendation";

const criteriaFor = (mood: Criteria["mood"]): Criteria => ({
  mood, preferredCountries: [], preferredLanguages: [], requiredCountries: [], requiredLanguages: [],
});
const entries = Object.entries(moods) as [Criteria["mood"], string][];
const describe = (answer: LabAnswer) => answer.seen ? "Déjà vu" : labInterests[answer.interest];
const modelNames = { current: "Actuel", normalized: "Normalisé", rarity: "Rareté", hybrid: "Hybride" } as const;
const formatPercent = new Intl.NumberFormat("fr", { style: "percent" });

function LabSummary({ result }: { result: LabResults }) {
  return <section className="lab-summary" aria-labelledby="lab-summary-title">
    <h2 id="lab-summary-title">Après la projection</h2>
    <p>Ces réponses donnent des pistes sur vos envies. Il faut plusieurs séances pour comparer les modèles.</p>
    <p>{result.complete} {result.complete === 1 ? "séance terminée" : "séances terminées"} · {result.incomplete} non terminées</p>
    {result.latest && <>
      <h3>Dernière séance</h3>
      <p>{result.latest.covered} modèles sur 4 · {result.latest.collisions} films dans plusieurs sélections
        {result.latest.repeated > 0 && ` · ${result.latest.repeated} déjà proposés au Laboratoire`}</p>
      <ul className="lab-reviews">{result.latest.reviews.map(({ title, model, rank, answer }) =>
        <li key={model}><strong>{title}</strong><span>{describe(answer)}</span>
          <small>{modelNames[model]} · proposition n° {rank}</small>
          {answer.reason && <p>{answer.reason}</p>}</li>)}</ul>
    </>}
    {result.complete > 0 && <>
      <h3>Au fil des séances</h3>
      <p>L’intérêt positif regroupe « Très envie » et « Pourquoi pas » parmi les films que vous n’avez pas déjà vus.</p>
      <dl className="lab-totals">{result.models.map((row) => {
        const positive = row.eager + row.maybe;
        const unseen = positive + row.pass;
        const rated = unseen + row.seen;
        return <div key={row.model}>
          <dt>{modelNames[row.model]}</dt>
          <dd>{rated} {rated === 1 ? "réponse" : "réponses"} · {unseen ? formatPercent.format(positive / unseen) + " d’intérêt positif" : "Intérêt non mesuré"}</dd>
          <dd>{row.eager} très envie · {row.maybe} pourquoi pas · {row.pass} pas intéressé · {row.seen} déjà vus</dd>
        </div>;
      })}</dl>
    </>}
  </section>;
}

export function Laboratory({ collectionChanged }: { collectionChanged: () => Promise<void> }) {
  const [mood, setMood] = useState<Criteria["mood"]>("surprise");
  const [state, setState] = useState<LabState>();
  const [summary, setSummary] = useState<LabResults>();
  const [resumePrompt, setResumePrompt] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [transfer, setTransfer] = useState<LabResults["seenForCollection"][number]>();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const target = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void window.afterDark.labCurrent().then((result) => {
      if (!alive) return;
      if (!result.ok) setError(result.error);
      else {
        setState(result.data);
        setResumePrompt(result.data.status === "voting" || result.data.status === "ready");
      }
    }).catch(() => { if (alive) setError("Le Laboratoire est indisponible."); });
    return () => { alive = false; };
  }, []);

  async function run(operation: () => Promise<void>, focus = true) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      if (focus) requestAnimationFrame(() => target.current?.focus({ preventScroll: true }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’opération a échoué.");
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
  function unwrap<T>(reply: Reply<T>): T {
    if (!reply.ok) throw new Error(reply.error);
    return reply.data;
  }

  async function loadResults() {
    setSummary(unwrap(await window.afterDark.labResults()));
  }

  async function start(repeats: boolean) {
    setState(unwrap(await window.afterDark.labStart(criteriaFor(mood), repeats)));
  }

  async function pause(paused: boolean) {
    if (!state || !("sessionId" in state)) return;
    setState(unwrap(await window.afterDark.labPause(state.sessionId, paused)));
    setResumePrompt(false);
    setConfirmAbandon(false);
    if (paused) setReason("");
  }

  async function abandon() {
    if (!state || !("sessionId" in state)) return;
    setState(unwrap(await window.afterDark.labAbandon(state.sessionId)));
    setResumePrompt(false);
    setConfirmAbandon(false);
  }

  async function answer(choice: LabAnswer) {
    if (state?.status !== "voting") return;
    setState(unwrap(await window.afterDark.labAnswer(state.sessionId, state.position, { ...choice, reason })));
    setReason("");
  }

  async function finish() {
    if (state?.status !== "ready") return;
    unwrap(await window.afterDark.labFinish(state.sessionId));
    setState({ status: "idle" });
    await loadResults();
  }

  const progress = state && "sessionId" in state ? state : undefined;
  const interrupted = progress && (progress.status === "paused" || resumePrompt);
  return <section className="lab" aria-label="Laboratoire">
    <header className="page-heading lab-heading"><h1>Laboratoire</h1><p>Qu’est-ce qui vous donne envie de voir un film ? Explorez les propositions à l’aveugle.</p></header>
    {error && <p role="alert" className="notice error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="lab-stage" ref={target} tabIndex={-1} aria-busy={busy}>
      {summary ? <>
        <LabSummary result={summary} />
        {summary.seenForCollection.length > 0 && <section aria-labelledby="lab-transfer-title">
          <h3 id="lab-transfer-title">Visionnages à reporter dans Ma collection</h3>
          <ul className="lab-reviews">{summary.seenForCollection.map((item) => <li key={item.sessionId + ":" + item.position}>
            <strong>{item.title}{item.year && ` (${item.year})`}</strong>
            {transfer === item ? <>
              <p>Marquer ce film comme vu dans Ma collection ? Votre réponse au Laboratoire sera conservée.</p>
              <button className="button" disabled={busy} onClick={() => void run(async () => {
                unwrap(await window.afterDark.labTransferSeen(item.sessionId, item.position));
                setTransfer(undefined);
                await collectionChanged();
                await loadResults();
                setNotice("Visionnage ajouté à Ma collection.");
              })}>Confirmer le visionnage</button>
              <button className="lab-quiet" disabled={busy} onClick={() => setTransfer(undefined)}>Annuler</button>
            </> : <button className="button" disabled={busy} onClick={() => setTransfer(item)}>Reporter « Déjà vu »</button>}
          </li>)}</ul>
        </section>}
        <div className="lab-actions">
          <button className="button button-primary" disabled={busy} onClick={() => { setSummary(undefined); setTransfer(undefined); setNotice(""); }}>Retour au Laboratoire</button>
          <button className="button" disabled={busy} onClick={() => void run(async () => {
            if (unwrap(await window.afterDark.labExport()) === "saved") setNotice("Export JSON enregistré.");
          }, false)}>Exporter en JSON</button>
        </div>
      </> : interrupted ? <div className="lab-intro">
        <h2>Séance en cours</h2>
        <p>{progress.answered} réponse{progress.answered === 1 ? "" : "s"} sur {progress.total}. Vos réponses sont enregistrées.</p>
        <div className="lab-actions">
          {confirmAbandon ? <>
            <p>Une séance abandonnée ne peut plus être reprise. Ses réponses sont exclues du bilan.</p>
            <button className="button" disabled={busy} onClick={() => void run(abandon)}>Confirmer l’abandon</button>
            <button className="lab-quiet" disabled={busy} onClick={() => setConfirmAbandon(false)}>Annuler</button>
          </> : <>
            <button className="button button-primary" disabled={busy} onClick={() => void run(() => pause(false))}>Reprendre la séance</button>
            <button className="lab-quiet" disabled={busy} onClick={() => setConfirmAbandon(true)}>Abandonner la séance</button>
          </>}
        </div>
      </div> : state?.status === "voting" ? <article className="lab-proposal" aria-labelledby="lab-film">
        <div className="lab-poster">
          {state.film.posterData ? <img src={state.film.posterData} alt="" /> : <div className="lab-poster-placeholder" aria-hidden="true">◒</div>}
        </div>
        <div className="lab-proposal-body">
          <div className="lab-film-intro">
            <p className="lab-progress">Proposition {state.position} / {state.total}</p>
            <h2 id="lab-film">{state.film.title}</h2>
            {(state.film.year || state.film.minutes) && <p className="lab-meta">
              {[state.film.year, state.film.minutes ? state.film.minutes + " min" : null].filter(Boolean).join(" · ")}
            </p>}
            {state.film.synopsis && <p className="lab-synopsis">{state.film.synopsis}</p>}
          </div>
          <fieldset disabled={busy} className="lab-vote">
            <legend>Et vous, ça vous tente ?</legend>
            <label className="lab-reason">Une raison, si vous voulez
              <input maxLength={180} value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <div className="lab-options">
              {(Object.entries(labInterests) as [keyof typeof labInterests, string][]).map(([interest, label]) =>
                <button className="button" key={interest}
                  onClick={() => void run(() => answer({ seen: false, interest }))}>{label}</button>)}
              <button className="button" onClick={() => void run(() => answer({ seen: true }))}>Déjà vu</button>
            </div>
          </fieldset>
          <button className="lab-quiet" disabled={busy} onClick={() => void run(() => pause(true))}>Interrompre la séance</button>
        </div>
      </article> : state?.status === "ready" ? <div className="lab-intro">
        <h2>Toutes vos réponses sont enregistrées</h2>
        <p>Terminez la séance pour découvrir quels modèles ont proposé les films.</p>
        <div className="lab-actions">
          <button className="button button-primary" disabled={busy} onClick={() => void run(finish)}>Terminer et voir le bilan</button>
          <button className="lab-quiet" disabled={busy} onClick={() => void run(() => pause(true))}>Interrompre la séance</button>
        </div>
      </div> : state ? <div className="lab-intro">
        <fieldset className="lab-moods" disabled={busy}>
          <legend>Quelle humeur ce soir ?</legend>
          {entries.map(([id, label]) => <label key={id}>
            <input type="radio" name="lab-mood" checked={id === mood} onChange={() => { setMood(id); setState({ status: "idle" }); }} />
            <span>{label}</span>
          </label>)}
        </fieldset>
        <p>Jusqu’à quatre films, une réponse par film.</p>
        {state.status === "insufficient" && <p role="status">Le catalogue local ne permet pas une comparaison pour cette humeur. Essayez une autre humeur.</p>}
        {state.status === "no-new" && <p role="status">Aucune nouvelle proposition pour cette humeur. Vous pouvez revoir des films de séances récentes.</p>}
        <div className="lab-actions">
          <button className="button button-primary" disabled={busy} onClick={() => void run(() => start(state.status === "no-new"))}>
            {state.status === "no-new" ? "Lancer avec des films déjà proposés" : "Lancer la séance"}
          </button>
          <button className="button" disabled={busy} onClick={() => void run(loadResults)}>Consulter le bilan</button>
        </div>
      </div> : error ? <button className="button" disabled={busy} onClick={() => void run(async () => {
        const current = unwrap(await window.afterDark.labCurrent());
        setState(current);
        setResumePrompt(current.status === "voting" || current.status === "ready");
      })}>Réessayer</button> : <p role="status">Chargement du Laboratoire…</p>}
    </div>
  </section>;
}
