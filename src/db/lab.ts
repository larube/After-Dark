import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { affinityModels } from "../domain/affinity";
import { assignLabFilms, labHash, labProtocol, labRecentLimit, rankLabModels } from "../domain/lab";
import { engineVersion } from "../domain/recommendation";
import type { LabAnswer, LabResults, LabState } from "../shared/lab";
import type { Criteria } from "../shared/recommendation";
import type { CinemaDatabase, CinemaTransaction } from "./client";
import { writeFeedback } from "./feedback";
import { franchiseExclusions } from "./franchises";
import { readCatalogue, readHistory } from "./recommendations";
import { labProposals, labSessions, movieEvaluations, movies, movieStatuses } from "./schema";

type Reader = CinemaDatabase | CinemaTransaction;
type Proposal = typeof labProposals.$inferSelect;
type Session = typeof labSessions.$inferSelect;
const proposals = (db: Reader, sessionId: string) =>
  db.select().from(labProposals).where(eq(labProposals.sessionId, sessionId)).orderBy(labProposals.position).all();
const active = (db: Reader) => db.select().from(labSessions).where(eq(labSessions.open, 1)).get();

function state(session: Session, rows: Proposal[]): { public: LabState; poster?: string } {
  const next = rows.find((row) => row.answeredAt === null);
  const progress = { sessionId: session.id, total: rows.length, answered: rows.length - rows.filter((row) => row.answeredAt === null).length };
  if (session.paused) return { public: { status: "paused", ...progress } };
  if (!next) return { public: { status: "ready", ...progress } };
  const { poster, ...film } = next.film;
  return { public: { status: "voting", ...progress, position: next.position, film }, poster };
}

async function load(db: Reader): Promise<ReturnType<typeof state>> {
  const session = await active(db);
  return session ? state(session, await proposals(db, session.id)) : { public: { status: "idle" } };
}

export const currentLab = (db: CinemaDatabase) => db.transaction(load);

export function startLab(db: CinemaDatabase, criteria: Criteria, allowRepeats: boolean, now = new Date(), seed: string = randomUUID()) {
  return db.transaction(async (tx): Promise<ReturnType<typeof state>> => {
    const previous = await active(tx);
    if (previous) return state(previous, await proposals(tx, previous.id));

    const { catalogue, signals, movies: identities } = await readCatalogue(tx);
    const blocked = await franchiseExclusions(tx, identities);
    const { recent } = await readHistory(tx);
    const sessions = await tx.select({ id: labSessions.id }).from(labSessions)
      .where(isNotNull(labSessions.finishedAt)).orderBy(desc(labSessions.finishedAt), desc(labSessions.id)).limit(labRecentLimit);
    const labRecent = new Set<number>();
    for (const { id } of sessions) {
      for (const proposal of await proposals(tx, id)) labRecent.add(proposal.movieId);
    }
    const createdAt = now.toISOString();
    const referenceDate = createdAt.slice(0, 10);
    const selections = rankLabModels(catalogue, signals, criteria, recent, referenceDate, blocked);
    const { entries, repeated, collisions } = assignLabFilms(selections, labRecent, seed);
    if (entries.length < 2) return { public: { status: "insufficient" } };
    if (repeated === entries.length && !allowRepeats) return { public: { status: "no-new" } };

    const id = randomUUID();
    const classicHistory = [...recent];
    const labHistory = [...labRecent];
    const fingerprint = labHash({
      catalogue, signals, criteria, classicHistory, referenceDate, policy: "classic", engineVersion,
      excludedFranchises: blocked.size ? [...blocked].sort((a, b) => a - b) : undefined,
    });
    const session = await tx.insert(labSessions).values({
      id, open: 1, protocol: labProtocol, engine: engineVersion, seed, criteria, referenceDate,
      createdAt, selections, fingerprint, classicHistory, labHistory, repeated, collisions,
    }).returning().get();
    const films = new Map(catalogue.map((film) => [film.id, film]));
    const rows = await tx.insert(labProposals).values(entries.map(({ model, movieId, rank }, index) => {
      const { title, year, metadata: { minutes, poster, synopsis } } = films.get(movieId)!;
      return { sessionId: id, position: index + 1, model, movieId, originalRank: rank, film: { title, year, minutes, synopsis, poster } };
    })).returning().all();
    return state(session, rows.sort((a, b) => a.position - b.position));
  });
}

export function pauseLab(db: CinemaDatabase, sessionId: string, paused: boolean) {
  return db.transaction(async (tx) => {
    await tx.update(labSessions).set({ paused }).where(and(eq(labSessions.id, sessionId), eq(labSessions.open, 1))).run();
    return load(tx);
  });
}

export function abandonLab(db: CinemaDatabase, sessionId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    await tx.update(labSessions).set({ open: null, paused: false, abandonedAt: now.toISOString() })
      .where(and(eq(labSessions.id, sessionId), eq(labSessions.open, 1))).run();
    return load(tx);
  });
}

export function answerFor(row: Proposal): LabAnswer {
  const reason = row.reason ?? undefined;
  if (row.seen) return { seen: true, reason };
  if (!row.interest) throw new Error("Réponse absente.");
  return { seen: false, interest: row.interest, reason };
}

export function answerLab(db: CinemaDatabase, sessionId: string, position: number, answer: LabAnswer, now = new Date()) {
  return db.transaction(async (tx) => {
    const session = await active(tx);
    if (!session || session.id !== sessionId || session.paused) return load(tx);
    const rows = await proposals(tx, session.id);
    const next = rows.find((row) => row.answeredAt === null);
    // A retry for a previous position can read the new state but never overwrite an answer.
    if (next?.position !== position) return state(session, rows);
    await tx.update(labProposals).set({
      answeredAt: now.toISOString(), seen: answer.seen, interest: answer.seen ? null : answer.interest,
      reason: answer.reason || null,
    }).where(and(eq(labProposals.sessionId, session.id), eq(labProposals.position, position), isNull(labProposals.answeredAt))).run();
    return load(tx);
  });
}

export function finishLab(db: CinemaDatabase, sessionId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const session = await tx.select().from(labSessions).where(eq(labSessions.id, sessionId)).get();
    if (!session) return false;
    if (session.finishedAt) return true;
    if (session.paused || session.abandonedAt) return false;
    const rows = await proposals(tx, sessionId);
    if (rows.length < 2 || rows.some(({ answeredAt }) => !answeredAt)) return false;
    await tx.update(labSessions).set({ open: null, finishedAt: now.toISOString() })
      .where(and(eq(labSessions.id, sessionId), eq(labSessions.open, 1))).run();
    return true;
  });
}

async function completed(db: Reader) {
  return db.select().from(labSessions).where(isNotNull(labSessions.finishedAt))
    .orderBy(desc(labSessions.finishedAt), desc(labSessions.id)).all();
}

const abandoned = (db: Reader) => db.select().from(labSessions).where(isNotNull(labSessions.abandonedAt))
  .orderBy(desc(labSessions.abandonedAt), desc(labSessions.id)).all();

export const labSeenIds = async (db: Reader, ids: number[]) => new Set((await db.select({ id: labProposals.movieId })
  .from(labProposals).where(and(eq(labProposals.seen, true), inArray(labProposals.movieId, ids))).all()).map(({ id }) => id));

export function transferLabSeen(db: CinemaDatabase, sessionId: string, position: number, now = new Date()) {
  return db.transaction(async (tx) => {
    const row = await tx.select({ id: labProposals.movieId }).from(labProposals)
      .innerJoin(labSessions, eq(labSessions.id, labProposals.sessionId))
      .where(and(eq(labProposals.sessionId, sessionId), eq(labProposals.position, position),
        eq(labProposals.seen, true), isNotNull(labSessions.finishedAt))).get();
    if (!row) return { ok: false, error: "Aucune réponse « Déjà vu » dans cette séance terminée." } as const;
    const status = await tx.select({ status: movieStatuses.status }).from(movieStatuses)
      .where(eq(movieStatuses.movieId, row.id)).get();
    const evaluation = await tx.select({ id: movieEvaluations.id }).from(movieEvaluations)
      .where(eq(movieEvaluations.movieId, row.id)).get();
    if (status?.status === "seen" || evaluation) return { ok: true, data: null } as const;
    return writeFeedback(tx, { action: "mark_seen", movieId: row.id }, now);
  });
}

export function labResults(db: CinemaDatabase): Promise<LabResults> {
  return db.transaction(async (tx) => {
    const sessions = await completed(tx);
    const rows = await tx.select({ proposal: labProposals }).from(labProposals)
      .innerJoin(labSessions, eq(labSessions.id, labProposals.sessionId))
      .where(isNotNull(labSessions.finishedAt)).orderBy(labProposals.position).all();
    const models = affinityModels.map((model) => ({ model, eager: 0, maybe: 0, pass: 0, seen: 0 }));
    const counters = new Map(models.map((row) => [row.model, row]));
    const latest = sessions[0];
    const reviews: NonNullable<LabResults["latest"]>["reviews"] = [];
    for (const { proposal } of rows) {
      const answer = answerFor(proposal);
      counters.get(proposal.model)![answer.seen ? "seen" : answer.interest]++;
      if (proposal.sessionId === latest?.id) reviews.push({
        title: proposal.film.title, model: proposal.model, rank: proposal.originalRank, answer,
      });
    }
    const pending = await tx.select({
      sessionId: labProposals.sessionId, position: labProposals.position, movieId: labProposals.movieId,
      title: movies.displayTitle, year: movies.year,
    }).from(labProposals)
      .innerJoin(labSessions, eq(labSessions.id, labProposals.sessionId))
      .innerJoin(movies, eq(movies.id, labProposals.movieId))
      .leftJoin(movieStatuses, and(eq(movies.id, movieStatuses.movieId), eq(movieStatuses.status, "seen")))
      .leftJoin(movieEvaluations, eq(movies.id, movieEvaluations.movieId))
      .where(and(eq(labProposals.seen, true), isNotNull(labSessions.finishedAt),
        isNull(movieStatuses.movieId), isNull(movieEvaluations.movieId)))
      .orderBy(desc(labSessions.finishedAt), desc(labSessions.id), labProposals.position).all();
    const unique = new Map(pending.reverse().map(({ movieId, ...row }) => [movieId, row]));
    return {
      seenForCollection: [...unique.values()].reverse(),
      complete: sessions.length, incomplete: Number(!!await active(tx)) + (await abandoned(tx)).length, models,
      latest: latest ? { covered: reviews.length, collisions: latest.collisions, repeated: latest.repeated, reviews } : null,
    };
  });
}

export function exportLab(db: CinemaDatabase) {
  return db.transaction(async (tx) => {
    const sessions = await completed(tx);
    const open = await active(tx);
    async function progress(session: Session) {
      const rows = await proposals(tx, session.id);
      return {
        id: session.id, protocol: session.protocol, criteria: session.criteria, createdAt: session.createdAt,
        paused: session.paused, abandonedAt: session.abandonedAt, total: rows.length,
        responses: rows.filter((row) => row.answeredAt !== null).length,
      };
    }
    const pending = open ? await progress(open) : null;
    return {
      formatVersion: 1, pending, abandoned: await Promise.all((await abandoned(tx)).map(progress)),
      sessions: await Promise.all(sessions.map(async (session) => ({
        id: session.id, protocol: session.protocol, engine: session.engine, seed: session.seed,
        referenceDate: session.referenceDate, policy: "classic",
        criteria: session.criteria, fingerprint: session.fingerprint,
        createdAt: session.createdAt, finishedAt: session.finishedAt,
        selections: session.selections, classicHistory: session.classicHistory, labHistory: session.labHistory,
        collisions: session.collisions, repeated: session.repeated,
        proposals: (await proposals(tx, session.id)).map((row) => ({
          position: row.position, movieId: row.movieId, model: row.model, originalRank: row.originalRank,
          film: row.film, answeredAt: row.answeredAt, answer: answerFor(row),
        })),
      }))),
    };
  });
}
