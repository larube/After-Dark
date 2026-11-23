import { z } from "zod";

export const franchiseKey = z.string().regex(/^(harry-potter|godzilla|collection:[1-9][0-9]{0,14})$/);
export const franchiseSchema = z.object({
  key: franchiseKey, name: z.string(), blocked: z.boolean(),
  films: z.array(z.object({ title: z.string(), year: z.number().int().nullable() })),
});
export type Franchise = z.infer<typeof franchiseSchema>;

export const tmdbCollectionSchema = z.object({ id: z.number().int().positive(), name: z.string().trim().min(1) });
