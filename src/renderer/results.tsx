import type { ReactNode, Ref } from "react";
import type { Recommendation } from "../shared/recommendation";
import { AllocineLink } from "./allocine";

const regions = new Intl.DisplayNames(["fr"], { type: "region" });
const categories = { safe: "Valeur sûre", gem: "Pépite", wildcard: "Wildcard" };
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

function RecommendationCard({ film, featured, personalized, actions }: {
  film: Recommendation["films"][number]; featured: boolean; personalized: boolean; actions: ReactNode;
}) {
  const { title, year, metadata, posterData, category, reasons, warnings } = film;
  return <article className="film-card">
    <div className="poster-mount">
      {posterData ? <img className="poster" src={posterData} alt="" /> :
        <div className="poster poster-empty"><span aria-hidden="true">◈</span><span>Affiche indisponible</span></div>}
    </div>
    <div className="film-copy">
      <span className="badge" data-category={category}>{category === "safe" && !personalized ? "Choix du soir" : categories[category]}</span>
      <h3>{title}</h3>
      <p className="film-meta">{[
        year, metadata.countries.length ? metadata.countries.map((code) => regions.of(code)).join(", ") : "Pays inconnu",
        metadata.minutes ? `${metadata.minutes} min` : "Durée inconnue",
      ].filter(Boolean).join(" · ")}</p>
      {metadata.synopsis && <p className="synopsis">{metadata.synopsis}</p>}
      <AllocineLink title={title} year={year} />
      <details className="film-reasons" open={featured || undefined}><summary>Pourquoi ce film ?</summary>
        <ul>{reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
      </details>
      {warnings.map((warning, index) => <p key={index} className="warning">{warning}</p>)}
      {actions}
    </div>
  </article>;
}

export function Results({ headingRef, result, loading, ready, error, repeat, filmActions }: {
  headingRef?: Ref<HTMLHeadingElement>; result?: Recommendation; loading: boolean; ready: boolean; error: string; repeat: (allowRecent: boolean) => void;
  filmActions: (film: Recommendation["films"][number], loading: boolean) => ReactNode;
}) {
  return <section className="results" aria-labelledby="results-heading">
    <header className="results-header">
      <h2 id="results-heading" ref={headingRef} tabIndex={-1}>À l’affiche</h2>
      <p role="status" className="live-status">
        {loading ? "Recherche en cours…" : result ? connections[result.connection] : "Choisissez une humeur pour lancer la séance."}
      </p>
    </header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {loading && <div className="loading-bar" aria-hidden="true" />}
    {result && <div aria-busy={loading}>
      {!result.personalized && <p className="profile-note">Votre profil a encore peu de signaux exploitables. La sélection s’appuie sur votre humeur, vos critères et le catalogue.</p>}
      {result.status !== "ready" && <div className="empty"><h3>{empty[result.status][0]}</h3><p>{empty[result.status][1]}</p></div>}
      {result.films.length > 0 && <div className="film-list">
        <div className="featured">
          <RecommendationCard key={result.films[0].id} film={result.films[0]} actions={filmActions(result.films[0], loading)} featured personalized={result.personalized} />
        </div>
        {result.films.length > 1 && <ol className="alternatives" start={2} aria-label="Propositions suivantes">
          {result.films.slice(1).map((film) => <li key={film.id}>
            <RecommendationCard film={film} actions={filmActions(film, loading)} featured={false} personalized={result.personalized} />
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
