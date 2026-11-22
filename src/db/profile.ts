import { count, countDistinct, desc, eq } from "drizzle-orm";
import type { ProfileSummary } from "../shared/ipc";
import type { CinemaDatabase } from "./client";
import { favorites, movieEvaluations, movies, movieStatuses } from "./schema";

export function getProfileSummary(db: CinemaDatabase): ProfileSummary {
  return {
    movies: db.select({ total: count() }).from(movies).get()!.total,
    evaluated: db.select({ total: countDistinct(movieEvaluations.movieId) }).from(movieEvaluations).get()!.total,
    seen: db.select({ total: count() }).from(movieStatuses).where(eq(movieStatuses.status, "seen")).get()!.total,
    unseen: db.select({ total: count() }).from(movieStatuses).where(eq(movieStatuses.status, "unseen")).get()!.total,
    favorites: db.selectDistinct({ id: movies.id, title: movies.displayTitle, year: movies.year })
      .from(favorites).innerJoin(movies, eq(movies.id, favorites.movieId))
      .where(eq(favorites.spontaneous, true)).orderBy(desc(movies.year), movies.displayTitle, movies.id).limit(5).all(),
  };
}
