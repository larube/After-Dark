import { criteriaSchema, type Criteria } from "../shared/recommendation";

export const durations = [
  [90, "1 h 30"], [105, "1 h 45"], [120, "2 h"],
  [150, "2 h 30"], [180, "3 h"],
] as const;

export type SessionFilters = {
  duration: string;
  avoid: string;
  countries: string[];
  languages: string[];
  countriesRequired: boolean;
  languagesRequired: boolean;
};

export const defaultFilters: SessionFilters = {
  duration: "", avoid: "", countries: [], languages: [],
  countriesRequired: false, languagesRequired: false,
};

export function readCriteria(filters: SessionFilters, mood: Criteria["mood"]) {
  const { duration, avoid, countries, languages, countriesRequired, languagesRequired } = filters;
  return criteriaSchema.safeParse({
    mood,
    maxMinutes: duration ? durations.find(([minutes]) => String(minutes) === duration)?.[0] ?? NaN : undefined,
    avoid: avoid || undefined,
    preferredCountries: countriesRequired ? [] : countries,
    requiredCountries: countriesRequired ? countries : [],
    preferredLanguages: languagesRequired ? [] : languages,
    requiredLanguages: languagesRequired ? languages : [],
  });
}
