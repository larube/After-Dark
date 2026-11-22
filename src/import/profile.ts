import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import type { CinemaDatabase, CinemaTransaction } from "../db/client";
import { favorites, movieEvaluations, movieIdentifiers, movies, movieStatuses, movieTitles } from "../db/schema";
import { normalizeTitle } from "../domain/ratings";
import type { ImportReport } from "../shared/ipc";
import { profileSchema, type ProfileEntry } from "../shared/profile";

type Movie = typeof movies.$inferSelect;
type MovieInput = ProfileEntry["movie"];
type Identifier = { namespace: string; value: string };
type Outcome = "created" | "updated" | "duplicates";

export class AmbiguousMovie extends Error {}

function suppliedIdentifiers(movie: MovieInput): Identifier[] {
  return [
    { namespace: "canonical", value: movie.canonicalId },
    ...Object.entries(movie.externalIds ?? {}).map(([namespace, value]) => ({ namespace, value })),
  ];
}

function compatibleYear(candidate: Movie, year: number | undefined, verifiedYears: readonly number[]) {
  if (year === undefined || candidate.year === null || candidate.year === year) return true;
  const cached = candidate.metadata?.tmdb;
  const cachedYears = cached && typeof cached === "object" && "releaseYears" in cached && Array.isArray(cached.releaseYears)
    ? cached.releaseYears as unknown[] : [];
  return Math.abs(candidate.year - year) <= 1 && (verifiedYears.includes(candidate.year) || cachedYears.includes(year));
}

async function conflicts(db: CinemaTransaction, candidate: Movie, movie: MovieInput, verifiedYears: readonly number[]) {
  if (!compatibleYear(candidate, movie.year, verifiedYears)) return true;
  if (movie.tmdbId !== undefined && candidate.tmdbId !== null && candidate.tmdbId !== movie.tmdbId) return true;
  const externalIds = movie.externalIds;
  if (!externalIds) return false;
  const saved = await db.select().from(movieIdentifiers).where(eq(movieIdentifiers.movieId, candidate.id)).all();
  return saved.some(({ namespace, value }) => namespace !== "canonical"
      && Object.hasOwn(externalIds, namespace) && externalIds[namespace] !== value);
}

async function resolveMovie(db: CinemaTransaction, movie: MovieInput, titles: string[], verifiedYears?: readonly number[]): Promise<Movie | undefined> {
  const matches = new Map<number, Movie>();
  for (const { namespace, value } of suppliedIdentifiers(movie)) {
    const found = (await db.select({ movie: movies }).from(movieIdentifiers)
      .innerJoin(movies, eq(movies.id, movieIdentifiers.movieId))
      .where(and(eq(movieIdentifiers.namespace, namespace), eq(movieIdentifiers.value, value))).get())?.movie;
    if (found) matches.set(found.id, found);
  }
  if (movie.tmdbId !== undefined) {
    const found = await db.select().from(movies).where(eq(movies.tmdbId, movie.tmdbId)).get();
    if (found) matches.set(found.id, found);
  }
  const identified = matches.values().next().value;
  if (matches.size > 1 || (identified && await conflicts(db, identified, movie, verifiedYears ?? []))) {
    throw new AmbiguousMovie("Les identifiants ou l’année contredisent les données du catalogue.");
  }
  if (identified) return identified;

  const names = [...new Set(titles.map(normalizeTitle))];
  const titleMatches = await db.selectDistinct({ movie: movies }).from(movieTitles)
    .innerJoin(movies, eq(movies.id, movieTitles.movieId))
    .where(inArray(movieTitles.normalizedTitle, names)).all();
  const candidates: Movie[] = [];
  for (const { movie: candidate } of titleMatches) {
    if (!await conflicts(db, candidate, movie, verifiedYears ?? [])) candidates.push(candidate);
    else if ((verifiedYears || (candidate.tmdbId !== null && movie.tmdbId === undefined)) && (candidate.year === null || movie.year === undefined || Math.abs(candidate.year - movie.year) <= 1)) {
      throw new AmbiguousMovie("Un titre voisin présente une année ou un identifiant contradictoire.");
    }
  }
  const [candidate] = candidates;
  if (candidates.length > 1 || (candidate && (candidate.year === null || movie.year === undefined))) {
    throw new AmbiguousMovie("Les variantes de titre et l’année ne suffisent pas à identifier un film unique.");
  }
  return candidate;
}

async function storeEvaluations(db: CinemaTransaction, movieId: number, evaluations: ProfileEntry["evaluations"]) {
  let changed = false;
  for (const evaluation of evaluations ?? []) {
    const { source, sourceId, kind } = evaluation;
    const saved = await db.select().from(movieEvaluations)
      .where(and(eq(movieEvaluations.source, source), eq(movieEvaluations.sourceId, sourceId))).get();
    const data = {
      movieId, source, sourceId, kind,
      score: kind === "score" || kind === "historical_score" ? String(evaluation.score) : null,
      rangeMin: kind === "historical_range" ? evaluation.min : null,
      rangeMax: kind === "historical_range" ? evaluation.max : null,
      appreciation: kind === "qualitative" ? evaluation.appreciation : null,
      evaluatedOn: evaluation.evaluatedOn ?? saved?.evaluatedOn ?? null,
    };
    if (!saved) {
      await db.insert(movieEvaluations).values(data).run();
      changed = true;
      continue;
    }

    if (!isDeepStrictEqual({ ...data, id: saved.id, evaluatedOn: saved.evaluatedOn }, saved)
      || (saved.evaluatedOn !== null && data.evaluatedOn !== saved.evaluatedOn)) {
      throw new Error(`L’évaluation ${source}/${sourceId} contredit une évaluation déjà conservée.`);
    }
    if (data.evaluatedOn !== saved.evaluatedOn) {
      await db.update(movieEvaluations).set({ evaluatedOn: data.evaluatedOn }).where(eq(movieEvaluations.id, saved.id)).run();
      changed = true;
    }
  }
  return changed;
}

async function storeFavorites(db: CinemaTransaction, movieId: number, preferences: ProfileEntry["favorites"]) {
  let changed = false;
  for (const { source, spontaneous, memorable, rewatch } of preferences ?? []) {
    const saved = await db.select().from(favorites)
      .where(and(eq(favorites.movieId, movieId), eq(favorites.source, source))).get();
    const data = {
      movieId, source,
      spontaneous: spontaneous ?? saved?.spontaneous ?? null,
      memorable: memorable ?? saved?.memorable ?? null,
      rewatch: rewatch ?? saved?.rewatch ?? null,
    };
    if (!isDeepStrictEqual(data, saved)) {
      await db.insert(favorites).values(data)
        .onConflictDoUpdate({ target: [favorites.movieId, favorites.source], set: data }).run();
      changed = true;
    }
  }
  return changed;
}

async function storeStatus(db: CinemaTransaction, movieId: number, incoming: ProfileEntry["status"], hasEvaluations: boolean) {
  const saved = await db.select().from(movieStatuses).where(eq(movieStatuses.movieId, movieId)).get();
  if (incoming === "unseen" && (hasEvaluations || await db.select({ id: movieEvaluations.id }).from(movieEvaluations)
    .where(eq(movieEvaluations.movieId, movieId)).get())) {
    throw new Error("Le statut explicitement non vu est incompatible avec une évaluation existante ou importée.");
  }
  const status = hasEvaluations ? "seen" : incoming;
  if (status === undefined || status === saved?.status || (status === "unknown" && saved)) return false;
  await db.insert(movieStatuses).values({ movieId, status })
    .onConflictDoUpdate({ target: movieStatuses.movieId, set: { status } }).run();
  return true;
}

export async function importEntry(db: CinemaTransaction, entry: ProfileEntry, identity?: { releaseYears: readonly number[]; expectedMovieId?: number }): Promise<Outcome> {
  const { movie } = entry;
  const titles = [...new Set([movie.displayTitle, ...(movie.originalTitle ? [movie.originalTitle] : []), ...(movie.aliases ?? [])])];
  const existing = await resolveMovie(db, movie, titles, identity?.releaseYears);
  if (identity?.expectedMovieId !== undefined && existing?.id !== identity.expectedMovieId) {
    throw new AmbiguousMovie("Le résultat TMDB ne désigne pas de façon certaine le film à enrichir.");
  }
  const movieId = existing?.id ?? (await db.insert(movies).values({
    displayTitle: movie.displayTitle, originalTitle: movie.originalTitle, year: movie.year,
    tmdbId: movie.tmdbId, metadata: movie.metadata,
  }).returning({ id: movies.id }).get()).id;
  let enriched = false;
  if (existing) {
    const data = {
      originalTitle: existing.originalTitle ?? movie.originalTitle ?? null,
      year: existing.year ?? movie.year ?? null,
      tmdbId: existing.tmdbId ?? movie.tmdbId ?? null,
      metadata: movie.metadata === undefined ? existing.metadata : { ...movie.metadata, ...existing.metadata },
    };
    if (!isDeepStrictEqual({ ...existing, ...data }, existing)) {
      await db.update(movies).set(data).where(eq(movies.id, movieId)).run();
      enriched = true;
    }
  }

  const identifiers = await db.insert(movieIdentifiers).values(suppliedIdentifiers(movie).map((id) => ({ ...id, movieId })))
    .onConflictDoNothing().run();
  const aliases = await db.insert(movieTitles).values(titles.map((title) => ({ title, movieId, normalizedTitle: normalizeTitle(title) })))
    .onConflictDoNothing().run();
  const statusChanged = await storeStatus(db, movieId, entry.status, !!entry.evaluations?.length);
  const evaluationsChanged = await storeEvaluations(db, movieId, entry.evaluations);
  const favoritesChanged = await storeFavorites(db, movieId, entry.favorites);
  if (!existing) return "created";
  return enriched || identifiers.rowsAffected > 0 || aliases.rowsAffected > 0 || statusChanged || evaluationsChanged || favoritesChanged
    ? "updated" : "duplicates";
}

export async function importProfile(db: CinemaDatabase, input: unknown): Promise<ImportReport> {
  const report: ImportReport = { created: 0, updated: 0, duplicates: 0, ambiguities: [], errors: [] };
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    report.errors = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."), message: issue.message,
    }));
    return report;
  }

  return db.transaction(async (tx) => {
    for (const [index, entry] of parsed.data.entries.entries()) {
      try {
        const result = await tx.transaction((row) => importEntry(row, entry));
        report[result]++;
      } catch (error) {
        const issue = {
          entry: index + 1,
          path: entry.movie.canonicalId,
          message: error instanceof Error ? error.message : "Échec de l’enregistrement.",
        };
        (error instanceof AmbiguousMovie ? report.ambiguities : report.errors).push(issue);
      }
    }
    return report;
  });
}
