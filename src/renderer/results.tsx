import { useState, type ReactNode, type Ref } from "react";
import type { Recommendation } from "../shared/recommendation";
import { FilmFranchise } from "./franchises";
import { AllocineLink } from "./allocine";

const regions = new Intl.DisplayNames(["fr"], { type: "region" });
const connections: Record<Recommendation["connection"], string> = {
  online: "Catalogue actualisé avec TMDB.",
  cached: "Métadonnées du catalogue local.",
  unconfigured: "TMDB est sans jeton. Recherche dans le catalogue local.",
  offline: "TMDB est inaccessible. Recherche dans le catalogue local.",
  limited: "Limite TMDB atteinte. Recherche dans le catalogue local.",
  unauthorized: "Jeton TMDB refusé ou configuration invalide. Recherche dans le catalogue local.",
  unavailable: "TMDB rencontre une erreur. Recherche dans le catalogue local.",
};
const empty = {
  empty: ["Le catalogue est vide", "Importez un profil contenant des films à découvrir ou configurez TMDB."],
  "no-match": ["Aucun film compatible", "Vous pouvez assouplir vos filtres et relancer la recherche."],
  exhausted: ["Propositions récentes épuisées", "Les films compatibles ont déjà été proposés récemment."],
} as const;

function RecommendationCard({ film, actions, image }: {
  film: Recommendation["films"][number]; actions: ReactNode; image?: string;
}) {
  const { title, year, metadata, posterData = image, reasons: [reason, ...otherReasons], warnings, franchise } = film;
  const [skipped, setSkipped] = useState(false);
  return <article className={skipped ? "film-card film-card-skipped" : "film-card"}>
    <div className="poster-mount">
      {posterData ? <img className="poster" src={posterData} alt="" /> :
        <div className="poster poster-empty"><span aria-hidden="true">◈</span><span>Affiche indisponible</span></div>}
    </div>
    <div className="film-copy">
      <div hidden={skipped}>
        <h3>{title}</h3>
        {(year || metadata.minutes) && <p className="film-meta">{[year,
          metadata.minutes ? `${metadata.minutes} min` : undefined].filter(Boolean).join(" · ")}</p>}
        {reason && <p className="film-reason">{reason}</p>}
        {warnings.map((warning, index) => <p key={index} className="warning">{warning}</p>)}
        {actions}
      </div>
      {skipped && <p className="film-skipped-label" role="status"><strong>{title}</strong> · Mis de côté pour cette sélection</p>}
      <button type="button" className="text-action film-skip"
        aria-label={skipped ? `Annuler « Pas ce soir » pour ${title}` : `Pas ce soir · ${title}`}
        onClick={() => setSkipped(!skipped)}>
        <span aria-hidden="true">{skipped ? "↶" : "–"}</span> {skipped ? "Annuler « Pas ce soir »" : "Pas ce soir"}
      </button>
      <div hidden={skipped} className="film-secondary">
        <details className="film-details">
          <summary>Détails du film</summary>
          {metadata.countries.length > 0 && <p className="film-meta">{metadata.countries.map((code) => regions.of(code)).join(", ")}</p>}
          {metadata.synopsis && <p className="synopsis">{metadata.synopsis}</p>}
          {otherReasons.length > 0 && <ul>{otherReasons.map((item, index) => <li key={index}>{item}</li>)}</ul>}
          <AllocineLink title={title} year={year} />
        </details>
        {franchise && <FilmFranchise movieId={film.id} franchise={franchise} />}
      </div>
    </div>
  </article>;
}

export function Results({ headingRef, result, posters, selectionNumber, loading, ready, error, repeat, filmActions }: {
  headingRef?: Ref<HTMLHeadingElement>; result?: Recommendation; posters?: Record<number, string>; selectionNumber?: number; loading: boolean; ready: boolean; error: string; repeat: (allowRecent: boolean) => void;
  filmActions: (film: Recommendation["films"][number], loading: boolean) => ReactNode;
}) {
  return <section className="results" aria-labelledby="results-heading">
    <header className="results-header">
      <h2 id="results-heading" ref={headingRef} tabIndex={-1}>À l’affiche</h2>
      <p role="status" className="live-status">
        {loading ? "Recherche en cours…" : result ? connections[result.connection] : ""}
      </p>
    </header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {loading && <div className="loading-bar" aria-hidden="true" />}
    {result && <div aria-busy={loading}>
      {!result.personalized && <p className="profile-note">Votre profil a encore peu de signaux exploitables. La sélection s’appuie sur le catalogue et vos critères.</p>}
      {result.status !== "ready" && <div className="empty"><h3>{empty[result.status][0]}</h3><p>{empty[result.status][1]}</p></div>}
      {result.films.length > 0 && <div className="film-list" key={selectionNumber}>
        <div className="featured">
          <RecommendationCard key={result.films[0].id} film={result.films[0]} image={posters?.[result.films[0].id]} actions={filmActions(result.films[0], loading)} />
        </div>
        {result.films.length > 1 && <ol className="alternatives" start={2} aria-label="Propositions suivantes">
          {result.films.slice(1).map((film) => <li key={film.id}>
            <RecommendationCard film={film} image={posters?.[film.id]} actions={filmActions(film, loading)} />
          </li>)}
        </ol>}
      </div>}
      {result.status !== "empty" && <div className="actions">
        <button className="button" type="button" disabled={loading || !ready} onClick={() => repeat(false)}>Autres propositions</button>
        {result.status === "exhausted" && <button className="button button-quiet" type="button" disabled={loading || !ready}
          onClick={() => repeat(true)}>Revoir des propositions récentes</button>}
      </div>}
    </div>}
  </section>;
}
