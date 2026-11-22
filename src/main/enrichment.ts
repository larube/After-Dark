import type { CinemaDatabase } from "../db/client";
import { checkpointUnmatched, enrichmentQueue } from "../db/enrichment";
import { cacheFilm } from "../db/recommendations";
import type { EnrichmentProgress } from "../shared/ipc";
import { TmdbClient, TmdbError } from "./tmdb";

export async function enrichNext(
  db: CinemaDatabase, getClient: () => Promise<TmdbClient | undefined>,
  paused: () => boolean, commit: (write: () => Promise<void>) => Promise<void>,
): Promise<EnrichmentProgress["status"]> {
  if (paused()) return "waiting";
  const [job] = (await enrichmentQueue(db)).pending;
  if (!job) return "complete";
  try {
    const client = await getClient();
    if (!client) return "unconfigured";
    if (paused()) return "waiting";
    const { movie } = job;
    const id = movie.tmdbId ?? (job.imdbId ? await client.findImdb(job.imdbId) : undefined);
    if (paused()) return "waiting";
    const film = id ? await client.film(id)
      : movie.year !== null ? await client.matchProfileFilm(job.names, movie.year, paused) : undefined;
    if (paused()) return "waiting";
    await commit(async () => {
      if (film && await cacheFilm(db, film, movie.id)) return;
      await checkpointUnmatched(db, movie.id, job.identity);
    });
    return "working";
  } catch (error) {
    if (error instanceof TmdbError) return error.connection;
    throw error;
  }
}

export function startEnrichment(
  db: CinemaDatabase, getClient: () => Promise<TmdbClient | undefined>, foregroundActive: () => boolean,
) {
  let status: EnrichmentProgress["status"] = "waiting";
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> | undefined;
  let running = false;

  const paused = () => stopped || foregroundActive();
  async function run() {
    if (stopped || running) return;
    running = true;
    try {
      status = "working";
      status = await enrichNext(db, getClient, paused, async (write) => {
        writing = write();
        try { await writing; } finally { writing = undefined; }
      });
    } catch {
      status = "unavailable";
    } finally {
      running = false;
      if (!stopped) {
        const delay = status === "working" ? 500 : ["offline", "limited", "unavailable"].includes(status) ? 30_000 : 5000;
        timer = setTimeout(() => void run(), delay);
      }
    }
  }

  function wake() {
    clearTimeout(timer);
    void run();
  }

  wake();
  return {
    wake,
    settleWrite: () => writing,
    async progress(): Promise<EnrichmentProgress> {
      const { total, enriched, skipped, pending } = await enrichmentQueue(db);
      return { total, enriched, skipped, pending: pending.length, status: pending.length ? status : "complete" };
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
