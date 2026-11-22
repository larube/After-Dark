import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CinemaDatabase } from "../db/client";
import { cacheFilm, readCatalogue, readHistory, saveRecommendation } from "../db/recommendations";
import { recommend } from "../domain/recommendation";
import type { Criteria, Recommendation } from "../shared/recommendation";
import { TmdbClient, TmdbError } from "./tmdb";

const config = z.strictObject({ tmdbReadToken: z.string().trim().min(1).max(4096) });
const configCache = new Map<string, TmdbClient>();
const freshFor = 30 * 24 * 60 * 60 * 1000;

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

function isFresh(metadata: Record<string, unknown> | null, now: Date) {
  const tmdb = metadata?.tmdb;
  return !!tmdb && typeof tmdb === "object" && "fetchedAt" in tmdb && typeof tmdb.fetchedAt === "string"
    && now.getTime() - Date.parse(tmdb.fetchedAt) < freshFor;
}

export async function findTonight(
  db: CinemaDatabase, criteria: Criteria, getClient: () => Promise<TmdbClient | undefined>, now = new Date(), allowRecent = false,
): Promise<Recommendation> {
  let state = await readCatalogue(db);
  const history = await readHistory(db);
  let connection: Recommendation["connection"] = "unconfigured";
  try {
    const client = await getClient();
    if (client) {
      const local = new Map(state.movies.filter(({ tmdbId }) => tmdbId !== null).map((movie) => [movie.tmdbId, movie]));
      const hydrated = new Set<number>();
      const hydrate = async (id: number) => {
        if (hydrated.has(id) || isFresh(local.get(id)?.metadata ?? null, now)) return;
        hydrated.add(id);
        return client.film(id);
      };
      const profileIds = new Set(state.signals.map(({ film }) => film.id));
      const needsMetadata = state.movies.filter((movie) => profileIds.has(movie.id) && !isFresh(movie.metadata, now));
      if (needsMetadata.length) {
        const offset = (history.round * 4) % needsMetadata.length;
        for (const movie of [...needsMetadata.slice(offset), ...needsMetadata.slice(0, offset)].slice(0, 4)) {
          // Search by exact title and year; ratings and favorites stay in SQLite.
          const id = movie.tmdbId ?? (movie.year ? await client.search(
            [movie.displayTitle, ...(movie.originalTitle ? [movie.originalTitle] : [])], movie.year,
          ) : undefined);
          const film = id ? await hydrate(id) : undefined;
          if (film) await cacheFilm(db, film);
        }
      }
      const discovery = await client.discover(criteria, history.round);
      const uncached = discovery.filter((id) => !isFresh(local.get(id)?.metadata ?? null, now));
      for (let index = 0; index < Math.min(uncached.length, 18); index += 3) {
        const batch = await Promise.allSettled(uncached.slice(index, Math.min(index + 3, 18)).map(hydrate));
        for (const result of batch) {
          if (result.status === "fulfilled" && result.value) await cacheFilm(db, result.value);
        }
        const failed = batch.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      }
      connection = hydrated.size ? "online" : "cached";
    }
  } catch (error) {
    if (!(error instanceof TmdbError)) throw error;
    connection = error.connection;
  }
  state = await readCatalogue(db);
  const result = { ...recommend(state.catalogue, state.signals, criteria, allowRecent ? new Set() : history.recent), connection };
  await saveRecommendation(db, criteria, result, now.toISOString());
  return result;
}
