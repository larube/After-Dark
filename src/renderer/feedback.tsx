import { useEffect, useRef, useState, type FormEvent } from "react";
import { needsRating, type FeedbackEntry, type FeedbackRequest, type Intention } from "../shared/feedback";
import { AllocineLink } from "./allocine";

export type SaveFeedback = (request: FeedbackRequest) => Promise<void>;

function Rating({ movieId, entry, disabled, save, close }: {
  movieId: number; entry?: FeedbackEntry; disabled: boolean; save: SaveFeedback; close: () => void;
}) {
  const [score, setScore] = useState<number | null>(entry?.score ?? null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const scale = useRef<HTMLDivElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const appreciation = String(new FormData(event.currentTarget).get("appreciation") ?? "").trim();
    setSaving(true);
    setError("");
    try {
      await save({ action: "evaluate", movieId, score, appreciation: appreciation || null });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible d’enregistrer ce retour.");
    } finally {
      setSaving(false);
    }
  }

  return <form className="rating-ticket" onSubmit={(event) => void submit(event)}>
    <h4 ref={heading} tabIndex={-1}>Ça valait quoi ?</h4>
    <fieldset disabled={disabled || saving}>
      <legend>Note facultative sur 10</legend>
      <div className="rating-scale" ref={scale}>{Array.from({ length: 11 }, (_, value) => <label key={value}>
        <input type="radio" name="rating" checked={score === value} onChange={() => setScore(value)} />
        <span>{value}</span>
      </label>)}</div>
      {score !== null && <button className="text-action" type="button" onClick={() => { scale.current?.querySelector<HTMLInputElement>("input:checked")?.focus(); setScore(null); }}>Effacer la note</button>}
    </fieldset>
    <label>Commentaire facultatif<textarea name="appreciation" rows={2} maxLength={1000}
      defaultValue={entry?.appreciation ?? ""} disabled={disabled || saving} /></label>
    <div className="film-buttons">
      <button className="button button-primary" type="submit" disabled={disabled || saving}>Enregistrer</button>
      <button className="button button-quiet" type="button" disabled={saving} onClick={close}>
        {entry?.score != null || entry?.appreciation ? "Fermer" : "Noter plus tard"}
      </button>
    </div>
    {error && <p role="alert" className="warning">{error}</p>}
  </form>;
}

const choices = [
  ["watch_later", "À voir un jour", "＋"],
  ["seen", "Déjà vu", "✓"],
  ["not_interested", "Pas pour moi", "×"],
  ["tonight", "Pour ce soir", "◷"],
] as const;

export function FilmActions({ movieId, title, entry, disabled, save, rating }: {
  movieId: number; title: string; entry?: FeedbackEntry; disabled: boolean; save: SaveFeedback;
  rating?: { open: boolean; setOpen: (open: boolean) => void };
}) {
  const [localEditing, setLocalEditing] = useState(false);
  const editing = rating?.open ?? localEditing;
  const setEditing = rating?.setOpen ?? setLocalEditing;
  const [error, setError] = useState("");
  const primary = useRef<HTMLButtonElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const seen = !!entry?.seenAt;
  const selected = !!entry?.selectedAt;
  const active = choices.find(([value]) => value === entry?.intention)?.[1];
  const state = seen ? "Déjà vu" : selected ? "Séance choisie" :
    entry?.intention === "watch_later" ? "Dans ma liste" : entry?.intention === "not_interested" ? "Écarté" : active;

  async function submit(request: FeedbackRequest) {
    setError("");
    try {
      await save(request);
      if (request.action === "seen") setEditing(true);
      if (request.action === "undo_seen") {
        setEditing(false);
        requestAnimationFrame(() => primary.current?.focus());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible d’enregistrer ce retour.");
    }
  }

  function select(intention: Intention) {
    void submit({ action: "intention", movieId, intention: entry?.intention === intention ? "none" : intention });
  }

  return <div className="film-feedback" role="group" aria-label={`Choix pour ${title}`}>
    {state && <p className="film-state">{state}{selected && entry?.intention === "watch_later" && " · Dans ma liste"}</p>}
    {!seen ? <>
      <button ref={primary} type="button" className="button button-primary film-launch"
        disabled={disabled} aria-disabled={selected || undefined}
        onClick={() => { if (!selected) void submit({ action: "launch", movieId }); }}>
        <span aria-hidden="true">▶</span> {selected ? "Film choisi" : "Je lance ce film"}
      </button>
      <div className="film-buttons">
        {choices.map(([value, label, icon]) => <button key={value} type="button" className="text-action" disabled={disabled}
          aria-pressed={value === "seen" ? undefined : entry?.intention === value}
          onClick={() => value === "seen" ? void submit({ action: "seen", movieId, score: null, appreciation: null }) : select(value)}>
          <span aria-hidden="true">{icon}</span> {label}
        </button>)}
        {selected && <button className="text-action" type="button" disabled={disabled}
          onClick={() => void submit({ action: "cancel_viewing", movieId })}>Annuler la séance</button>}
      </div>
    </> : <div className="film-buttons">
      <button ref={edit} type="button" className="text-action" aria-expanded={editing} disabled={disabled}
        onClick={() => setEditing(!editing)}>{entry.score !== null || entry.appreciation ? "Modifier mon retour" : "Noter ce film"}</button>
      <button type="button" className="text-action" disabled={disabled}
        onClick={() => void submit({ action: "undo_seen", movieId })}>Annuler le marquage vu</button>
    </div>}
    {editing && seen && <Rating movieId={movieId} entry={entry} disabled={disabled} save={save} close={() => {
      setEditing(false);
      requestAnimationFrame(() => edit.current?.focus());
    }} />}
    {error && <p className="warning" role="alert">{error}</p>}
  </div>;
}

export function ViewingReminder({ film, disabled, save, dismiss }: {
  film: FeedbackEntry; disabled: boolean; save: SaveFeedback; dismiss: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [deferring, setDeferring] = useState(false);
  const [error, setError] = useState("");

  async function respond(action: "confirm_viewing" | "cancel_viewing") {
    setError("");
    try {
      await save({ action, movieId: film.movieId });
      if (action === "confirm_viewing") setConfirmed(true);
      else dismiss();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible d’enregistrer la réponse.");
    }
  }

  async function defer() {
    setError("");
    setDeferring(true);
    try {
      const reply = await window.afterDark.deferViewing(film.movieId);
      if (!reply.ok) throw new Error(reply.error);
      dismiss();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de reporter la demande.");
    } finally {
      setDeferring(false);
    }
  }

  return <article className="viewing-ticket">
    <h3>{film.title}</h3>
    {confirmed ? <Rating movieId={film.movieId} entry={film} disabled={disabled || deferring} save={save} close={dismiss} /> : <>
      <p>Tu avais choisi {film.title}. Tu l’as finalement regardé ?</p>
      <div className="film-buttons">
        <button type="button" className="button button-primary" disabled={disabled || deferring}
          onClick={() => void respond("confirm_viewing")}>Oui, je l’ai vu</button>
        <button type="button" className="button button-quiet" disabled={disabled || deferring} onClick={() => void defer()}>Pas encore</button>
        <button type="button" className="text-action" disabled={disabled || deferring}
          onClick={() => void respond("cancel_viewing")}>Finalement, non</button>
      </div>
    </>}
    {error && <p className="warning" role="alert">{error}</p>}
  </article>;
}

const groups: { id: string; label: string; empty: string; match: (entry: FeedbackEntry) => boolean }[] = [
  { id: "rating", label: "Films à noter", empty: "Aucun film à noter.", match: needsRating },
  { id: "planned", label: "Séances en attente", empty: "Aucune séance en attente.", match: (entry) => !!entry.selectedAt },
  { id: "tonight", label: "Pour ce soir", empty: "Aucun film envisagé pour ce soir.", match: (entry) => entry.intention === "tonight" },
  { id: "watch_later", label: "À voir un jour", empty: "Votre liste est vide.", match: (entry) => entry.intention === "watch_later" && !entry.selectedAt },
  { id: "seen", label: "Vus récemment", empty: "Aucun retour enregistré.", match: (entry) => !!entry.seenAt && !needsRating(entry) },
  { id: "excluded", label: "Films écartés", empty: "Aucun film écarté.", match: (entry) => entry.intention === "not_interested" },
];

export function FeedbackCollection({ entries, error, disabled, save }: {
  entries?: FeedbackEntry[]; error: string; disabled: boolean; save: SaveFeedback;
}) {
  const [ratingMovie, setRatingMovie] = useState<number>();
  if (error) return <p className="notice error" role="alert">{error}</p>;
  if (!entries) return <p role="status">Chargement de votre collection…</p>;
  return <div className="feedback-collection">
    {groups.map(({ id, label, empty, match }) => {
      const films = entries.filter(match).sort((a, b) => (b.seenAt ?? b.selectedAt ?? "").localeCompare(a.seenAt ?? a.selectedAt ?? ""));
      return <section className="library-section" key={id}>
        <h2>{label}</h2>
        {films.length ? <ul>{films.map((film) => <li key={film.movieId}>
          <h3>{film.title} {film.year && <small>{film.year}</small>}</h3>
          {film.score !== null && <p>{film.score}/10</p>}
          {film.appreciation && <p className="feedback-appreciation">{film.appreciation}</p>}
          <AllocineLink title={film.title} year={film.year} />
          <FilmActions movieId={film.movieId} title={film.title} entry={film} disabled={disabled} save={save}
            rating={{ open: ratingMovie === film.movieId, setOpen: (open) => setRatingMovie(open ? film.movieId : undefined) }} />
        </li>)}</ul> : <p className="muted">{empty}</p>}
      </section>;
    })}
  </div>;
}
