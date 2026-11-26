import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CinemaDatabase } from "../db/client";
import { readCatalogue, readHistory, saveRecommendation } from "../db/recommendations";
import { filmFranchise } from "../domain/franchises";
import type { TonightPreferences } from "../domain/tonight-preferences";
import { tonightDiagnostic, type TonightDiagnostic } from "../diagnostics/tonight";
import { diagnoseRecommendation, recommend, tonightAffinityModel, tonightRanking } from "../domain/recommendation";
import { recentSelectionLimit, selectionSize, type Criteria, type Recommendation } from "../shared/recommendation";
import { acquireTonight } from "./acquire";
import { TmdbClient, TmdbError } from "./tmdb";

const config = z.strictObject({ tmdbReadToken: z.string().trim().min(1).max(4096) });
const configCache = new Map<string, TmdbClient>();

export async function localTmdb(directory: string) {
  let token = process.env.AFTER_DARK_TMDB_READ_TOKEN?.trim();
  try {
    token ||= config.parse(JSON.parse(await readFile(join(directory, "tmdb.json"), "utf8"))).tmdbReadToken;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new TmdbError("unauthorized");
  }
  let client = configCache.get(token);
  if (!client) {
    configCache.clear();
    client = new TmdbClient(token);
    configCache.set(token, client);
  }
  return client;
}

export async function findTonight(
  db: CinemaDatabase, criteria: Criteria, getClient: () => Promise<TmdbClient | undefined>, now = new Date(), allowRecent = false,
  preferences?: TonightPreferences, onDiagnostic?: (report: TonightDiagnostic) => Promise<void>, profileHorror = false,
): Promise<Recommendation> {
  const catalogue = await readCatalogue(db);
  const history = await readHistory(db, recentSelectionLimit);
  const recent = allowRecent ? new Set<number>() : history.recent;
  const strategy = profileHorror && criteria.selectionCategory === "horror" ? "profile" : "baseline";
  const { state, blocked, report } = await acquireTonight(db, catalogue, criteria, recent, history.round, now, getClient, preferences,
    { strategy, measure: !!onDiagnostic });
  const date = now.toISOString();
  const args = [state.catalogue, state.signals, criteria, recent,
    { referenceDate: date.slice(0, 10), excludedIds: blocked }, tonightAffinityModel, tonightRanking, preferences, selectionSize] as const;
  const trace = onDiagnostic ? diagnoseRecommendation(...args) : undefined;
  const result = { ...(trace?.result ?? recommend(...args)), connection: report.connection };
  await saveRecommendation(db, criteria, result, date);
  if (trace && onDiagnostic) {
    try {
      await onDiagnostic(tonightDiagnostic({
        date, criteria, allowRecent, preferences, size: selectionSize, recentLimit: recentSelectionLimit, catalogue: state.catalogue, movies: state.movies, trace,
        acquisition: report,
      }));
    } catch {
      console.error("Impossible d’écrire le diagnostic Ce soir.");
    }
  }
  const movies = new Map(state.movies.map((movie) => [movie.id, movie]));
  return { ...result, films: result.films.map((film) => {
    const movie = movies.get(film.id);
    const franchise = movie && filmFranchise(movie);
    return franchise ? { ...film, franchise: { key: franchise.key, name: franchise.name } } : film;
  }) };
}
