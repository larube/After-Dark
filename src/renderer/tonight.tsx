import { useRef, useState, type ReactNode, type FormEvent } from "react";
import type { Criteria, Recommendation } from "../shared/recommendation";
import { FilterPanel, MoodSelector } from "./controls";
import { defaultFilters, readCriteria } from "./criteria";
import { Results } from "./results";

export function Tonight({ ready, onComplete, filmActions }: {
  ready: boolean; onComplete: () => void; filmActions: (film: Recommendation["films"][number], loading: boolean) => ReactNode;
}) {
  const [mood, setMood] = useState<Criteria["mood"]>("surprise");
  const [filters, setFilters] = useState(defaultFilters);
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
          if (heading.getBoundingClientRect().top > window.innerHeight - 240) {
            heading.scrollIntoView({ block: "start" });
          }
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
    const parsed = readCriteria(filters, mood);
    if (!parsed.success) {
      setError("Les critères de séance sont invalides. Essayez de les réinitialiser.");
      return;
    }
    void request(parsed.data);
  }

  return <>
    <header className="hero">
      <div className="projection" aria-hidden="true" />
      <h1>Ce soir ?</h1>
      <p>Une envie, une ambiance.<br /> Le reste attendra.</p>
    </header>
    <form className="programme" onSubmit={submit}>
      <MoodSelector value={mood} onChange={setMood} busy={loading} />
      <FilterPanel busy={loading} value={filters} onChange={setFilters} action={
        <button className="button button-primary" type="submit" disabled={loading || !ready}>
          <span aria-hidden="true">▶</span> {loading ? "Recherche en cours…" : "Trouve-moi un film"}
        </button>
      } />
    </form>
    <Results headingRef={resultsHeading} result={result} loading={loading} ready={ready} error={error} filmActions={filmActions} repeat={(allowRecent) => {
      if (submitted) void request(submitted, allowRecent);
    }} />
  </>;
}
