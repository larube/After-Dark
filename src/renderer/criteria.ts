import { criteriaSchema, type Criteria } from "../shared/recommendation";

export function readCriteria(form: FormData, mood: Criteria["mood"]) {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const codes = (name: string, normalize: (value: string) => string) =>
    [...new Set(text(name).split(/[\s,]+/).filter(Boolean).map(normalize))];
  const upper = (value: string) => value.toUpperCase();
  const lower = (value: string) => value.toLowerCase();
  return criteriaSchema.safeParse({
    mood, maxMinutes: text("duration") ? Number(text("duration")) : undefined,
    energy: text("energy") || undefined, avoid: text("avoid") || undefined,
    preferredCountries: codes("preferredCountries", upper), requiredCountries: codes("requiredCountries", upper),
    preferredLanguages: codes("preferredLanguages", lower), requiredLanguages: codes("requiredLanguages", lower),
  });
}
