import { useEffect, useRef, useState, type ReactNode } from "react";
import { discoveryModes, type DiscoveryFilm, type DiscoveryMode, type DiscoveryView } from "../shared/discovery";

const modes = {
  gems: { title: "Les pépites", description: "Des films de popularité TMDB plus basse dans le catalogue, avec des liens possibles avec vos goûts." },
  affinities: { title: "Vos affinités", description: "Des films qui prolongent les goûts exprimés dans votre collection." },
  offbeat: { title: "Hors piste", description: "Des cinémas, des genres et des époques moins présents dans vos retours." },
} satisfies Record<DiscoveryMode, { title: string; description: string }>;

function DiscoveryCard({ film, actions }: { film: DiscoveryFilm; actions: ReactNode }) {
  const meta = [film.year, film.minutes && `${film.minutes} min`].filter(Boolean).join(" · ");
  return <article className="discovery-card">
    <div className="poster-mount discovery-poster">
      {film.posterData ? <img className="poster" src={film.posterData} alt="" /> :
        <div className="poster poster-empty"><span aria-hidden="true">◈</span><span>Affiche indisponible</span></div>}
    </div>
    <div className="discovery-copy">
      <h3>{film.title}</h3>
      {meta && <p className="film-meta">{meta}</p>}
      {(film.genres.length > 0 || film.format) && <p className="film-meta">{[...new Set([...film.genres, ...(film.format ? ["Téléfilm"] : [])])].join(" · ")}</p>}
      <p className="discovery-reason">{film.reason}</p>
      {film.synopsis && <details className="film-reasons"><summary>Lire le synopsis</summary><p>{film.synopsis}</p></details>}
    </div>
    <div className="discovery-actions">{actions}</div>
  </article>;
}

type PageState = { view: DiscoveryView | null; empty?: boolean };

export function Discovery({ active, disabled, actions }: {
  active: boolean;
  disabled: boolean;
  actions: (film: DiscoveryFilm) => ReactNode;
}) {
  const [mode, setMode] = useState<DiscoveryMode>("gems");
  const [states, setStates] = useState<Partial<Record<DiscoveryMode, PageState>>>({});
  const [errors, setErrors] = useState<Partial<Record<DiscoveryMode, string>>>({});
  const [generating, setGenerating] = useState<DiscoveryMode>();
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [posters, setPosters] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const inFlight = useRef(false);
  const state = states[mode];
  const error = errors[mode];

  useEffect(() => {
    if (!active) return;
    let live = true;
    const version = generation.current;
    void window.afterDark.discoveryCurrent(mode).then((result) => {
      if (!live || version !== generation.current) return;
      if (result.ok) {
        setErrors((entries) => ({ ...entries, [mode]: undefined }));
        setStates((entries) => ({ ...entries, [mode]: { view: result.data } }));
      }
      else setErrors((entries) => ({ ...entries, [mode]: result.error }));
    }).catch(() => {
      if (live && version === generation.current) setErrors((entries) => ({ ...entries, [mode]: "Impossible de lire l’exploration enregistrée." }));
    });
    return () => { live = false; };
  }, [active, mode, retry]);

  async function generate() {
    if (inFlight.current || disabled || !state) return;
    inFlight.current = true;
    generation.current++;
    setGenerating(mode);
    setErrors((entries) => ({ ...entries, [mode]: undefined }));
    try {
      const reply = await window.afterDark.discoveryGenerate(mode, state.view?.id ?? null);
      if (reply.ok) {
        const current = reply.data ? reply : await window.afterDark.discoveryCurrent(mode);
        if (!current.ok) throw new Error(current.error);
        setStates((entries) => ({ ...entries, [mode]: { view: current.data, empty: !reply.data } }));
      }
      else setErrors((entries) => ({ ...entries, [mode]: reply.error }));
    } catch {
      setErrors((entries) => ({ ...entries, [mode]: "Impossible de lancer l’exploration. Réessayez." }));
    } finally {
      inFlight.current = false;
      setGenerating(undefined);
    }
  }

  const view = state?.view;
  useEffect(() => {
    if (!active || !view || generating === mode) return;
    let live = true;
    setPosters({});
    async function load() {
      if (!view) return;
      const missing = view.films.filter(({ posterData }) => !posterData).map(({ id }) => id);
      for (let offset = 0; live && offset < missing.length; offset += 2) {
        const result = await window.afterDark.discoveryPosters(mode, view.id, missing.slice(offset, offset + 2));
        if (!live || !result.ok) return;
        if (result.data.length) setPosters((current) => ({
          ...current, ...Object.fromEntries(result.data.map(({ id, data }) => [view.id + ":" + id, data])),
        }));
      }
    }
    void load().catch(() => undefined);
    return () => { live = false; };
  }, [active, generating, mode, view]);

  async function exportDiagnostic() {
    if (!view || exporting) return;
    setExporting(true);
    setExportNotice("");
    try {
      const reply = await window.afterDark.discoveryExport(mode, view.id);
      if (!reply.ok) setExportNotice(reply.error);
      else if (reply.data === "saved") setExportNotice("Diagnostic enregistré.");
    } catch {
      setExportNotice("Impossible d’exporter le diagnostic.");
    } finally {
      setExporting(false);
    }
  }

  const loading = generating === mode || (!state && !error);
  const count = view?.films.length ?? 0;
  const noun = count === 1 ? "film" : "films";
  const status = loading ? "Exploration en cours…" : state?.empty ? "Le catalogue local ne contient aucun film admissible pour le moment." :
    view && !count ? "Les films de cette exploration ne sont plus admissibles. Lancez une nouvelle exploration." :
    view ? `${count} ${noun}${view.renewed === null ? "" : view.renewed === 0
      ? " · Aucune autre proposition comparable pour renouveler cette sélection."
      : ` · ${view.renewed} ${view.renewed === 1 ? "différent" : "différents"} de l’exploration précédente`}` : "";

  return <section hidden={!active} className="discovery" aria-labelledby="discovery-heading">
    <header className="page-heading">
      <h1 id="discovery-heading">Découvertes</h1>
      <p>Choisissez une piste et explorez les films de votre catalogue.</p>
    </header>
    <fieldset className="discovery-modes">
      <legend className="sr-only">Mode de découverte</legend>
      {discoveryModes.map((item) => <label key={item}>
        <input className="sr-only" type="radio" name="discovery-mode" value={item} checked={mode === item} onChange={() => { setMode(item); setExportNotice(""); }} />
        <span>{modes[item].title}</span>
      </label>)}
    </fieldset>
    <div className="discovery-toolbar">
      <p>{modes[mode].description}</p>
      {state && <button className="button button-primary" type="button" aria-disabled={disabled || generating !== undefined || undefined}
        onClick={() => void generate()}>{view ? "Explorer encore" : "Explorer"}</button>}
      {error && <button className="button" type="button" onClick={() => {
        setErrors((entries) => ({ ...entries, [mode]: undefined }));
        setRetry((value) => value + 1);
      }}>Réessayer</button>}
    </div>
    <p className="discovery-status" role="status">{status}</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {view && <ul className="discovery-grid" aria-label={modes[mode].title} aria-busy={loading}>
      {view.films.map((film) => <li key={film.id}><DiscoveryCard film={{ ...film, posterData: film.posterData ?? posters[view.id + ":" + film.id] }} actions={actions(film)} /></li>)}
    </ul>}
    {view && <details className="film-reasons">
      <summary>Diagnostic de cette exploration</summary>
      <p>Le fichier JSON contient les titres proposés, les signaux de classement et les statuts de visionnage de ces films.</p>
      <button className="button" type="button" disabled={exporting} onClick={() => void exportDiagnostic()}>Exporter le diagnostic JSON</button>
      {exportNotice && <p role="status">{exportNotice}</p>}
    </details>}
  </section>;
}
