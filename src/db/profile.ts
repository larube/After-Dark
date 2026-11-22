import { count, countDistinct, desc, eq } from "drizzle-orm";
import type { ProfileSummary } from "../shared/ipc";
import type { CinemaDatabase } from "./client";
import { favorites, movieEvaluations, movies, movieStatuses } from "./schema";

export async function getProfileSummary(db: CinemaDatabase): Promise<ProfileSummary> {
  const [movieCount, evaluatedCount, seenCount, unseenCount, spontaneous] = await Promise.all([
    db.select({ total: count() }).from(movies).get(),
    db.select({ total: countDistinct(movieEvaluations.movieId) }).from(movieEvaluations).get(),
    db.select({ total: count() }).from(movieStatuses).where(eq(movieStatuses.status, "seen")).get(),
    db.select({ total: count() }).from(movieStatuses).where(eq(movieStatuses.status, "unseen")).get(),
    db.selectDistinct({ id: movies.id, title: movies.displayTitle, year: movies.year })
      .from(favorites).innerJoin(movies, eq(movies.id, favorites.movieId))
      .where(eq(favorites.spontaneous, true)).orderBy(desc(movies.year), movies.displayTitle, movies.id).limit(5).all(),
  ]);
  return {
    movies: movieCount?.total ?? 0,
    evaluated: evaluatedCount?.total ?? 0,
    seen: seenCount?.total ?? 0,
    unseen: unseenCount?.total ?? 0,
    favorites: spontaneous,
  };
}
