import { useEffect, useState } from "react";
import type { Franchise } from "../shared/franchises";

export function FranchisePreferences() {
  const [groups, setGroups] = useState<Franchise[]>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void window.afterDark.franchises(null, false).then((reply) => {
      if (!live) return;
      if (reply.ok) setGroups(reply.data);
      else setError(reply.error);
    }).catch(() => { if (live) setError("Impossible de lire les franchises."); });
    return () => { live = false; };
  }, []);

  async function update(group: Franchise) {
    setPending(true);
    setError("");
    try {
      const reply = await window.afterDark.setFranchise(null, group.key, !group.blocked);
      if (!reply.ok) throw new Error(reply.error);
      setGroups((entries) => entries?.map((entry) => entry.key === group.key ? { ...entry, blocked: !group.blocked } : entry)
        .filter((entry) => entry.blocked || entry.key === "harry-potter" || entry.key === "godzilla"));
    } catch {
      setError("Impossible de modifier cette exclusion.");
    } finally {
      setPending(false);
    }
  }

  return <section className="library-section">
    <h2>Franchises exclues</h2>
    <p className="muted">Seuls les films dont l’appartenance est établie sont concernés.</p>
    {!groups && !error && <p role="status">Chargement…</p>}
    {groups?.map((group) => <div key={group.key} className="franchise-group">
      <p><strong>{group.name}</strong> · {group.blocked ? "Exclue" : "Autorisée"}</p>
      <details>
        <summary>{group.films.length === 1 ? "1 film identifié" : `${group.films.length} films identifiés`} dans le catalogue</summary>
        {group.films.length ? <ul>{group.films.map(({ title, year }, index) =>
          <li key={index}>{title}{year ? ` (${year})` : ""}</li>)}</ul> : <p>Aucun film identifié.</p>}
      </details>
      <button className="text-action" type="button" disabled={pending} onClick={() => void update(group)}>
        {group.blocked ? `Réautoriser ${group.name}` : `Exclure la franchise ${group.name}`}
      </button>
    </div>)}
    {error && <p className="warning" role="alert">{error}</p>}
  </section>;
}


export function FilmFranchise({ movieId, franchise }: { movieId: number; franchise: Pick<Franchise, "key" | "name"> }) {
  const [expanded, setExpanded] = useState(false);
  const [blocked, setBlocked] = useState<boolean>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!expanded) return;
    let live = true;
    void window.afterDark.franchises(movieId, false).then((reply) => {
      if (!live) return;
      const group = reply.ok && reply.data.find(({ key }) => key === franchise.key);
      if (group) setBlocked(group.blocked);
      else setError("Impossible de lire cette franchise.");
    }).catch(() => { if (live) setError("Impossible de lire cette franchise."); });
    return () => { live = false; };
  }, [expanded, movieId, franchise.key]);

  async function update() {
    if (blocked === undefined || pending) return;
    setPending(true);
    setError("");
    try {
      const reply = await window.afterDark.setFranchise(movieId, franchise.key, !blocked);
      if (!reply.ok) throw new Error(reply.error);
      setBlocked(!blocked);
    } catch {
      setError("Impossible de modifier cette exclusion.");
    } finally {
      setPending(false);
    }
  }

  return <details className="film-franchise" onToggle={(event) => {
    const open = event.currentTarget.open;
    setExpanded(open);
    if (open && !pending) {
      setBlocked(undefined);
      setError("");
    }
  }}>
    <summary>Franchise · {franchise.name}</summary>
    <button type="button" className="text-action" disabled={pending || blocked === undefined} onClick={() => void update()}>
      {blocked ? `Réautoriser ${franchise.name}` : `Exclure la franchise ${franchise.name}`}
    </button>
    {error && <p className="warning" role="alert">{error}</p>}
  </details>;
}
