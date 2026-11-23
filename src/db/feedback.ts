import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import type { FeedbackEntry, FeedbackRequest } from "../shared/feedback";
import type { CinemaDatabase, CinemaTransaction } from "./client";
import { movieEvaluations, movieFeedback, movies, movieStatuses, plannedViewings } from "./schema";

function feedbackQuery(db: CinemaDatabase | CinemaTransaction) {
  return db.select({
    movieId: movies.id, title: movies.displayTitle, year: movies.year,
    intention: movieFeedback.intention, seenAt: movieFeedback.seenAt,
    score: movieEvaluations.score, appreciation: movieFeedback.appreciation,
    selectedAt: plannedViewings.selectedAt,
    hasImportedWholeScore: sql<number>`exists (
      select 1 from movie_evaluations as historical
      where historical.movie_id = ${movies.id} and historical.id IS NOT ${movieFeedback.scoreId}
        and historical.kind in ('score', 'historical_score')
        and (case
          when historical.score glob '*[.,]*' then rtrim(rtrim(historical.score, '0'), '.,')
          else historical.score
        end) in ('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10')
    )`,
  }).from(movies)
    .leftJoin(movieFeedback, eq(movieFeedback.movieId, movies.id))
    .leftJoin(movieEvaluations, eq(movieEvaluations.id, movieFeedback.scoreId))
    .leftJoin(movieStatuses, eq(movieStatuses.movieId, movies.id))
    .leftJoin(plannedViewings, and(eq(plannedViewings.movieId, movies.id), eq(plannedViewings.status, "planned"),
      sql`coalesce(${movieStatuses.status}, 'unknown') != 'seen'`));
}

function readEntry(row: Awaited<ReturnType<ReturnType<typeof feedbackQuery>["all"]>>[number], startup?: string): FeedbackEntry {
  const { selectedAt, hasImportedWholeScore, ...entry } = row;
  return {
    ...entry, intention: row.intention ?? "none", score: row.score === null ? null : Number(row.score),
    ...(selectedAt ? { selectedAt, needsConfirmation: !!startup && selectedAt < startup } : {}),
    ...(hasImportedWholeScore ? { hasImportedWholeScore: true } : {}),
  };
}

const hasEntry = or(isNotNull(movieFeedback.movieId), isNotNull(plannedViewings.id));

export async function getCollection(db: CinemaDatabase, startup?: string): Promise<FeedbackEntry[]> {
  const rows = await feedbackQuery(db).where(hasEntry).orderBy(desc(movieFeedback.seenAt), movies.displayTitle, movies.id).all();
  return rows.map((row) => readEntry(row, startup));
}

export async function saveFeedback(db: CinemaDatabase, request: FeedbackRequest, now = new Date(), startup?: string) {
  return db.transaction((tx) => writeFeedback(tx, request, now, startup));
}

export async function writeFeedback(tx: CinemaTransaction, request: FeedbackRequest | { action: "mark_seen"; movieId: number },
  now: Date, startup?: string) {
  const { movieId } = request;
  const movie = await tx.select().from(movies).where(eq(movies.id, movieId)).get();
  if (!movie) return { ok: false, error: "Ce film n’est plus dans le catalogue." } as const;
  const saved = await tx.select().from(movieFeedback).where(eq(movieFeedback.movieId, movieId)).get();
  const status = await tx.select().from(movieStatuses).where(eq(movieStatuses.movieId, movieId)).get();
  const active = and(eq(plannedViewings.movieId, movieId), eq(plannedViewings.status, "planned"));
  const stamp = now.toISOString();

  async function entry() {
    const row = await feedbackQuery(tx).where(and(eq(movies.id, movieId), hasEntry)).get();
    return { ok: true, data: row ? readEntry(row, startup) : null } as const;
  }

  if (request.action === "launch") {
    if (status?.status === "seen") return { ok: false, error: "Ce film est déjà marqué comme vu." } as const;
    await tx.insert(plannedViewings).values({ movieId, selectedAt: stamp }).onConflictDoNothing().run();
    if (saved?.intention === "tonight" || saved?.intention === "not_interested") {
      await tx.delete(movieFeedback).where(eq(movieFeedback.movieId, movieId)).run();
    }
    return entry();
  }
  if (request.action === "cancel_viewing") {
    await tx.update(plannedViewings).set({ status: "cancelled" }).where(active).run();
    return entry();
  }
  if (request.action === "confirm_viewing") {
    const viewing = await tx.select({ id: plannedViewings.id }).from(plannedViewings).where(active).get();
    if (!viewing) return entry();
  }
  if (request.action === "evaluate" && !saved?.seenAt) {
    return { ok: false, error: "Confirmez d’abord le visionnage de ce film." } as const;
  }
  if (request.action === "undo_seen") {
    if (!saved?.seenAt) return entry();
    const otherEvaluation = await tx.select({ id: movieEvaluations.id }).from(movieEvaluations)
      .where(and(eq(movieEvaluations.movieId, movieId), saved.scoreId === null ? undefined : ne(movieEvaluations.id, saved.scoreId))).get();
    if (otherEvaluation || saved.previousStatus === "seen") {
      return { ok: false, error: "Ce film était déjà vu selon votre profil ou possède une autre évaluation." } as const;
    }
    await tx.update(plannedViewings).set({ status: "cancelled", watchedAt: null }).where(and(
      eq(plannedViewings.movieId, movieId), eq(plannedViewings.status, "watched"), eq(plannedViewings.watchedAt, saved.seenAt),
    )).run();
    await tx.delete(movieFeedback).where(eq(movieFeedback.movieId, movieId)).run();
    if (saved.scoreId !== null) await tx.delete(movieEvaluations).where(eq(movieEvaluations.id, saved.scoreId)).run();
    await tx.update(movieStatuses).set({ status: saved.previousStatus ?? "unknown" })
      .where(eq(movieStatuses.movieId, movieId)).run();
    return { ok: true, data: null } as const;
  }
  if (request.action === "intention") {
    if (status?.status === "seen" && request.intention !== "none") {
      return { ok: false, error: "Ce film est déjà marqué comme vu." } as const;
    }
    if (request.intention === "not_interested" || request.intention === "tonight") {
      await tx.update(plannedViewings).set({ status: "cancelled" }).where(active).run();
    }
    if (request.intention === "none" && !saved?.seenAt) {
      await tx.delete(movieFeedback).where(eq(movieFeedback.movieId, movieId)).run();
      return entry();
    }
    await tx.insert(movieFeedback).values({ movieId, intention: request.intention })
      .onConflictDoUpdate({ target: movieFeedback.movieId, set: { intention: request.intention } }).run();
  } else {
    const seenAt = saved?.seenAt ?? stamp;
    await tx.update(plannedViewings).set({ status: "watched", watchedAt: seenAt }).where(active).run();
    await tx.insert(movieStatuses).values({ movieId, status: "seen" })
      .onConflictDoUpdate({ target: movieStatuses.movieId, set: { status: "seen" } }).run();
    let scoreId = saved?.scoreId ?? null;
    const value = request.action === "confirm_viewing" || request.action === "mark_seen" ? undefined : request;
    if (value?.score === null && scoreId !== null) {
      await tx.delete(movieEvaluations).where(eq(movieEvaluations.id, scoreId)).run();
      scoreId = null;
    } else if (value?.score != null) {
      const score = String(value.score);
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
      intention: "none" as const, seenAt,
      previousStatus: saved?.seenAt ? saved.previousStatus : status?.status ?? null,
      scoreId, appreciation: value ? value.appreciation : saved?.appreciation ?? null,
    };
    await tx.insert(movieFeedback).values({ movieId, ...changes })
      .onConflictDoUpdate({ target: movieFeedback.movieId, set: changes }).run();
  }
  return entry();
}
