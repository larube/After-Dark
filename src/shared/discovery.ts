import { z } from "zod";

export const discoveryModes = ["gems", "affinities", "offbeat"] as const;
export const discoveryModeSchema = z.enum(discoveryModes);
export type DiscoveryMode = z.infer<typeof discoveryModeSchema>;
export const discoveryIdSchema = z.number().int().positive();

export const discoveryFilmSchema = z.strictObject({
  id: discoveryIdSchema,
  title: z.string(),
  year: z.number().int().nullable(),
  minutes: z.number().int().positive().optional(),
  genres: z.array(z.string()).max(3),
  synopsis: z.string().optional(),
  reason: z.string(),
  posterData: z.string().max(400_024).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/).optional(),
});
export const discoveryViewSchema = z.strictObject({
  id: discoveryIdSchema,
  films: z.array(discoveryFilmSchema).max(8),
  renewed: z.number().int().min(0).max(8).nullable(),
  eligible: z.number().int().nonnegative(),
});
export type DiscoveryView = z.infer<typeof discoveryViewSchema>;
export type DiscoveryFilm = z.infer<typeof discoveryFilmSchema>;
