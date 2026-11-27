import type { ReactNode } from "react";

const navIcons = {
  tonight: <><path d="M3 10h18v10H3zM3 10 2 6l17-4 1 4z" /><path d="m5 5 3 3m3-4 3 3m3-4 3 3M6 14h6" /></>,
  collection: <><rect x="7" y="5" width="13" height="15" rx="1" /><path d="M16 5V3H4a1 1 0 0 0-1 1v13h4" /></>,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 3" /></>,
  lab: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2 6-6 2 2-6Z" /></>,
  profile: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2Z" /></>,
};

const pages = [
  ["tonight", "Sélection"], ["collection", "Ma collection"],
  ["history", "Historique"], ["lab", "Laboratoire"], ["profile", "Profil"],
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
      <p className="brand-caption">Le cinéma<br />après la nuit</p>
      <nav aria-label="Navigation principale">
        {pages.map(([id, name]) => <button key={id} type="button" aria-current={page === id ? "page" : undefined}
          onClick={() => navigate(id)}>
          <span className="nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" focusable="false">
              {navIcons[id]}
            </svg></span>{name}
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
