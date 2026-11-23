import { eq } from "drizzle-orm";
import { filmFranchise, franchiseGroups } from "../domain/franchises";
import type { Franchise } from "../shared/franchises";
import type { CinemaDatabase, CinemaTransaction } from "./client";
import { blockedFranchises, movies } from "./schema";

type Reader = CinemaDatabase | CinemaTransaction;
type FilmIdentity = Pick<typeof movies.$inferSelect, "id" | "tmdbId" | "metadata">;

export async function franchiseExclusions(db: Reader, films?: FilmIdentity[]) {
  let keys;
  try {
    keys = await db.select({ key: blockedFranchises.key }).from(blockedFranchises).all();
  } catch (error) {
    // Immutable diagnostic snapshots from before this migration have no franchise preferences.
    if (error instanceof Error && error.cause instanceof Error &&
      error.cause.message === "SQLITE_ERROR: no such table: blocked_franchises") return new Set<number>();
    throw error;
  }
  const blocked = new Set(keys.map(({ key }) => key));
  if (!blocked.size) return new Set<number>();
  const catalogue = films ?? await db.select().from(movies).all();
  return new Set(catalogue.filter((film) => blocked.has(filmFranchise(film)?.key ?? "")).map(({ id }) => id));
}

export async function franchisePreferences(db: Reader, movieId: number | null): Promise<Franchise[]> {
  const blocked = await db.select().from(blockedFranchises).all();
  const catalogue = await db.select().from(movies).orderBy(movies.displayTitle, movies.year).all();
  const groups = movieId === null ? [...franchiseGroups, ...blocked] :
    catalogue.filter(({ id }) => id === movieId).flatMap((film) => filmFranchise(film) ?? []);
  return [...new Map(groups.map(({ key, name }) => [key, name])).entries()].map(([key, name]) => ({
    key, name, blocked: blocked.some((entry) => entry.key === key),
    films: catalogue.filter((film) => filmFranchise(film)?.key === key).map(({ displayTitle, year }) => ({ title: displayTitle, year })),
  }));
}

export function setFranchisePreference(db: CinemaDatabase, movieId: number | null, key: string, blocked: boolean) {
  return db.transaction(async (tx) => {
    if (!blocked) {
      await tx.delete(blockedFranchises).where(eq(blockedFranchises.key, key)).run();
      return;
    }
    const franchise = (await franchisePreferences(tx, movieId)).find((entry) => entry.key === key);
    if (!franchise) throw new Error("Appartenance non établie.");
    await tx.insert(blockedFranchises).values({ key, name: franchise.name }).onConflictDoNothing().run();
  });
}
