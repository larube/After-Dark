import type { ReactNode } from "react";

const pages = [
  ["tonight", "Sélection", null], ["collection", "Ma collection", "▤"],
  ["history", "Historique", "↶"], ["lab", "Laboratoire", "✦"], ["profile", "Profil", "◎"],
] as const;
export type Page = typeof pages[number][0];

function Credits({ className }: { className: string }) {
  return <footer className={className} aria-label="Crédits">
    <img src={import.meta.env.BASE_URL + "tmdb-logo.svg"} alt="TMDB" />
    <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
  </footer>;
}

export function AppShell({ page, navigate, status, ratingCount = 0, children }: {
  page: Page; navigate: (page: Page) => void; status: string; ratingCount?: number; children: ReactNode;
}) {
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand" aria-label="After Dark"><span aria-hidden="true">AFTER<br /><em>DARK</em></span></div>
      <nav aria-label="Navigation principale">
        {pages.map(([id, name, icon]) => <button key={id} type="button" aria-current={page === id ? "page" : undefined}
          onClick={() => navigate(id)}>
          <span className="nav-icon" aria-hidden="true">{id === "tonight" ?
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" focusable="false">
              <rect x="2.5" y="9.5" width="13" height="10" rx="1.5" />
              <circle cx="6.5" cy="6" r="3.5" />
              <circle cx="13" cy="6.5" r="3" />
              <path d="m15.5 13 5.5-3v9l-5.5-3" />
            </svg> : icon}</span>{name}
          {id === "collection" && ratingCount > 0 && <small className="rating-count" aria-label={`${ratingCount} à noter`}>{ratingCount}</small>}
        </button>)}
      </nav>
      <div className="sidebar-footer">
        <p className="database-status" role="status">{status}</p>
        <Credits className="credits" />
      </div>
    </aside>
    <main id="app-content">{children}<Credits className="credits credits-narrow" /></main>
  </div>;
}
