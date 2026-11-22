import { z } from "zod";
import { compareDecimals } from "../domain/ratings";

const cleaned = z.string().trim().min(1);
const nonBlank = z.string().refine((value) => value.trim().length > 0, "Texte obligatoire");
const decimal = z.string().regex(/^(?:[0-9](?:[.,][0-9]+)?|10(?:[.,]0+)?)$/, "Note historique attendue sous forme de texte, de 0 à 10");
const provenance = { source: cleaned, sourceId: cleaned, evaluatedOn: z.iso.date().optional() };

export const newScore = z.number().int().min(0).max(10);
export const watchStatus = z.enum(["seen", "unseen", "unknown"]);
export const evaluationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...provenance, kind: z.literal("score"), score: newScore }),
  z.strictObject({ ...provenance, kind: z.literal("historical_score"), score: decimal }),
  z.strictObject({ ...provenance, kind: z.literal("historical_range"), min: decimal, max: decimal }),
  z.strictObject({ ...provenance, kind: z.literal("qualitative"), appreciation: nonBlank }),
]).refine((value) => value.kind !== "historical_range" || compareDecimals(value.min, value.max) <= 0, {
  message: "La borne minimale dépasse la borne maximale",
  path: ["max"],
});

const favoriteSchema = z.strictObject({
  source: cleaned,
  spontaneous: z.boolean().optional(),
  memorable: z.boolean().optional(),
  rewatch: z.boolean().optional(),
}).refine((value) => value.spontaneous !== undefined || value.memorable !== undefined || value.rewatch !== undefined,
  "Au moins une préférence est requise");

const movieSchema = z.strictObject({
  canonicalId: cleaned,
  displayTitle: cleaned,
  originalTitle: cleaned.optional(),
  year: z.number().int().min(1).max(9999).optional(),
  tmdbId: z.number().int().positive().optional(),
  externalIds: z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/).refine((id) => !["tmdb", "canonical"].includes(id)), cleaned).optional(),
  aliases: z.array(cleaned).optional(),
  metadata: z.record(z.string(), z.json()).optional(),
});

export const profileEntrySchema = z.strictObject({
  movie: movieSchema,
  status: watchStatus.optional(),
  favorites: z.array(favoriteSchema).optional(),
  evaluations: z.array(evaluationSchema).optional(),
}).refine((entry) => entry.status !== "unseen" || !entry.evaluations?.length, {
  message: "Un film explicitement non vu ne peut pas être évalué",
  path: ["evaluations"],
});

export const profileSchema = z.strictObject({ version: z.literal(1), entries: z.array(profileEntrySchema) });
export type ProfileEntry = z.infer<typeof profileEntrySchema>;

const list = z.array(cleaned).default([]);
export const moodSchema = z.strictObject({
  date: z.iso.datetime({ offset: true }),
  energy: cleaned.optional(),
  atmosphere: cleaned.optional(),
  experience: cleaned.optional(),
  maxMinutes: z.number().int().positive().optional(),
  preferredCountries: list,
  requiredCountries: list,
  preferredLanguages: list,
  requiredLanguages: list,
  constraints: z.array(cleaned).default([]),
  surpriseMe: z.boolean().default(false),
});
export type Mood = z.output<typeof moodSchema>;
