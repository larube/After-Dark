import type { ReactNode } from "react";

const pages = [
  ["tonight", "Ce soir", "◒"], ["collection", "Ma collection", "▤"], ["discover", "Découvertes", "✧"],
  ["history", "Historique", "↶"], ["profile", "Profil", "◎"],
] as const;
export type Page = typeof pages[number][0];

function Credits({ className }: { className: string }) {
  return <footer className={className} aria-label="Crédits">
    <img src={import.meta.env.BASE_URL + "tmdb-logo.svg"} alt="TMDB" />
    <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
  </footer>;
}

export function AppShell({ page, navigate, status, children }: {
  page: Page; navigate: (page: Page) => void; status: string; children: ReactNode;
}) {
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand" aria-label="After Dark"><span aria-hidden="true">AFTER<br /><em>DARK</em></span></div>
      <nav aria-label="Navigation principale">
        {pages.map(([id, name, icon]) => <button key={id} type="button" aria-current={page === id ? "page" : undefined}
          onClick={() => navigate(id)}>
          <span aria-hidden="true">{icon}</span>{name}
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
