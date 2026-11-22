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

class AmbiguousMovie extends Error {}

function suppliedIdentifiers(movie: MovieInput): Identifier[] {
  return [
    { namespace: "canonical", value: movie.canonicalId },
    ...Object.entries(movie.externalIds ?? {}).map(([namespace, value]) => ({ namespace, value })),
  ];
}

function conflicts(db: CinemaTransaction, candidate: Movie, movie: MovieInput) {
  if (movie.year !== undefined && candidate.year !== null && candidate.year !== movie.year) return true;
  if (movie.tmdbId !== undefined && candidate.tmdbId !== null && candidate.tmdbId !== movie.tmdbId) return true;
  const externalIds = movie.externalIds;
  if (!externalIds) return false;
  return db.select().from(movieIdentifiers).where(eq(movieIdentifiers.movieId, candidate.id)).all()
    .some(({ namespace, value }) => namespace !== "canonical"
      && Object.hasOwn(externalIds, namespace) && externalIds[namespace] !== value);
}

function resolveMovie(db: CinemaTransaction, movie: MovieInput, titles: string[]): Movie | undefined {
  const matches = new Map<number, Movie>();
  for (const { namespace, value } of suppliedIdentifiers(movie)) {
    const found = db.select({ movie: movies }).from(movieIdentifiers)
      .innerJoin(movies, eq(movies.id, movieIdentifiers.movieId))
      .where(and(eq(movieIdentifiers.namespace, namespace), eq(movieIdentifiers.value, value))).get()?.movie;
    if (found) matches.set(found.id, found);
  }
  if (movie.tmdbId !== undefined) {
    const found = db.select().from(movies).where(eq(movies.tmdbId, movie.tmdbId)).get();
    if (found) matches.set(found.id, found);
  }
  const identified = matches.values().next().value;
  if (matches.size > 1 || (identified && conflicts(db, identified, movie))) {
    throw new AmbiguousMovie("Les identifiants ou l’année contredisent les données du catalogue.");
  }
  if (identified) return identified;

  const names = [...new Set(titles.map(normalizeTitle))];
  const candidates = db.selectDistinct({ movie: movies }).from(movieTitles)
    .innerJoin(movies, eq(movies.id, movieTitles.movieId))
    .where(inArray(movieTitles.normalizedTitle, names)).all()
    .map((row) => row.movie).filter((candidate) => !conflicts(db, candidate, movie));
  const [candidate] = candidates;
  if (candidates.length > 1 || (candidate && (candidate.year === null || movie.year === undefined))) {
    throw new AmbiguousMovie("Les variantes de titre et l’année ne suffisent pas à identifier un film unique.");
  }
  return candidate;
}

function storeEvaluations(db: CinemaTransaction, movieId: number, evaluations: ProfileEntry["evaluations"]) {
  let changed = false;
  for (const evaluation of evaluations ?? []) {
    const { source, sourceId, kind } = evaluation;
    const saved = db.select().from(movieEvaluations)
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
      db.insert(movieEvaluations).values(data).run();
      changed = true;
      continue;
    }

    if (!isDeepStrictEqual({ ...data, id: saved.id, evaluatedOn: saved.evaluatedOn }, saved)
      || (saved.evaluatedOn !== null && data.evaluatedOn !== saved.evaluatedOn)) {
      throw new Error(`L’évaluation ${source}/${sourceId} contredit une évaluation déjà conservée.`);
    }
    if (data.evaluatedOn !== saved.evaluatedOn) {
      db.update(movieEvaluations).set({ evaluatedOn: data.evaluatedOn }).where(eq(movieEvaluations.id, saved.id)).run();
      changed = true;
    }
  }
  return changed;
}

function storeFavorites(db: CinemaTransaction, movieId: number, preferences: ProfileEntry["favorites"]) {
  let changed = false;
  for (const { source, spontaneous, memorable, rewatch } of preferences ?? []) {
    const saved = db.select().from(favorites)
      .where(and(eq(favorites.movieId, movieId), eq(favorites.source, source))).get();
    const data = {
      movieId, source,
      spontaneous: spontaneous ?? saved?.spontaneous ?? null,
      memorable: memorable ?? saved?.memorable ?? null,
      rewatch: rewatch ?? saved?.rewatch ?? null,
    };
    if (!isDeepStrictEqual(data, saved)) {
      db.insert(favorites).values(data)
        .onConflictDoUpdate({ target: [favorites.movieId, favorites.source], set: data }).run();
      changed = true;
    }
  }
  return changed;
}

function storeStatus(db: CinemaTransaction, movieId: number, incoming: ProfileEntry["status"], hasEvaluations: boolean) {
  const saved = db.select().from(movieStatuses).where(eq(movieStatuses.movieId, movieId)).get();
  const status = incoming === "unknown" && saved ? saved.status : incoming ?? saved?.status;
  if (status === "unseen" && (hasEvaluations || db.select({ id: movieEvaluations.id }).from(movieEvaluations)
    .where(eq(movieEvaluations.movieId, movieId)).get())) {
    throw new Error("Le statut explicitement non vu est incompatible avec une évaluation existante ou importée.");
  }
  if (status === undefined || status === saved?.status) return false;
  db.insert(movieStatuses).values({ movieId, status })
    .onConflictDoUpdate({ target: movieStatuses.movieId, set: { status } }).run();
  return true;
}

function importEntry(db: CinemaTransaction, entry: ProfileEntry): Outcome {
  const { movie } = entry;
  const titles = [...new Set([movie.displayTitle, ...(movie.originalTitle ? [movie.originalTitle] : []), ...(movie.aliases ?? [])])];
  const existing = resolveMovie(db, movie, titles);
  const movieId = existing?.id ?? db.insert(movies).values({
    displayTitle: movie.displayTitle, originalTitle: movie.originalTitle, year: movie.year,
    tmdbId: movie.tmdbId, metadata: movie.metadata,
  }).returning({ id: movies.id }).get().id;
  let enriched = false;
  if (existing) {
    const data = {
      originalTitle: existing.originalTitle ?? movie.originalTitle ?? null,
      year: existing.year ?? movie.year ?? null,
      tmdbId: existing.tmdbId ?? movie.tmdbId ?? null,
      metadata: movie.metadata === undefined ? existing.metadata : { ...movie.metadata, ...existing.metadata },
    };
    if (!isDeepStrictEqual({ ...existing, ...data }, existing)) {
      db.update(movies).set(data).where(eq(movies.id, movieId)).run();
      enriched = true;
    }
  }

  const identifiers = db.insert(movieIdentifiers).values(suppliedIdentifiers(movie).map((id) => ({ ...id, movieId })))
    .onConflictDoNothing().run();
  const aliases = db.insert(movieTitles).values(titles.map((title) => ({ title, movieId, normalizedTitle: normalizeTitle(title) })))
    .onConflictDoNothing().run();
  const statusChanged = storeStatus(db, movieId, entry.status, !!entry.evaluations?.length);
  const evaluationsChanged = storeEvaluations(db, movieId, entry.evaluations);
  const favoritesChanged = storeFavorites(db, movieId, entry.favorites);
  if (!existing) return "created";
  return enriched || identifiers.changes > 0 || aliases.changes > 0 || statusChanged || evaluationsChanged || favoritesChanged
    ? "updated" : "duplicates";
}

export function importProfile(db: CinemaDatabase, input: unknown): ImportReport {
  const report: ImportReport = { created: 0, updated: 0, duplicates: 0, ambiguities: [], errors: [] };
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    report.errors = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."), message: issue.message,
    }));
    return report;
  }

  return db.transaction((tx) => {
    parsed.data.entries.forEach((entry, index) => {
      try {
        const result = tx.transaction((row) => importEntry(row, entry));
        report[result]++;
      } catch (error) {
        const issue = {
          entry: index + 1,
          path: entry.movie.canonicalId,
          message: error instanceof Error ? error.message : "Échec de l’enregistrement.",
        };
        (error instanceof AmbiguousMovie ? report.ambiguities : report.errors).push(issue);
      }
    });
    return report;
  }, { behavior: "immediate" });
}
