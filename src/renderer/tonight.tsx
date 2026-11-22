import { useState, type FormEvent } from "react";
import { criteriaSchema, moods, type Criteria, type Recommendation } from "../shared/recommendation";

const control = "rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100";
const button = "rounded-md bg-violet-200 px-4 py-2 font-medium text-zinc-950 disabled:opacity-50";
const regions = new Intl.DisplayNames(["fr"], { type: "region" });
const connections: Record<Recommendation["connection"], string> = {
  online: "Catalogue actualisé avec TMDB.",
  cached: "Métadonnées déjà enregistrées pour cette recherche.",
  unconfigured: "TMDB est sans jeton. Recherche dans le catalogue local.",
  offline: "TMDB est inaccessible. Recherche dans le catalogue local.",
  limited: "Limite TMDB atteinte. Réessayez plus tard. Recherche dans le catalogue local.",
  unauthorized: "Jeton TMDB refusé ou configuration invalide. Recherche dans le catalogue local.",
  unavailable: "TMDB rencontre une erreur. Recherche dans le catalogue local.",
};
const labels = { safe: "Valeur sûre", gem: "Pépite", wildcard: "Wildcard" };

export function Tonight({ ready, onComplete }: { ready: boolean; onComplete: () => void }) {
  const [mood, setMood] = useState<Criteria["mood"]>("surprise");
  const [result, setResult] = useState<Recommendation>();
  const [submitted, setSubmitted] = useState<Criteria>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function request(criteria: Criteria, allowRecent = false) {
    setLoading(true);
    setError("");
    try {
      const reply = await window.afterDark.recommend(criteria, allowRecent);
      if (reply.ok) {
        setResult(reply.data);
        setSubmitted(criteria);
        onComplete();
      } else setError(reply.error);
    } catch {
      setError("Impossible de charger les propositions.");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const codes = (name: string) => [...new Set(text(name).split(/[\s,]+/).filter(Boolean))];
    const parsed = criteriaSchema.safeParse({
      mood, maxMinutes: text("duration") ? Number(text("duration")) : undefined,
      energy: text("energy") || undefined, avoid: text("avoid") || undefined,
      preferredCountries: codes("preferredCountries").map((value) => value.toUpperCase()),
      requiredCountries: codes("requiredCountries").map((value) => value.toUpperCase()),
      preferredLanguages: codes("preferredLanguages").map((value) => value.toLowerCase()),
      requiredLanguages: codes("requiredLanguages").map((value) => value.toLowerCase()),
    });
    if (!parsed.success) {
      setError("Vérifiez la durée (1 à 600 min) et les codes pays ou langue (deux lettres, séparés par des virgules).");
      return;
    }
    void request(parsed.data);
  }

  return <section className="mt-8 border-t border-zinc-700 pt-6" aria-labelledby="tonight">
    <h2 id="tonight" className="text-2xl font-semibold">Ce soir</h2>
    <form className="mt-4 space-y-4" onSubmit={submit}>
      <fieldset className="flex flex-wrap gap-2" disabled={loading}>
        <legend className="mb-2 text-zinc-300">Votre humeur</legend>
        {Object.entries(moods).map(([key, label]) => <label key={key} className={control + " cursor-pointer has-checked:border-violet-300"}>
          <input className="mr-2 accent-violet-200" name="mood" type="radio" value={key} checked={mood === key}
            onChange={() => { const value = criteriaSchema.shape.mood.safeParse(key); if (value.success) setMood(value.data); }} />{label}
        </label>)}
      </fieldset>
      <details>
        <summary className="cursor-pointer text-zinc-300">Filtres facultatifs</summary>
        <fieldset className="mt-3 grid gap-3 sm:grid-cols-2" disabled={loading}>
          <label className="grid gap-1">Durée maximale (min)
            <input className={control} name="duration" type="number" min={1} max={600} />
          </label>
          <label className="grid gap-1">Énergie disponible
            <select className={control} name="energy"><option value="">Indifférent</option><option value="low">Faible</option><option value="high">Élevée · durée libre</option></select>
          </label>
          <label className="grid gap-1">Ambiance à éviter de préférence
            <select className={control} name="avoid"><option value="">Aucune</option>
              {Object.entries(moods).filter(([key]) => key !== "surprise").map(([key, label]) => <option value={key} key={key}>{label}</option>)}
            </select>
          </label>
          <p className="self-end pb-2 text-sm text-zinc-400">Codes à deux lettres. Ex. ES, AR pour les pays et es, ja pour les langues.</p>
          {([
            ["preferredCountries", "Pays de production préférés"], ["requiredCountries", "Pays de production obligatoires"],
            ["preferredLanguages", "Langues originales préférées"], ["requiredLanguages", "Langues originales obligatoires"],
          ] as const).map(([name, label]) => <label className="grid gap-1" key={name}>{label}
            <input className={control} name={name} placeholder="Sans filtre" maxLength={80} autoComplete="off" spellCheck={false} />
          </label>)}
        </fieldset>
      </details>
      <button className={button} disabled={loading || !ready}>Trouve-moi un film</button>
    </form>
    <div className="mt-4 space-y-3" aria-live="polite" aria-busy={loading}>
      {loading && <p role="status">Recherche en cours…</p>}
      {error && <p className="text-rose-200" role="alert">{error}</p>}
      {result && <>
        <p className="text-zinc-300">{connections[result.connection]}</p>
        {!result.personalized && <p className="text-zinc-300">Le profil manque de signaux exploitables. La sélection s’appuie sur votre humeur, vos critères et le catalogue.</p>}
        {result.status === "empty" && <p>Aucun film à découvrir dans le catalogue local. Importez un profil contenant des films à découvrir ou configurez TMDB.</p>}
        {result.status === "no-match" && <p>Aucun film disponible ne satisfait vos critères. Vous pouvez assouplir les filtres puis relancer la recherche.</p>}
        {result.status === "exhausted" && <p>Les films compatibles ont déjà été proposés récemment. Vous pouvez les revoir ou relancer la découverte.</p>}
        {result.films.length > 0 && <ol className="space-y-3">
          {result.films.map(({ id, title, year, metadata, posterData, category, reasons, warnings }) => <li key={id} className="flex gap-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
            {posterData && <img src={posterData} alt="" className="w-24 shrink-0 self-start rounded-md sm:w-28" />}
            <div>
              <p className="text-sm text-violet-200">{category === "safe" && !result.personalized ? "Choix du soir" : labels[category]}</p>
              <h3 className="text-lg font-semibold">{title}{year && ` (${year})`}</h3>
              <p className="text-sm text-zinc-400">{[
                metadata.minutes ? `${metadata.minutes} min` : "Durée inconnue",
                metadata.countries.length ? metadata.countries.map((code) => regions.of(code)).join(", ") : "Pays inconnu",
              ].join(" · ")}</p>
              {metadata.synopsis && <p className="mt-2 text-zinc-300">{metadata.synopsis}</p>}
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              {warnings.map((warning) => <p className="mt-2 text-sm text-amber-200" key={warning}>{warning}</p>)}
            </div>
          </li>)}
        </ol>}
        {submitted && result.status !== "empty" && <div className="flex flex-wrap gap-2">
          <button className={button} type="button" disabled={loading} onClick={() => void request(submitted)}>Autres propositions</button>
          {result.status === "exhausted" && <button className={control} type="button" disabled={loading}
            onClick={() => void request(submitted, true)}>Revoir des propositions récentes</button>}
        </div>}
      </>}
    </div>
    <footer className="mt-8 text-xs text-zinc-400" aria-label="Crédits">
      <img src={import.meta.env.BASE_URL + "tmdb-logo.svg"} className="mb-2 w-20" alt="TMDB" />
      <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </footer>
  </section>;
}
