import { useState } from "react";
import { moods, type Criteria } from "../shared/recommendation";

export const moodOrder = ["surprise", "tension", "strange", "laugh", "emotion", "immersion"] as const;
export function MoodSelector({ value, onChange, busy }: {
  value: Criteria["mood"]; onChange: (value: Criteria["mood"]) => void; busy: boolean;
}) {
  return <fieldset className="mood-fieldset" disabled={busy}>
    <legend>Votre humeur</legend>
    <div className="mood-grid">{moodOrder.map((mood) => <label className="mood" data-mood={mood} key={mood}>
      <input name="mood" type="radio" value={mood} checked={value === mood} onChange={() => onChange(mood)} />
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
    <fieldset className="filter-grid quick-filters" disabled={busy} aria-label="Critères rapides">
      <label>Durée maximale (min)<input name="duration" type="number" min={1} max={600} placeholder="Sans limite" /></label>
      <label>Énergie disponible<select name="energy"><option value="">Indifférent</option><option value="low">Faible</option><option value="high">Élevée · durée libre</option></select></label>
      <label>Ambiance à éviter de préférence<select name="avoid"><option value="">Aucune</option>
        {moodOrder.filter((key) => key !== "surprise").map((key) => <option key={key} value={key}>{moods[key]}</option>)}
      </select></label>
    </fieldset>
    <details className="filters">
      <summary>Filtres facultatifs</summary>
      <fieldset className="filter-body" disabled={busy}>
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
