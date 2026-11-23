import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, like } from "drizzle-orm";
import { normalizeTitle } from "../domain/ratings";
import { engineVersion, type Film, type Signal } from "../domain/recommendation";
import { importEntry, AmbiguousMovie } from "../import/profile";
import type { TmdbFilm } from "../main/tmdb";
import { metadataSchema, type Criteria, type Metadata, type Recommendation } from "../shared/recommendation";
import type { CinemaDatabase, CinemaTransaction } from "./client";
import { favorites, moodSessions, movieEvaluations, movieIdentifiers, movies, movieStatuses, recommendationHistory } from "./schema";

const decimal = (value: string | null) => value === null ? undefined : Number(value.replace(",", "."));
const defined = (metadata: Metadata) => Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));

export async function cacheFilm(db: CinemaDatabase, film: TmdbFilm, expectedMovieId?: number) {
  return db.transaction(async (tx) => {
    const movie = {
      canonicalId: "tmdb:" + film.tmdbId, tmdbId: film.tmdbId, displayTitle: film.title,
      originalTitle: film.originalTitle, year: film.year, aliases: film.aliases,
      externalIds: film.imdbId ? { imdb: film.imdbId } : undefined,
    };
    try {
      await importEntry(tx, { movie }, { releaseYears: film.releaseYears, expectedMovieId });
    } catch (error) {
      if (error instanceof AmbiguousMovie) return false;
      throw error;
    }
    const stored = await tx.select().from(movies).where(eq(movies.tmdbId, film.tmdbId)).get();
    if (!stored) return false;
    const previous = stored.metadata?.tmdb;
    const prior = previous && typeof previous === "object" && "data" in previous ? previous.data : undefined;
    const savedYears = previous && typeof previous === "object" && "releaseYears" in previous && Array.isArray(previous.releaseYears)
      ? previous.releaseYears.filter((year): year is number => Number.isInteger(year)) : [];
    const releaseYears = [...new Set([...savedYears, ...film.releaseYears])].sort((a, b) => a - b);
    const tmdb = { source: "TMDB", fetchedAt: film.fetchedAt, releaseYears, data: { ...Object(prior), ...defined(film.metadata) } };
    if (!isDeepStrictEqual(previous, tmdb)) {
      await tx.update(movies).set({ metadata: { ...stored.metadata, tmdb } }).where(eq(movies.id, stored.id)).run();
    }
    return true;
  });
}

export function normalizeMetadata(input: Record<string, unknown> | null): Metadata {
  const remote = input?.tmdb;
  const remoteData = remote && typeof remote === "object" && "data" in remote ? remote.data : undefined;
  const metadata = { ...Object(remoteData), ...input };
  // Validate fields independently so an invalid legacy field cannot hide other useful metadata.
  const read = <K extends keyof Metadata>(key: K) => {
    const shape = metadataSchema.shape[key];
    const result = shape.safeParse(metadata[key]);
    const fallback = result.success ? result : shape.safeParse(Object(remoteData)[key]);
    return fallback.success ? fallback.data as Metadata[K] : undefined;
  };
  const unique = (values: string[] | undefined) => [...new Map(values?.map((item) => [normalizeTitle(item), item])).values()];
  return {
    genres: unique(read("genres")), directors: unique(read("directors")), keywords: unique(read("keywords")),
    countries: unique(read("countries")), minutes: read("minutes"), language: read("language"),
    synopsis: read("synopsis")?.trim().slice(0, 280), poster: read("poster"), popularity: read("popularity"), release: read("release"),
  };
}

export async function readCatalogue(db: CinemaDatabase | CinemaTransaction) {
  const demo = await db.select({ movieId: movieIdentifiers.movieId }).from(movieIdentifiers)
    .where(and(eq(movieIdentifiers.namespace, "canonical"), like(movieIdentifiers.value, "demo:fictif-%")));
  const fictional = new Set(demo.map(({ movieId }) => movieId));
  const saved = await db.select({ movie: movies, status: movieStatuses.status })
    .from(movies).leftJoin(movieStatuses, eq(movies.id, movieStatuses.movieId)).orderBy(movies.id).all();
  const rows = saved.filter(({ movie }) => !fictional.has(movie.id));
  const ratings = await db.select().from(movieEvaluations).all();
  const preferences = await db.select().from(favorites).all();
  const rated = new Set(ratings.map(({ movieId }) => movieId));
  const catalogue: Film[] = rows.map(({ movie, status }) => ({
    id: movie.id, title: movie.displayTitle, year: movie.year,
    status: rated.has(movie.id) ? "seen" : status ?? "unknown", metadata: normalizeMetadata(movie.metadata),
  }));
  const signals = new Map(catalogue.filter(({ status }) => status !== "unseen").map((film) => [film.id, {
    film, ratings: [], spontaneous: false, memorable: false, rewatch: false,
  } satisfies Signal] as [number, Signal]));
  for (const rating of ratings) {
    const signal = signals.get(rating.movieId);
    if (!signal) continue;
    if (rating.kind === "qualitative") signal.ratings.push({ qualitative: rating.appreciation ?? undefined });
    else {
      const minimum = decimal(rating.rangeMin);
      const maximum = decimal(rating.rangeMax);
      const numeric = rating.kind === "historical_range" && minimum !== undefined && maximum !== undefined
        ? (minimum + maximum) / 2 : decimal(rating.score);
      if (numeric !== undefined && numeric >= 0 && numeric <= 10) signal.ratings.push({ numeric });
    }
  }
  for (const preference of preferences) {
    const signal = signals.get(preference.movieId);
    if (!signal) continue;
    signal.spontaneous ||= preference.spontaneous === true;
    signal.memorable ||= preference.memorable === true;
    signal.rewatch ||= preference.rewatch === true;
  }
  return {
    catalogue, signals: [...signals.values()].filter((signal) => signal.ratings.length || signal.spontaneous || signal.memorable || signal.rewatch),
    movies: rows.map(({ movie }) => movie),
  };
}

export async function readHistory(db: CinemaDatabase | CinemaTransaction) {
  const sessions = await db.select({ id: moodSessions.id }).from(moodSessions).orderBy(desc(moodSessions.id)).limit(1);
  const last = await db.select({ movieId: recommendationHistory.movieId })
    .from(recommendationHistory).orderBy(desc(recommendationHistory.moodSessionId), recommendationHistory.rank).limit(15);
  return { round: sessions[0]?.id ?? 0, recent: new Set(last.map(({ movieId }) => movieId)) };
}

export async function saveRecommendation(db: CinemaDatabase, criteria: Criteria, result: Recommendation, date: string) {
  return db.transaction(async (tx) => {
    const { mood, avoid, energy, ...constraints } = criteria;
    const session = await tx.insert(moodSessions).values({
      date, criteria: {
        ...constraints, energy, atmosphere: mood, surpriseMe: mood === "surprise",
        constraints: avoid ? ["avoid:" + avoid] : [],
      },
    }).returning({ id: moodSessions.id }).get();
    if (result.films.length) await tx.insert(recommendationHistory).values(result.films.map((film, index) => ({
      moodSessionId: session.id, movieId: film.id, rank: index + 1, engineVersion,
      explanation: JSON.stringify({ category: film.category, reasons: film.reasons, warnings: film.warnings }),
    }))).run();
  });
}
