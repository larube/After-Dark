import { useId, useRef, useState } from "react";
import { moods, type Criteria } from "../shared/recommendation";

import { defaultFilters, durations, type SessionFilters } from "./criteria";

export const moodOrder = ["surprise", "tension", "strange", "laugh", "emotion", "immersion"] as const;
export function MoodSelector({ value, onChange, busy }: {
  value: Criteria["mood"]; onChange: (value: Criteria["mood"]) => void; busy: boolean;
}) {
  return <label className="mood-select">
    <span>Ambiance</span>
    <select name="mood" value={value} disabled={busy} onChange={(event) => onChange(event.currentTarget.value as Criteria["mood"])}>
      {moodOrder.map((mood) => <option key={mood} value={mood}>
        {mood === "surprise" ? "Selon mes goûts" : moods[mood]}
      </option>)}
    </select>
  </label>;
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

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function FilterChoices({ label, all, requiredLabel, options, selected, required, onSelect, onRequire, busy }: {
  label: string; all: string; requiredLabel: string; options: Record<string, string>;
  selected: string[]; required: boolean; onSelect: (selected: string[]) => void;
  onRequire: (required: boolean) => void; busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const available = Object.entries(options).filter(([, name]) => normalize(name).includes(normalize(query.trim())));

  return <div className="ticket-slot">
    <span className="ticket-label" id={id}>{label}</span>
    <details className="ticket-picker" name="session-filters" ref={details}
      onToggle={() => { if (!details.current?.open) setQuery(""); }}
      onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && details.current?.open) {
          event.preventDefault();
          details.current.open = false;
          trigger.current?.focus();
        }
      }}>
      <summary ref={trigger} aria-labelledby={`${id} ${id}-current`}>
        <span id={`${id}-current`}>{selected.length ? required ? "Obligatoire" : "Préférence" : all}</span>
      </summary>
      <fieldset className="ticket-options" disabled={busy}>
        <legend className="visually-hidden">{label}</legend>
        <input type="search" aria-label={`Rechercher · ${label}`} placeholder="Rechercher…" value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
        <div className="ticket-list">
          {available.map(([code, name]) => <label key={code}>
            <input type="checkbox" checked={selected.includes(code)} onChange={(event) => {
              onSelect(event.target.checked ? [...selected, code] : selected.filter((item) => item !== code));
            }} /> {name}
          </label>)}
          {!available.length && <p role="status">Aucun résultat.</p>}
        </div>
        <label className="ticket-strict">
          <input type="checkbox" checked={required} disabled={!selected.length} aria-describedby={`${id}-help`}
            onChange={(event) => onRequire(event.target.checked)} /> {requiredLabel}
        </label>
        <small id={`${id}-help`}>En mode strict, au moins un choix doit correspondre. Sinon, d’autres choix restent possibles.</small>
      </fieldset>
    </details>
    {!!selected.length && <ul className="ticket-chips" aria-label={label}>
      {selected.map((code) => <li key={code}><button type="button" disabled={busy} aria-label={`Retirer ${options[code]}`}
        onClick={(event) => {
          const next = event.currentTarget.closest("li")?.nextElementSibling?.querySelector("button");
          const previous = event.currentTarget.closest("li")?.previousElementSibling?.querySelector("button");
          (next ?? previous ?? trigger.current)?.focus();
          onSelect(selected.filter((item) => item !== code));
        }}>{options[code]} <span aria-hidden="true">×</span></button></li>)}
    </ul>}
  </div>;
}

const durationOptions = [["", "Peu importe"], ...durations.map(([minutes, label]) => [String(minutes), label] as const)] as const;
const avoidOptions = [["", "Aucune"], ...moodOrder.filter((key) => key !== "surprise")
  .map((key) => [key, key === "immersion" ? "Immersif" : moods[key]] as const)] as const;

function SingleFilter({ label, options, value, busy, help, onChange }: {
  label: string; options: readonly (readonly [string, string])[]; value: string; busy: boolean;
  help?: string; onChange: (value: string) => void;
}) {
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);

  function close() {
    if (details.current) details.current.open = false;
    trigger.current?.focus();
  }

  return <div className="ticket-slot">
    <span className="ticket-label" id={id}>{label}</span>
    <details className="ticket-picker" name="session-filters" ref={details}
      onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
      onKeyDown={(event) => {
        if (event.key === "Escape" || (event.key === "Enter" && event.target instanceof HTMLInputElement)) {
          event.preventDefault();
          close();
        }
      }}>
      <summary ref={trigger} aria-labelledby={`${id} ${id}-current`}>
        <span id={`${id}-current`}>{options.find(([code]) => code === value)?.[1]}</span>
      </summary>
      <fieldset className="ticket-options" disabled={busy} aria-describedby={help ? `${id}-help` : undefined}>
        <legend className="visually-hidden">{label}</legend>
        <div className="ticket-list ticket-single-list">
          {options.map(([code, name]) => <label key={code}>
            <input type="radio" name={id} value={code} checked={value === code} onChange={() => onChange(code)}
              onClick={(event) => { if (event.detail > 0) close(); }} /> {name}
          </label>)}
        </div>
        {help && <small id={`${id}-help`}>{help}</small>}
      </fieldset>
    </details>
  </div>;
}

export function FilterPanel({ busy, value, onChange }: {
  busy: boolean; value: SessionFilters; onChange: (value: SessionFilters) => void;
}) {
  const { duration, avoid, countries: selectedCountries, languages: selectedLanguages, countriesRequired, languagesRequired } = value;
  const dirty = !!(duration || avoid || selectedCountries.length || selectedLanguages.length);

  return <div className="cinema-controls" role="group" aria-label="Filtres de séance">
    <FilterChoices label="Pays du cinéma" all="Tous les pays" requiredLabel="Uniquement ces pays de production" options={countries}
      selected={selectedCountries} required={countriesRequired} busy={busy}
      onSelect={(selected) => onChange({ ...value, countries: selected, countriesRequired: !!selected.length && countriesRequired })}
      onRequire={(required) => onChange({ ...value, countriesRequired: required })} />
    <FilterChoices label="Langue originale" all="Toutes les langues" requiredLabel="Uniquement ces langues originales" options={languages}
      selected={selectedLanguages} required={languagesRequired} busy={busy}
      onSelect={(selected) => onChange({ ...value, languages: selected, languagesRequired: !!selected.length && languagesRequired })}
      onRequire={(required) => onChange({ ...value, languagesRequired: required })} />
    <SingleFilter label="Durée maximale" options={durationOptions} value={duration} busy={busy}
      onChange={(duration) => onChange({ ...value, duration })} />
    <SingleFilter label="Ambiance à éviter" options={avoidOptions} value={avoid} busy={busy}
      help="Préférence souple" onChange={(avoid) => onChange({ ...value, avoid })} />
    <div className="ticket-submit">
      <button type="button" className="text-action" aria-disabled={busy || !dirty}
        onClick={() => { if (!busy && dirty) onChange(defaultFilters); }}>Réinitialiser les critères</button>
    </div>
  </div>;
}
