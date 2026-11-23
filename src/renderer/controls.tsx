import type { ReactNode } from "react";
import { moods, type Criteria } from "../shared/recommendation";

import { defaultFilters, durations, type SessionFilters } from "./criteria";

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

const countries: Record<string, string> = {
  DE: "Allemagne", AR: "Argentine", AU: "Australie", BE: "Belgique", BR: "Brésil",
  CA: "Canada", CN: "Chine", KR: "Corée du Sud", ES: "Espagne", US: "États-Unis",
  FR: "France", HK: "Hong Kong", IN: "Inde", IT: "Italie", JP: "Japon", MX: "Mexique",
  PL: "Pologne", GB: "Royaume-Uni", SE: "Suède", TW: "Taïwan",
};

const languages: Record<string, string> = {
  de: "Allemand", en: "Anglais", ar: "Arabe", cn: "Cantonais", ko: "Coréen",
  da: "Danois", es: "Espagnol", fr: "Français", el: "Grec", hi: "Hindi",
  it: "Italien", ja: "Japonais", zh: "Mandarin", nl: "Néerlandais", fa: "Persan",
  pl: "Polonais", pt: "Portugais", ru: "Russe", sv: "Suédois", tr: "Turc",
};

function FilterChoices({ label, all, requiredLabel, preferenceHelp, options, selected, required, onSelect, onRequire, busy }: {
  label: string; all: string; requiredLabel: string; preferenceHelp: string; options: Record<string, string>;
  selected: string[]; required: boolean; onSelect: (selected: string[]) => void;
  onRequire: (required: boolean) => void; busy: boolean;
}) {
  return <fieldset className="filter-choices" disabled={busy}>
    <legend>{label}</legend>
    <p>{selected.length === 0 ? all : `${selected.length} sélectionné(s)`}</p>
    <div className="filter-options">
      {Object.entries(options).map(([code, name]) => <label key={code}>
        <input type="checkbox" checked={selected.includes(code)} onChange={(event) => {
          onSelect(event.target.checked ? [...selected, code] : selected.filter((item) => item !== code));
        }} />
        {name}
      </label>)}
    </div>
    <label className="filter-required">
      <input type="checkbox" checked={required} disabled={!selected.length} onChange={(event) => onRequire(event.target.checked)} />
      {requiredLabel}
    </label>
    {!!selected.length && !required && <small className="filter-help">{preferenceHelp}</small>}
  </fieldset>;
}

export function FilterPanel({ busy, value, onChange, action }: {
  busy: boolean; value: SessionFilters; onChange: (value: SessionFilters) => void; action?: ReactNode;
}) {
  const { duration, avoid, countries: selectedCountries, languages: selectedLanguages, countriesRequired, languagesRequired } = value;
  const active = Number(!!duration) + Number(!!avoid) + Number(!!selectedCountries.length) + Number(!!selectedLanguages.length);

  return <>
    <fieldset className="session-ticket" disabled={busy} aria-label="Réglages rapides">
      <label>Durée maximale
        <select value={duration} onChange={(event) => onChange({ ...value, duration: event.target.value })}>
          <option value="">Peu importe</option>
          {durations.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}
        </select>
      </label>
      <label>Éviter plutôt…
        <select value={avoid} onChange={(event) => onChange({ ...value, avoid: event.target.value })} aria-describedby="avoid-help">
          <option value="">Aucune ambiance</option>
          {moodOrder.filter((key) => key !== "surprise").map((key) => <option key={key} value={key}>
            {key === "immersion" ? "Immersif" : moods[key]}
          </option>)}
        </select>
        <small id="avoid-help">Préférence souple</small>
      </label>
    </fieldset>
    {action}
    <details className="filters">
      <summary>
        Affiner ma séance{active > 0 && <span className="filter-count"> · {active} {active === 1 ? "critère actif" : "critères actifs"}</span>}
        {selectedCountries.length > 0 && <span className="filter-summary">{countriesRequired ? "Pays obligatoires" : "Pays préférés"} · {selectedCountries.map((code) => countries[code]).join(", ")}</span>}
        {selectedLanguages.length > 0 && <span className="filter-summary">{languagesRequired ? "Langues obligatoires" : "Langues préférées"} · {selectedLanguages.map((code) => languages[code]).join(", ")}</span>}
      </summary>
      <div className="filter-body">
        <p>Les pays désignent les pays de production. Vos choix sont des préférences par défaut. S’ils sont obligatoires, un seul choix par champ doit correspondre.</p>
        <div className="geography">
          <FilterChoices label="Pays du cinéma" all="Tous les pays" requiredLabel="Uniquement les pays sélectionnés"
            preferenceHelp="D’autres pays restent possibles." options={countries}
            selected={selectedCountries} required={countriesRequired} busy={busy}
            onSelect={(selected) => onChange({ ...value, countries: selected, countriesRequired: !!selected.length && countriesRequired })}
            onRequire={(required) => onChange({ ...value, countriesRequired: required })} />
          <FilterChoices label="Langue originale" all="Toutes les langues" requiredLabel="Uniquement les langues sélectionnées"
            preferenceHelp="D’autres langues restent possibles." options={languages}
            selected={selectedLanguages} required={languagesRequired} busy={busy}
            onSelect={(selected) => onChange({ ...value, languages: selected, languagesRequired: !!selected.length && languagesRequired })}
            onRequire={(required) => onChange({ ...value, languagesRequired: required })} />
        </div>
        <button type="button" className="button button-quiet filter-reset" disabled={busy}
          onClick={() => onChange(defaultFilters)}>Réinitialiser les critères</button>
      </div>
    </details>
  </>;
}
