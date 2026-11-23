import { z } from "zod";

export const labInterests = { eager: "Très envie de voir", maybe: "Pourquoi pas", pass: "Pas intéressé" } as const;
export const labModelSchema = z.enum(["current", "normalized", "rarity", "hybrid"]);
export const labInterestSchema = z.enum(["eager", "maybe", "pass"]);
const reason = z.string().trim().max(180).optional();
export const labAnswerSchema = z.discriminatedUnion("seen", [
  z.strictObject({ seen: z.literal(true), reason }),
  z.strictObject({ seen: z.literal(false), interest: labInterestSchema, reason }),
]);
export type LabAnswer = z.infer<typeof labAnswerSchema>;

export const labSessionId = z.uuid();
export const labPosition = z.number().int().min(1).max(4);
const count = z.number().int().nonnegative();
export const labFilmSchema = z.strictObject({
  title: z.string(), year: z.number().int().nullable(), minutes: z.number().int().positive().optional(),
  synopsis: z.string().optional(),
  posterData: z.string().max(400_024).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/).optional(),
});
const progress = { sessionId: labSessionId, total: labPosition, answered: count };
export const labStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("idle") }),
  z.strictObject({ status: z.literal("insufficient") }),
  z.strictObject({ status: z.literal("no-new") }),
  z.strictObject({ status: z.literal("paused"), ...progress }),
  z.strictObject({ status: z.literal("voting"), ...progress, position: labPosition, film: labFilmSchema }),
  z.strictObject({ status: z.literal("ready"), ...progress }),
]);
export const labResultsSchema = z.strictObject({
  complete: count, incomplete: count,
  models: z.array(z.strictObject({
    model: labModelSchema, eager: count, maybe: count, pass: count, seen: count,
  })),
  latest: z.strictObject({
    covered: count, collisions: count, repeated: count,
    reviews: z.array(z.strictObject({ title: z.string(), model: labModelSchema, rank: z.number().int().min(1).max(5), answer: labAnswerSchema })),
  }).nullable(),
});
export type LabState = z.infer<typeof labStateSchema>;
export type LabResults = z.infer<typeof labResultsSchema>;

export type LabFilmSnapshot = Omit<z.infer<typeof labFilmSchema>, "posterData"> & { poster?: string };
