import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { franchiseExclusions } from "../db/franchises";
import type { CinemaDatabase } from "../db/client";
import { cacheFilm, readCatalogue, readHistory, saveRecommendation } from "../db/recommendations";
import type { TonightPreferences } from "../domain/tonight-preferences";
import { tonightDiagnostic, type TonightDiagnostic, type Acquisition } from "../diagnostics/tonight";
import { diagnoseRecommendation, recommend } from "../domain/recommendation";
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
  preferences?: TonightPreferences, onDiagnostic?: (report: TonightDiagnostic) => Promise<void>,
): Promise<Recommendation> {
  let state = await readCatalogue(db);
  const history = await readHistory(db);
  const hydrationBudget = 18;
  const before = state.catalogue.length;
  const sources: Acquisition["sources"] = [];
  let discovered: number[] = [];
  const lookups = new Map<number, Acquisition["lookups"][number]["result"]>();
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
      const discovery = await client.discover(criteria, history.round, onDiagnostic ? (source) => sources.push(source) : undefined);
      if (onDiagnostic) discovered = discovery;
      const uncached = discovery.filter((id) => !isFresh(local.get(id)?.metadata ?? null, now));
      if (onDiagnostic) {
        for (const id of discovery) lookups.set(id, "fresh-cache");
        uncached.forEach((id, index) => lookups.set(id, index < hydrationBudget ? "interrupted" : "over-budget"));
      }
      for (let index = 0; index < Math.min(uncached.length, hydrationBudget); index += 3) {
        const ids = uncached.slice(index, Math.min(index + 3, hydrationBudget));
        const batch = await Promise.allSettled(ids.map(hydrate));
        for (const [offset, result] of batch.entries()) {
          const outcome = result.status === "rejected" ? "failed" : !result.value ? "missing"
            : await cacheFilm(db, result.value) ? "cached" : "unmatched";
          if (onDiagnostic) lookups.set(ids[offset], outcome);
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
  const blocked = await franchiseExclusions(db, state.movies);
  const date = now.toISOString();
  const args = [state.catalogue, state.signals, criteria, allowRecent ? new Set<number>() : history.recent,
    { referenceDate: date.slice(0, 10), excludedIds: blocked }, "current", "relevance", preferences] as const;
  const trace = onDiagnostic ? diagnoseRecommendation(...args) : undefined;
  const result = { ...(trace?.result ?? recommend(...args)), connection };
  await saveRecommendation(db, criteria, result, date);
  if (trace && onDiagnostic) {
    try {
      await onDiagnostic(tonightDiagnostic({
        date, criteria, allowRecent, preferences, catalogue: state.catalogue, movies: state.movies, trace,
        acquisition: { round: history.round, before, after: state.catalogue.length, connection,
          sources: [...sources], discovered, lookups: discovered.map((tmdbId) => ({ tmdbId, result: lookups.get(tmdbId)! })) },
      }));
    } catch {
      console.error("Impossible d’écrire le diagnostic Ce soir.");
    }
  }
  return result;
}
