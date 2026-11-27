import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { selectionSize, type Criteria, type Recommendation, type SelectionCategory } from "../shared/recommendation";
import { CategorySelector, FilterPanel } from "./controls";
import { defaultFilters, readCriteria } from "./criteria";
import { Results } from "./results";

export function Tonight({ ready, onComplete, filmActions }: {
  ready: boolean; onComplete: () => void; filmActions: (film: Recommendation["films"][number], loading: boolean) => ReactNode;
}) {
  const [category, setCategory] = useState<SelectionCategory>("personal");
  const [filters, setFilters] = useState(defaultFilters);
  const [result, setResult] = useState<Recommendation>();
  const [selectionNumber, setSelectionNumber] = useState(0);
  const [posters, setPosters] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState<Criteria>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const resultsHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let current = true;
    for (const { id, metadata } of result?.films ?? []) {
      if (!metadata.poster) continue;
      void window.afterDark.recommendationPoster(id).then((reply) => {
        if (current && reply.ok && reply.data) {
          const data = reply.data;
          setPosters((previous) => ({ ...previous, [id]: data }));
        }
      }).catch(() => { /* Keep the placeholder when an image cannot be retrieved. */ });
    }
    return () => { current = false; };
  }, [result]);

  async function request(criteria: Criteria, allowRecent = false) {
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError("");
    try {
      const reply = await window.afterDark.recommend(criteria, allowRecent);
      if (reply.ok) {
        setSelectionNumber((number) => number + 1);
        setPosters({});
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
    const parsed = readCriteria(filters, category);
    if (!parsed.success) {
      setError("Les critères de séance sont invalides. Essayez de les réinitialiser.");
      return;
    }
    void request(parsed.data);
  }

  return <>
    <form className="programme" onSubmit={submit}>
      <header className="hero">
        <p className="hero-kicker">Votre séance personnelle</p>
        <h1>Sélection</h1>
        <p className="hero-intro">Choisissez l’envie du moment.<br />On s’occupe du reste.</p>
      </header>
      <CategorySelector value={category} onChange={setCategory} busy={loading} />
      <button className="button button-primary" type="submit" disabled={loading || !ready}>
        {loading ? "Recherche en cours…" : `Découvrir ${selectionSize} films`} <span aria-hidden="true">→</span>
      </button>
      <details className="selection-refine">
        <summary>Affiner</summary>
        <FilterPanel busy={loading} value={filters} onChange={setFilters} />
      </details>
    </form>
    <Results category={submitted?.selectionCategory} headingRef={resultsHeading} result={result} posters={posters} selectionNumber={selectionNumber} loading={loading} ready={ready} error={error} filmActions={filmActions} repeat={(allowRecent) => {
      if (submitted) void request(submitted, allowRecent);
    }} />
  </>;
}
