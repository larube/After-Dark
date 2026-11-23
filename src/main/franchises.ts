import { eq } from "drizzle-orm";
import type { CinemaDatabase } from "../db/client";
import { franchisePreferences } from "../db/franchises";
import { cacheFilm } from "../db/recommendations";
import { movies } from "../db/schema";
import type { DesktopApi } from "../shared/ipc";
import type { TmdbClient } from "./tmdb";

export async function readFilmFranchises(db: CinemaDatabase, id: number | null, verify: boolean,
  getClient: () => Promise<TmdbClient | undefined>,
): ReturnType<DesktopApi["franchises"]> {
  let data = await franchisePreferences(db, id);
  if (data.length === 0 && id !== null && verify) {
    const movie = await db.select({ tmdbId: movies.tmdbId, metadata: movies.metadata }).from(movies).where(eq(movies.id, id)).get();
    const cached = movie?.metadata?.tmdb;
    const details = cached && typeof cached === "object" && "data" in cached ? cached.data : undefined;
    if (movie?.tmdbId && !(details && typeof details === "object" && "collection" in details)) {
      try {
        const client = await getClient();
        const film = await client?.film(movie.tmdbId);
        if (film && await cacheFilm(db, film, id)) data = await franchisePreferences(db, id);
      } catch {
        return { ok: false, error: "Impossible de vérifier cette collection auprès de TMDB." };
      }
    }
  }
  return { ok: true, data };
}
