import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { discoveryModes } from "../shared/discovery";
import { blindCalibrationProtocol, calibrationVotes, planBlindCalibration, type CalibrationVote } from "./calibration";

const arm = z.enum(["A", "B", "C", "D"]);
const proposal = z.object({
  movieId: z.number().int().positive(), title: z.string(), arm, rank: z.number().int().positive(),
  response: z.enum(calibrationVotes).optional(),
});
const report = z.object({
  protocol: z.enum(["discovery-calibration-v1", blindCalibrationProtocol]),
  engine: z.string(), mode: z.enum(discoveryModes), date: z.string(), seed: z.string(),
  fingerprint: z.string(), catalogueFingerprint: z.string().optional(),
  preferences: z.object({ lessIndianCinema: z.boolean(), preferFrUs1960To1979: z.boolean() }),
  collisions: z.number().int().nonnegative(), coveredArms: z.number().int().min(0).max(4), totalArms: z.literal(4),
  poolLimit: z.number().int().positive().optional(),
  poolSizes: z.record(arm, z.number().int().nonnegative()).optional(),
  responses: z.array(proposal).max(4),
}).refine(({ responses, coveredArms }) => responses.length <= coveredArms &&
  new Set(responses.map(({ movieId }) => movieId)).size === responses.length &&
  new Set(responses.map(({ arm }) => arm)).size === responses.length);

const session = report.safeExtend({
  id: z.string(), startedAt: z.string().nullable(), status: z.enum(["completed", "abandoned"]),
}).refine(({ status, responses, coveredArms }) => status === "abandoned" ||
  (responses.length === coveredArms && responses.length > 0 && responses.every(({ response }) => response !== undefined)));

const historySchema = z.object({ version: z.literal(1), sessions: z.array(session) });
type Session = z.infer<typeof session>;
type History = z.infer<typeof historySchema>;

export function presentedFilms(history: History) {
  return new Set(history.sessions.filter(({ status }) => status === "completed")
    .flatMap(({ responses }) => responses.map(({ movieId }) => movieId)));
}

export function importCalibrationReport(history: History, data: unknown) {
  const envelope = z.object({ status: z.literal("completed").optional(), startedAt: z.string().nullish() }).parse(data);
  const legacy = report.parse(data);
  if (legacy.protocol === blindCalibrationProtocol && envelope.status !== "completed") {
    throw new Error("Seuls les bilans terminés peuvent être importés.");
  }
  const imported = session.parse({ ...legacy, id: `import:${legacy.fingerprint}:${legacy.mode}`,
    startedAt: envelope.startedAt ?? null, status: "completed" });
  // A report exported by this tool may already have been saved under its session UUID.
  if (history.sessions.some(({ status, fingerprint, mode }) =>
    status === "completed" && fingerprint === imported.fingerprint && mode === imported.mode)) return false;
  history.sessions.push(imported);
  return true;
}

export function summarizeCalibrationHistory(history: History) {
  const completed = history.sessions.filter(({ status }) => status === "completed");
  return {
    completed: completed.length, abandoned: history.sessions.length - completed.length,
    distinctFilms: presentedFilms(history).size,
    sessions: history.sessions.map(({ id, startedAt, date, protocol, mode, collisions, coveredArms, totalArms, status }) =>
      ({ id, startedAt, date, protocol, mode, collisions, coveredArms, totalArms, status })),
    groups: [...new Set(completed.map(({ protocol, mode }) => `${protocol}/${mode}`))].map((group) => {
      const responses = completed.filter(({ protocol, mode }) => `${protocol}/${mode}` === group)
        .flatMap((entry) => entry.responses);
      return { group, arms: arm.options.map((model) => {
        const votes = responses.filter(({ arm }) => arm === model);
        return { arm: model, total: votes.length, responses: Object.fromEntries(calibrationVotes
          .map((label) => [label, votes.filter(({ response }) => response === label).length])) };
      }) };
    }),
  };
}

export async function readCalibrationHistory(file: string): Promise<History> {
  try {
    return historySchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, sessions: [] };
    throw new Error("Impossible de lire l’historique local de calibration.");
  }
}

export async function withCalibrationHistory<T>(file: string,
  action: (history: History, save: () => Promise<void>) => Promise<T>) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const lock = file + ".lock";
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Historique verrouillé. Vérifiez si une autre séance est ouverte.");
    }
    throw error;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const history = await readCalibrationHistory(file);
    return await action(history, async () => {
      await writeFile(temporary, JSON.stringify(historySchema.parse(history), null, 2) + "\n", { mode: 0o600 });
      await rename(temporary, file);
    });
  } finally {
    await rm(temporary, { force: true });
    await rmdir(lock);
  }
}

type BlindPlan = ReturnType<typeof planBlindCalibration>;
type BlindCard = BlindPlan["proposals"][number]["card"];

export async function recordBlindSession(history: History, save: () => Promise<void>, { proposals, ...plan }: BlindPlan,
  vote: (card: BlindCard, index: number, total: number) => Promise<CalibrationVote | undefined>) {
  if (plan.coveredArms !== plan.totalArms) return null;
  const entry: Session = { ...plan, id: randomUUID(), startedAt: new Date().toISOString(),
    status: "abandoned", responses: [] };
  history.sessions.push(entry);
  for (const { card, ...proposal } of proposals) {
    const presented: Session["responses"][number] = proposal;
    entry.responses.push(presented);
    await save();
    const answer = await vote(card, entry.responses.length, proposals.length);
    if (answer === undefined) return null;
    presented.response = answer;
    if (entry.responses.length === proposals.length) entry.status = "completed";
    await save();
  }
  return entry;
}
