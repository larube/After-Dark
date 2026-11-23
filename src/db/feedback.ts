import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { FeedbackEntry, FeedbackRequest } from "../shared/feedback";
import type { CinemaDatabase, CinemaTransaction } from "./client";
import { movieEvaluations, movieFeedback, movies, movieStatuses } from "./schema";

function feedbackQuery(db: CinemaDatabase | CinemaTransaction) {
  return db.select({
    movieId: movieFeedback.movieId, title: movies.displayTitle, year: movies.year,
    intention: movieFeedback.intention, seenAt: movieFeedback.seenAt,
    score: movieEvaluations.score, appreciation: movieFeedback.appreciation,
  }).from(movieFeedback)
    .innerJoin(movies, eq(movies.id, movieFeedback.movieId))
    .leftJoin(movieEvaluations, eq(movieEvaluations.id, movieFeedback.scoreId));
}

function readEntry(row: Omit<FeedbackEntry, "score"> & { score: string | null }): FeedbackEntry {
  return { ...row, score: row.score === null ? null : Number(row.score) };
}

export async function getCollection(db: CinemaDatabase): Promise<FeedbackEntry[]> {
  return (await feedbackQuery(db).orderBy(desc(movieFeedback.seenAt), movies.displayTitle, movies.id).all()).map(readEntry);
}

export async function saveFeedback(db: CinemaDatabase, request: FeedbackRequest, now = new Date()) {
  return db.transaction(async (tx) => {
    const { movieId } = request;
    const movie = await tx.select({ id: movies.id }).from(movies).where(eq(movies.id, movieId)).get();
    if (!movie) return { ok: false, error: "Ce film n’est plus dans le catalogue." } as const;
    const saved = await tx.select().from(movieFeedback).where(eq(movieFeedback.movieId, movieId)).get();
    if (request.action === "intention") {
      const status = await tx.select().from(movieStatuses).where(eq(movieStatuses.movieId, movieId)).get();
      if (status?.status === "seen" && request.intention !== "none") {
        return { ok: false, error: "Ce film est déjà marqué comme vu." } as const;
      }
      if (request.intention === "none" && !saved?.seenAt) {
        await tx.delete(movieFeedback).where(eq(movieFeedback.movieId, movieId)).run();
        return { ok: true, data: null } as const;
      }
      await tx.insert(movieFeedback).values({ movieId, intention: request.intention })
        .onConflictDoUpdate({ target: movieFeedback.movieId, set: { intention: request.intention } }).run();
    } else {
      await tx.insert(movieStatuses).values({ movieId, status: "seen" })
        .onConflictDoUpdate({ target: movieStatuses.movieId, set: { status: "seen" } }).run();
      let scoreId = saved?.scoreId ?? null;
      if (request.score === null && scoreId !== null) {
        await tx.delete(movieEvaluations).where(eq(movieEvaluations.id, scoreId)).run();
        scoreId = null;
      } else if (request.score !== null) {
        const score = String(request.score);
        if (scoreId !== null) {
          await tx.update(movieEvaluations).set({ score }).where(eq(movieEvaluations.id, scoreId)).run();
        } else {
          const [evaluation] = await tx.insert(movieEvaluations).values({
            movieId, source: "after-dark:manual", sourceId: randomUUID(), kind: "score", score,
            evaluatedOn: now.toISOString().slice(0, 10),
          }).returning({ id: movieEvaluations.id });
          scoreId = evaluation.id;
        }
      }
      const changes = {
        intention: "none" as const, seenAt: saved?.seenAt ?? now.toISOString(),
        scoreId, appreciation: request.appreciation,
      };
      await tx.insert(movieFeedback).values({ movieId, ...changes })
        .onConflictDoUpdate({ target: movieFeedback.movieId, set: changes }).run();
    }
    const row = await feedbackQuery(tx).where(eq(movieFeedback.movieId, movieId)).get();
    if (!row) throw new Error("Retour introuvable après sauvegarde.");
    return { ok: true, data: readEntry(row) } as const;
  });
}
