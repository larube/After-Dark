import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { discoveryHash, discoveryHistorySize, discoveryProtocol, discoverySnapshot, explore } from "../domain/discovery";
import { engineVersion } from "../domain/recommendation";
import { discoveryModes, type DiscoveryMode } from "../shared/discovery";
import type { CinemaDatabase, CinemaTransaction } from "./client";
import { readCatalogue } from "./recommendations";
import { discoveryExplorations, movieFeedback } from "./schema";

function history(db: CinemaDatabase | CinemaTransaction, mode: DiscoveryMode, limit: number) {
  return db.select().from(discoveryExplorations).where(eq(discoveryExplorations.mode, mode))
    .orderBy(desc(discoveryExplorations.id)).limit(limit).all();
}

export async function currentDiscovery(db: CinemaDatabase, mode: DiscoveryMode): Promise<typeof discoveryExplorations.$inferSelect | null> {
  const [latest] = await history(db, mode, 1);
  return latest ?? null;
}

export async function generateDiscovery(db: CinemaDatabase, mode: DiscoveryMode, previous: number | null,
  now = new Date(), seed: string = randomUUID()) {
  return db.transaction(async (tx) => {
    const recent = await history(tx, mode, discoveryHistorySize);
    // An old or duplicated request returns the current exploration instead of advancing rotation twice.
    if ((recent[0]?.id ?? null) !== previous) return recent[0] ?? null;
    const adjacent: number[] = [];
    for (const other of discoveryModes) {
      if (other === mode) continue;
      const latest = (await history(tx, other, 1))[0];
      if (latest) adjacent.push(...latest.films.map(({ id }) => id));
    }
    const rotation = { previous: recent.map(({ films }) => films.map(({ id }) => id)), adjacent };
    const { catalogue, signals } = await readCatalogue(tx);
    const blocked = await tx.select({ id: movieFeedback.movieId }).from(movieFeedback)
      .where(eq(movieFeedback.intention, "not_interested")).all();
    const excluded = new Set(blocked.map(({ id }) => id));
    const createdAt = now.toISOString();
    const referenceDate = createdAt.slice(0, 10);
    const result = explore(catalogue, signals, excluded, mode, rotation, seed, referenceDate);
    if (!result.selected.length) return null;
    if (recent[0] && result.renewed === 0 && recent[0].films.length === result.selected.length) {
      return { ...recent[0], renewed: 0 };
    }
    return tx.insert(discoveryExplorations).values({
      mode, seed, createdAt, rotation, protocol: discoveryProtocol, engine: engineVersion,
      fingerprint: discoveryHash([referenceDate, catalogue, signals, [...excluded].sort((a, b) => a - b)]),
      films: result.selected.map(discoverySnapshot), eligible: result.eligible, renewed: result.renewed,
    }).returning().get();
  });
}
