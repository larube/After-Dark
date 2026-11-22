import { useRef, useState, type FormEvent } from "react";
import type { Criteria, Recommendation } from "../shared/recommendation";
import { FilterPanel, MoodSelector } from "./controls";
import { readCriteria } from "./criteria";
import { Results } from "./results";

export function Tonight({ ready, onComplete }: { ready: boolean; onComplete: () => void }) {
  const [mood, setMood] = useState<Criteria["mood"]>("surprise");
  const [result, setResult] = useState<Recommendation>();
  const [submitted, setSubmitted] = useState<Criteria>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const resultsHeading = useRef<HTMLHeadingElement>(null);

  async function request(criteria: Criteria, allowRecent = false) {
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError("");
    try {
      const reply = await window.afterDark.recommend(criteria, allowRecent);
      if (reply.ok) {
        setResult(reply.data);
        setSubmitted(criteria);
        const heading = resultsHeading.current;
        if (heading?.getClientRects().length) {
          heading.focus({ preventScroll: true });
          heading.scrollIntoView({ block: "nearest" });
        }
        onComplete();
      } else setError(reply.error);
    } catch {
      setError("Impossible de charger les propositions.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = readCriteria(new FormData(event.currentTarget), mood);
    if (!parsed.success) {
      setError("Vérifiez la durée (1 à 600 min) et les codes pays ou langue (deux lettres, séparés par des virgules).");
      return;
    }
    void request(parsed.data);
  }

  return <>
    <header className="hero">
      <div className="projection" aria-hidden="true" />
      <h1>Ce soir<span> ?</span></h1>
      <p>Éteins la lumière. Quel film pour ton humeur&nbsp;?</p>
    </header>
    <form className="programme" onSubmit={submit}>
      <MoodSelector value={mood} onChange={setMood} busy={loading} />
      <FilterPanel busy={loading} />
      <button className="button button-primary" disabled={loading || !ready}>
        {loading ? "Recherche en cours…" : "Trouve-moi un film"} <span aria-hidden="true">↗</span>
      </button>
    </form>
    <Results headingRef={resultsHeading} result={result} loading={loading} ready={ready} error={error} repeat={(allowRecent) => {
      if (submitted) void request(submitted, allowRecent);
    }} />
  </>;
}
