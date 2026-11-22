import { z } from "zod";
import { criteriaSchema, recommendationSchema } from "./recommendation";

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
