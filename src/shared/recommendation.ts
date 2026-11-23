import { z } from "zod";
import { tmdbCollectionSchema } from "./franchises";

export const moods = {
  surprise: "Surprends-moi", laugh: "Envie de rire", tension: "Suspense et tension",
  strange: "Étrange / dérangeant", emotion: "Émotion", immersion: "Film prenant et immersif",
} as const;

const mood = z.enum(["surprise", "laugh", "tension", "strange", "emotion", "immersion"]);
const codes = z.array(z.string().regex(/^[A-Z]{2}$/)).max(20);
const languages = z.array(z.string().regex(/^[a-z]{2}$/)).max(20);
export const criteriaSchema = z.strictObject({
  mood, maxMinutes: z.number().int().min(1).max(600).optional(),
  energy: z.enum(["low", "high"]).optional(),
  avoid: mood.exclude(["surprise"]).optional(),
  preferredCountries: codes, requiredCountries: codes,
  preferredLanguages: languages, requiredLanguages: languages,
});
export type Criteria = z.infer<typeof criteriaSchema>;

export const tmdbReputationSchema = z.object({
  source: z.literal("TMDB"), average: z.number().min(0).max(10), count: z.number().int().nonnegative(),
});

export const metadataSchema = z.object({
  minutes: z.number().int().positive().optional(),
  countries: codes.default([]), language: z.string().regex(/^[a-z]{2}$/).optional(),
  genres: z.array(z.string()).default([]), directors: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  fullSynopsis: z.string().optional(), collection: tmdbCollectionSchema.nullable().optional(),
  synopsis: z.string().optional(), poster: z.string().regex(/^\/[a-zA-Z0-9_-]+\.jpg$/).optional(),
  reputation: tmdbReputationSchema.optional(),
  popularity: z.number().nonnegative().optional(),
  release: z.strictObject({
    source: z.literal("TMDB"),
    primaryDate: z.string().nullable().optional(), status: z.string().nullable().optional(),
    runtime: z.number().int().nullable().optional(),
    genres: z.array(z.object({ id: z.number().int().optional(), name: z.string() })).optional(),
    keywords: z.array(z.object({ id: z.number().int().optional(), name: z.string() })).optional(),
    events: z.array(z.object({ country: z.string().optional(), date: z.string(), type: z.number().int() })).optional(),
  }).optional(),
});
export type Metadata = z.infer<typeof metadataSchema>;

export const recommendationSchema = z.strictObject({
  connection: z.enum(["online", "cached", "unconfigured", "offline", "limited", "unauthorized", "unavailable"]),
  personalized: z.boolean(),
  status: z.enum(["ready", "empty", "no-match", "exhausted"]),
  films: z.array(z.strictObject({
    id: z.number().int(), title: z.string(), year: z.number().int().nullable(),
    metadata: metadataSchema, posterData: z.string().max(400_024).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/).optional(),
    category: z.enum(["safe", "gem", "wildcard"]),
    reasons: z.array(z.string()), warnings: z.array(z.string()),
  })).max(5),
});
export type Recommendation = z.infer<typeof recommendationSchema>;
