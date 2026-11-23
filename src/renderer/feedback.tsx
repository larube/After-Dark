import { useRef, useState, type FormEvent } from "react";
import type { FeedbackEntry, FeedbackRequest, Intention } from "../shared/feedback";

const choices = [
  ["watch_later", "À voir un jour"],
  ["tonight", "Pour ce soir"],
  ["not_interested", "Pas intéressé"],
] as const;

export type SaveFeedback = (request: FeedbackRequest) => Promise<void>;

export function FilmActions({ movieId, title, entry, disabled, save }: {
  movieId: number; title: string; entry?: FeedbackEntry; disabled: boolean; save: SaveFeedback;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const summary = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const active = choices.find(([value]) => value === entry?.intention)?.[1];

  async function submit(request: FeedbackRequest) {
    setPending(true);
    setError("");
    try {
      await save(request);
      if (request.action === "undo_seen") {
        setEditing(false);
        if (summary.current?.closest(".film-card")) requestAnimationFrame(() => summary.current?.focus());
      } else if (request.action === "seen") {
        setEditing(false);
        requestAnimationFrame(() => toggle.current?.focus());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible d’enregistrer ce retour.");
    } finally {
      setPending(false);
    }
  }

  function select(intention: Intention) {
    void submit({ action: "intention", movieId, intention });
  }

  function saveSeen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const score = String(values.get("score") ?? "");
    const appreciation = String(values.get("appreciation") ?? "").trim();
    void submit({ action: "seen", movieId, score: score === "" ? null : Number(score), appreciation: appreciation || null });
  }

  return <details className="feedback-actions">
    <summary ref={summary} aria-label={`Actions pour ${title}${entry?.seenAt ? " · Déjà vu" : active ? " · " + active : ""}`}>
      <span aria-hidden="true">＋</span> Actions
      {entry?.seenAt ? <span className="feedback-state">Déjà vu</span> : active && <span className="feedback-state">{active}</span>}
    </summary>
    <div className="feedback-body" aria-busy={pending}>
      {!entry?.seenAt && <div className="feedback-choices" role="group" aria-label="Intention de visionnage">
        {choices.map(([value, label]) => <button key={value} type="button" className="button button-quiet"
          disabled={disabled || pending} aria-pressed={entry?.intention === value}
          onClick={() => select(entry?.intention === value ? "none" : value)}>{label}</button>)}
        {active && <button type="button" className="button button-quiet" disabled={disabled || pending}
          onClick={() => select("none")}>Retirer l’intention</button>}
      </div>}
      <button ref={toggle} type="button" className="button button-quiet" aria-expanded={editing}
        disabled={disabled || pending} onClick={() => setEditing(!editing)}>
        {entry?.seenAt ? "Modifier mon retour" : "Déjà vu"}
      </button>
      {entry?.seenAt && <button type="button" className="button button-quiet" disabled={disabled || pending}
        onClick={() => void submit({ action: "undo_seen", movieId })}>Annuler le marquage vu</button>}
      {editing && <form className="feedback-form" onSubmit={saveSeen}>
        <label>Note facultative (0 à 10)<input name="score" type="number" min="0" max="10" step="1"
          defaultValue={entry?.score ?? ""} disabled={disabled || pending} /></label>
        <label>Appréciation facultative<textarea name="appreciation" maxLength={1000} rows={3}
          defaultValue={entry?.appreciation ?? ""} disabled={disabled || pending} /></label>
        <button type="submit" className="button button-primary" disabled={disabled || pending}>
          {pending ? "Enregistrement…" : "Enregistrer le visionnage"}
        </button>
      </form>}
      {error && <p className="warning" role="alert">{error}</p>}
    </div>
  </details>;
}

const groups = [
  ["tonight", "Pour ce soir", "Aucun film choisi pour ce soir."],
  ["watch_later", "À voir un jour", "Votre watchlist est vide."],
  ["seen", "Vus récemment", "Aucun visionnage enregistré depuis les recommandations."],
  ["not_interested", "Pas intéressé", "Aucun film écarté."],
] as const;

export function FeedbackCollection({ entries, error, disabled, save }: {
  entries?: FeedbackEntry[]; error: string; disabled: boolean; save: SaveFeedback;
}) {
  if (error) return <p className="notice error" role="alert">{error}</p>;
  if (!entries) return <p role="status">Chargement de votre collection…</p>;
  return <div className="feedback-collection">
    {groups.map(([group, label, empty]) => {
      const films = entries.filter((entry) => group === "seen" ? entry.seenAt : entry.intention === group);
      if (group === "seen") films.sort((a, b) => (b.seenAt ?? "").localeCompare(a.seenAt ?? ""));
      return <section className="library-section" key={group}>
        <h2>{label}</h2>
        {films.length ? <ul>{films.map((film) => <li key={film.movieId}>
          <h3>{film.title} {film.year && <small>{film.year}</small>}</h3>
          {film.score !== null && <p>{film.score}/10</p>}
          {film.appreciation && <p className="feedback-appreciation">{film.appreciation}</p>}
          <FilmActions movieId={film.movieId} title={film.title} entry={film} disabled={disabled} save={save} />
        </li>)}</ul> : <p className="muted">{empty}</p>}
      </section>;
    })}
  </div>;
}
