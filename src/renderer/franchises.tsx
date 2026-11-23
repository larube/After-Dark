import { useEffect, useState } from "react";
import type { Franchise } from "../shared/franchises";

export function FranchisePreferences({ movieId = null, onChange }: { movieId?: number | null; onChange: () => void }) {
  const [open, setOpen] = useState(movieId === null);
  const [groups, setGroups] = useState<Franchise[]>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void window.afterDark.franchises(movieId, false).then((reply) => {
      if (!live) return;
      if (reply.ok) setGroups(reply.data);
      else setError(reply.error);
    }).catch(() => { if (live) setError("Impossible de lire les franchises."); });
    return () => { live = false; };
  }, [open, movieId]);

  async function update(group: Franchise) {
    setPending(true);
    setError("");
    try {
      const reply = await window.afterDark.setFranchise(movieId, group.key, !group.blocked);
      if (!reply.ok) throw new Error(reply.error);
      setGroups((entries) => entries?.map((entry) => entry.key === group.key ? { ...entry, blocked: !group.blocked } : entry)
        .filter((entry) => movieId !== null || entry.blocked || entry.key === "harry-potter" || entry.key === "godzilla"));
      onChange();
    } catch {
      setError("Impossible de modifier cette exclusion.");
    } finally {
      setPending(false);
    }
  }

  async function verify() {
    setPending(true);
    setError("");
    try {
      const reply = await window.afterDark.franchises(movieId, true);
      if (!reply.ok) throw new Error(reply.error);
      setGroups(reply.data);
      setVerified(true);
    } catch {
      setError("Impossible de vérifier cette collection auprès de TMDB.");
    } finally {
      setPending(false);
    }
  }

  return <section className={movieId === null ? "library-section" : "film-franchise"}>
    {movieId === null ? <h2>Franchises exclues</h2> :
      <button className="text-action" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Franchise</button>}
    {open && <>
      {movieId === null && <p className="muted">Seuls les films dont l’appartenance est établie sont concernés.</p>}
      {!groups && !error && <p role="status">Chargement…</p>}
      {!!groups && groups.length === 0 && <>
        <p className="muted">Aucune appartenance connue.</p>
        {!verified && <button className="text-action" type="button" disabled={pending} onClick={() => void verify()}>Vérifier sur TMDB</button>}
      </>}
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
    </>}
  </section>;
}
