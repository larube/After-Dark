import { and, eq, inArray, notLike } from "drizzle-orm";
import type { CinemaDatabase } from "./client";
import { movieIdentifiers, movieTitles, movies } from "./schema";

export async function enrichmentQueue(db: CinemaDatabase) {
  const imported = db.select({ id: movieIdentifiers.movieId }).from(movieIdentifiers)
    .where(and(eq(movieIdentifiers.namespace, "canonical"),
      notLike(movieIdentifiers.value, "tmdb:%"), notLike(movieIdentifiers.value, "demo:fictif-%")));
  const identifiers = await db.select().from(movieIdentifiers)
    .where(and(eq(movieIdentifiers.namespace, "imdb"), inArray(movieIdentifiers.movieId, imported)));
  const imdb = new Map(identifiers.map(({ movieId, value }) => [movieId, value]));
  const moviesInProfile = await db.select().from(movies).where(inArray(movies.id, imported)).orderBy(movies.id);
  const titles = new Map<number, Set<string>>();
  const aliases = await db.select().from(movieTitles)
    .where(inArray(movieTitles.movieId, imported)).orderBy(movieTitles.title);
  for (const alias of aliases) {
    if (!titles.has(alias.movieId)) titles.set(alias.movieId, new Set());
    titles.get(alias.movieId)?.add(alias.title);
  }
  const jobs = moviesInProfile.map((movie) => {
    const names = [...new Set([movie.displayTitle, movie.originalTitle, ...(titles.get(movie.id) ?? [])])]
      .filter((value): value is string => !!value);
    const imdbId = imdb.get(movie.id);
    const identity = JSON.stringify([movie.tmdbId, imdbId, movie.year, names]);
    return { movie, names, imdbId, identity };
  });
  const enriched = jobs.filter(({ movie }) => {
    const tmdb = movie.metadata?.tmdb;
    return movie.tmdbId !== null && !!tmdb && typeof tmdb === "object" && "fetchedAt" in tmdb && typeof tmdb.fetchedAt === "string";
  });
  const enrichedIds = new Set(enriched.map(({ movie }) => movie.id));
  const remaining = jobs.filter(({ movie }) => !enrichedIds.has(movie.id));
  const pending = remaining.filter(({ movie, identity }) => movie.metadata?.tmdbEnrichment !== identity);
  return { total: jobs.length, enriched: enriched.length, skipped: remaining.length - pending.length, pending };
}

export async function checkpointUnmatched(db: CinemaDatabase, movieId: number, identity: string) {
  const movie = await db.select().from(movies).where(eq(movies.id, movieId)).get();
  if (movie) await db.update(movies).set({ metadata: { ...movie.metadata, tmdbEnrichment: identity } })
    .where(eq(movies.id, movieId)).run();
}
