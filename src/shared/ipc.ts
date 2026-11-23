import { z } from "zod";
import { feedbackEntrySchema, feedbackRequestSchema } from "./feedback";
import { labAnswerSchema, labPosition, labResultsSchema, labSessionId, labStateSchema } from "./lab";
import { criteriaSchema, recommendationSchema } from "./recommendation";
import { discoveryIdSchema, discoveryModeSchema, discoveryPosterSchema, discoveryViewSchema } from "./discovery";

const count = z.number().int().nonnegative();
const issue = z.strictObject({ entry: z.number().int().positive().optional(), path: z.string().optional(), message: z.string() });

export const reportSchema = z.strictObject({
  created: count,
  updated: count,
  duplicates: count,
  ambiguities: z.array(issue),
  errors: z.array(issue),
});

export const summarySchema = z.strictObject({
  movies: count,
  seen: count,
  unseen: count,
  evaluated: count,
  favorites: z.array(z.strictObject({ id: z.number().int(), title: z.string(), year: z.number().int().nullable() })).max(5),
});

export const importResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("cancelled") }),
  z.strictObject({ status: z.literal("completed"), report: reportSchema, summary: summarySchema }),
]);

function reply<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), data }),
    z.strictObject({ ok: z.literal(false), error: z.string().min(1) }),
  ]);
}

const enrichmentSchema = z.strictObject({
  total: count, enriched: count, skipped: count, pending: count,
  status: z.enum(["waiting", "working", "complete", "unconfigured", "offline", "limited", "unauthorized", "unavailable"]),
});
export type EnrichmentProgress = z.infer<typeof enrichmentSchema>;

export const ipc = {
  discoveryCurrent: { channel: "discovery:current", request: z.tuple([discoveryModeSchema]), response: reply(discoveryViewSchema.nullable()) },
  discoveryGenerate: { channel: "discovery:generate", request: z.tuple([discoveryModeSchema, discoveryIdSchema.nullable()]), response: reply(discoveryViewSchema.nullable()) },
  discoveryPosters: { channel: "discovery:posters", request: z.tuple([discoveryModeSchema, discoveryIdSchema, z.array(discoveryIdSchema).min(1).max(2)]), response: reply(z.array(discoveryPosterSchema).max(2)) },
  discoveryExport: { channel: "discovery:export", request: z.tuple([discoveryModeSchema, discoveryIdSchema]),
    response: reply(z.enum(["saved", "cancelled", "inactive", "dialog_failed", "generation_failed", "write_failed"])) },
  labCurrent: { channel: "lab:current", request: z.tuple([]), response: reply(labStateSchema) },
  labStart: { channel: "lab:start", request: z.tuple([criteriaSchema, z.boolean()]), response: reply(labStateSchema) },
  labPause: { channel: "lab:pause", request: z.tuple([labSessionId, z.boolean()]), response: reply(labStateSchema) },
  labAbandon: { channel: "lab:abandon", request: z.tuple([labSessionId]), response: reply(labStateSchema) },
  labAnswer: { channel: "lab:answer", request: z.tuple([labSessionId, labPosition, labAnswerSchema]), response: reply(labStateSchema) },
  labFinish: { channel: "lab:finish", request: z.tuple([labSessionId]), response: reply(z.null()) },
  labResults: { channel: "lab:results", request: z.tuple([]), response: reply(labResultsSchema) },
  labTransferSeen: { channel: "lab:transfer-seen", request: z.tuple([labSessionId, labPosition]), response: reply(z.null()) },
  labExport: { channel: "lab:export", request: z.tuple([]), response: reply(z.enum(["saved", "cancelled"])) },
  collection: { channel: "cinema:collection", request: z.tuple([]), response: reply(z.array(feedbackEntrySchema)) },
  deferViewing: { channel: "cinema:defer-viewing", request: z.tuple([z.number().int().positive()]), response: reply(z.null()) },
  saveFeedback: { channel: "cinema:feedback", request: z.tuple([feedbackRequestSchema]), response: reply(feedbackEntrySchema.nullable()) },
  enrichment: { channel: "profile:enrichment", request: z.tuple([]), response: reply(enrichmentSchema) },
  summary: { channel: "profile:summary", request: z.tuple([]), response: reply(summarySchema) },
  importProfile: { channel: "profile:import", request: z.tuple([]), response: reply(importResultSchema) },
  recommend: { channel: "cinema:recommend", request: z.tuple([criteriaSchema, z.boolean()]), response: reply(recommendationSchema) },
} as const;

export type ProfileSummary = z.infer<typeof summarySchema>;
export type ImportReport = z.infer<typeof reportSchema>;
export type DesktopApi = {
  [Key in keyof typeof ipc]: (...args: z.input<(typeof ipc)[Key]["request"]>) => Promise<z.infer<(typeof ipc)[Key]["response"]>>;
};
