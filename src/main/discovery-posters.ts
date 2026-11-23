import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { posterData, validPoster } from "./posters";
import type { TmdbClient } from "./tmdb";

const cacheFile = (directory: string, tmdbId: number) => join(directory, "posters", "movie-" + tmdbId + ".txt");

export async function cachedDiscoveryPosterPath(path: string | undefined, tmdbId: number | null | undefined, directory: string) {
  if (validPoster(path) || !tmdbId) return validPoster(path) ? path : undefined;
  const value = await readFile(cacheFile(directory, tmdbId), "utf8").catch(() => "");
  return validPoster(value) ? value : undefined;
}

// Only a verified movie ID may be looked up. A failed connection is retried on a later visit.
export function createDiscoveryPosters(getClient: (directory: string) => Promise<TmdbClient | undefined>, loadPoster = posterData) {
  const pending = new Map<string, Promise<string | undefined>>();
  let worker = Promise.resolve();
  let retryAt = 0;

  async function findPath(tmdbId: number, directory: string) {
    const cache = join(directory, "posters");
    const file = cacheFile(directory, tmdbId);
    const entry = await readFile(file, "utf8").catch(() => "");
    if (validPoster(entry)) return entry;
    if (Number(entry) > Date.now()) return;
    const active = pending.get(file);
    if (active) return active;
    const job = worker.then(async () => {
      if (retryAt > Date.now()) return;
      try {
        const client = await getClient(directory);
        if (!client) return;
        const path = await client.moviePoster(tmdbId);
        await mkdir(cache, { recursive: true, mode: 0o700 });
        await writeFile(file, path ?? String(Date.now() + 24 * 3600_000), { mode: 0o600 });
        return path;
      } catch {
        retryAt = Date.now() + 60_000;
      }
    }).finally(() => { pending.delete(file); });
    pending.set(file, job);
    worker = job.then(() => undefined);
    return job;
  }

  return async (path: string | undefined, tmdbId: number | null | undefined, directory: string) =>
    loadPoster(validPoster(path) ? path : tmdbId ? await findPath(tmdbId, directory) : undefined, directory, true);
}
