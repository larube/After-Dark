import { useState } from "react";
import { moods, type Criteria } from "../shared/recommendation";

export const moodOrder = ["surprise", "tension", "strange", "laugh", "emotion", "immersion"] as const;
const moodMarks: Record<Criteria["mood"], string> = {
  surprise: "M4 7h4c6 0 6 10 12 10h4m-4-4 4 4-4 4M4 17h4c6 0 6-10 12-10h4m-4-4 4 4-4 4",
  tension: "M2 14h5l3-8 4 14 4-10 3 4h5M2 21h24",
  strange: "M2 13Q14 1 26 13 14 25 2 13Zm12-4a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM6 3l-2-2m18 2 2-2",
  laugh: "M5 12c0 14 18 14 18 0ZM7 7l2-2 2 2m6 0 2-2 2 2",
  emotion: "M14 22 5 13C-1 5 9 1 14 8c5-7 15-3 9 5Z",
  immersion: "M2 3h24v18H2Zm5 4h14v10H7Zm4 3h6v4h-6ZM2 3l9 7m15-7-9 7m9 11-9-7M2 21l9-7",
};

export function MoodSelector({ value, onChange, busy }: {
  value: Criteria["mood"]; onChange: (value: Criteria["mood"]) => void; busy: boolean;
}) {
  return <fieldset className="mood-fieldset" disabled={busy}>
    <legend>Votre humeur</legend>
    <div className="mood-grid">{moodOrder.map((mood) => <label className="mood" key={mood}>
      <input name="mood" type="radio" value={mood} checked={value === mood} onChange={() => onChange(mood)} />
      <svg className="mood-glyph" viewBox="0 0 28 24" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={moodMarks[mood]} />
      </svg>
      <span>{mood === "immersion" ? "Immersif" : moods[mood]}</span>
      <span className="mood-check" aria-hidden="true">✓</span>
    </label>)}</div>
  </fieldset>;
}

export function FilterPanel({ busy }: { busy: boolean }) {
  const [preferred, setPreferred] = useState("");
  const countryCodes = preferred.toUpperCase().split(/[\s,]+/).filter(Boolean);
  function toggleCountry(code: string) {
    setPreferred(countryCodes.includes(code) ? countryCodes.filter((value) => value !== code).join(", ") : [...countryCodes, code].join(", "));
  }

  return <div className="filter-panel">
    <fieldset className="country-shortcuts" disabled={busy} aria-label="Raccourcis de pays préférés">
      <span>Pays préférés</span>
      {([["FR", "France"], ["ES", "Espagne"]] as const).map(([code, label]) =>
        <button type="button" className="button button-quiet" key={code} aria-pressed={countryCodes.includes(code)}
          onClick={() => toggleCountry(code)}>{label}</button>)}
    </fieldset>
    <details className="filters">
      <summary>Filtres facultatifs</summary>
      <fieldset className="filter-body" disabled={busy}>
        <div className="filter-grid">
          <label>Durée maximale (min)<input name="duration" type="number" min={1} max={600} placeholder="Sans limite" /></label>
          <label>Énergie disponible<select name="energy"><option value="">Indifférent</option><option value="low">Faible</option><option value="high">Élevée · durée libre</option></select></label>
          <label>Ambiance à éviter de préférence<select name="avoid"><option value="">Aucune</option>
            {moodOrder.filter((key) => key !== "surprise").map((key) => <option key={key} value={key}>{moods[key]}</option>)}
          </select></label>
        </div>
        <p className="muted" id="code-help">Séparez les codes par des virgules. Pays de production : FR, ES. Langues originales : fr, es.</p>
        <div className="filter-grid geography">{([
          ["preferredCountries", "Pays de production préférés"], ["requiredCountries", "Pays de production obligatoires"],
          ["preferredLanguages", "Langues originales préférées"], ["requiredLanguages", "Langues originales obligatoires"],
        ] as const).map(([name, label]) => <label key={name}>{label}
          <input name={name} aria-describedby="code-help" maxLength={80} autoComplete="off" spellCheck={false} placeholder="Tous"
            {...(name === "preferredCountries" ? { value: preferred, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setPreferred(event.target.value) } : {})} />
        </label>)}</div>
      </fieldset>
    </details>
  </div>;
}
