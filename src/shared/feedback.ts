import { z } from "zod";
import { newScore as score } from "./profile";

export const intentions = ["none", "watch_later", "tonight", "not_interested"] as const;
export const intentionSchema = z.enum(intentions);
export type Intention = z.infer<typeof intentionSchema>;

const movieId = z.number().int().positive();
const appreciation = z.string().trim().min(1).max(1000);

export const feedbackRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("undo_seen"), movieId }),
  z.strictObject({ action: z.literal("intention"), movieId, intention: intentionSchema }),
  z.strictObject({ action: z.literal("seen"), movieId, score: score.nullable(), appreciation: appreciation.nullable() }),
]);

export const feedbackEntrySchema = z.strictObject({
  movieId,
  title: z.string(),
  year: z.number().int().nullable(),
  intention: intentionSchema,
  seenAt: z.iso.datetime().nullable(),
  score: score.nullable(),
  appreciation: appreciation.nullable(),
});

export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;
export type FeedbackEntry = z.infer<typeof feedbackEntrySchema>;
