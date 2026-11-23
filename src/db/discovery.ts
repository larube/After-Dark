import { randomUUID } from "node:crypto";
import { desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { discoveryHash, discoveryHistorySize, discoveryProtocol, discoverySnapshot, explore } from "../domain/discovery";
import { classifyContent, todayUtc } from "../domain/candidate-quality";
import { normalizeTitle } from "../domain/ratings";
import { engineVersion } from "../domain/recommendation";
import { discoveryModes, type DiscoveryMode } from "../shared/discovery";
import type { CinemaDatabase, CinemaTransaction } from "./client";
import { franchiseExclusions } from "./franchises";
import { labSeenIds } from "./lab";
import { normalizeMetadata, readCatalogue } from "./recommendations";
import { discoveryExplorations, movieEvaluations, movieFeedback, movies, movieStatuses } from "./schema";

function history(db: CinemaDatabase | CinemaTransaction, mode: DiscoveryMode, limit: number) {
  return db.select().from(discoveryExplorations).where(eq(discoveryExplorations.mode, mode))
    .orderBy(desc(discoveryExplorations.id)).limit(limit).all();
}

export async function currentDiscovery(db: CinemaDatabase, mode: DiscoveryMode): Promise<typeof discoveryExplorations.$inferSelect | null> {
  const [latest] = await history(db, mode, 1);
  return latest ?? null;
}

export async function discoveryExclusions(db: CinemaDatabase | CinemaTransaction) {
  const blocked = await db.select({ id: movieFeedback.movieId }).from(movieFeedback)
    .where(or(eq(movieFeedback.intention, "not_interested"), isNotNull(movieFeedback.seenAt))).all();
  return new Set([...blocked.map(({ id }) => id), ...await franchiseExclusions(db)]);
}

export async function discoveryRotation(db: CinemaDatabase | CinemaTransaction, mode: DiscoveryMode,
  recent?: Exploration[]) {
  const previous = (recent ?? await history(db, mode, discoveryHistorySize)).map(({ films }) => films.map(({ id }) => id));
  const adjacent: number[] = [];
  for (const other of discoveryModes) {
    if (other === mode) continue;
    const latest = (await history(db, other, 1))[0];
    if (latest) adjacent.push(...latest.films.map(({ id }) => id));
  }
  return { previous, adjacent };
}

export async function generateDiscovery(db: CinemaDatabase, mode: DiscoveryMode, previous: number | null,
  now = new Date(), seed: string = randomUUID()) {
  return db.transaction(async (tx) => {
    const recent = await history(tx, mode, discoveryHistorySize);
    // An old or duplicated request returns the current exploration instead of advancing rotation twice.
    if ((recent[0]?.id ?? null) !== previous) return recent[0] ?? null;
    const rotation = await discoveryRotation(tx, mode, recent);
    const { catalogue, signals } = await readCatalogue(tx);
    const excluded = await discoveryExclusions(tx);
    const createdAt = now.toISOString();
    const referenceDate = createdAt.slice(0, 10);
    const result = explore(catalogue, signals, excluded, mode, rotation, seed, referenceDate);
    if (!result.selected.length) return null;
    if (recent[0]?.protocol === discoveryProtocol && result.renewed === 0 && recent[0].films.length === result.selected.length) {
      return { ...recent[0], renewed: 0 };
    }
    return tx.insert(discoveryExplorations).values({
      mode, seed, createdAt, rotation, protocol: discoveryProtocol, engine: engineVersion,
      fingerprint: discoveryHash([referenceDate, catalogue, signals, [...excluded].sort((a, b) => a - b)]),
      films: result.selected.map((pick) => discoverySnapshot(pick, referenceDate)), eligible: result.eligible, renewed: result.renewed,
    }).returning().get();
  });
}


type Exploration = typeof discoveryExplorations.$inferSelect;

export async function inspectDiscovery(db: CinemaDatabase, row: Exploration, referenceDate = todayUtc()) {
  const ids = row.films.map(({ id }) => id);
  const catalogue = await db.select({
    id: movies.id, title: movies.displayTitle, year: movies.year, tmdbId: movies.tmdbId, metadata: movies.metadata,
    status: movieStatuses.status, intention: movieFeedback.intention, confirmed: movieFeedback.seenAt,
  }).from(movies).leftJoin(movieStatuses, eq(movieStatuses.movieId, movies.id))
    .leftJoin(movieFeedback, eq(movieFeedback.movieId, movies.id)).where(inArray(movies.id, ids)).all();
  const evaluated = new Set((await db.selectDistinct({ id: movieEvaluations.movieId }).from(movieEvaluations)
    .where(inArray(movieEvaluations.movieId, ids)).all()).map(({ id }) => id));
  const blocked = await franchiseExclusions(db, catalogue);
  const known = new Map(catalogue.map((record) => [record.id, record]));
  return row.films.map((snapshot) => {
    const local = known.get(snapshot.id);
    const metadata = normalizeMetadata(local?.metadata ?? null);
    const quality = classifyContent(metadata, referenceDate);
    const seen = local?.status === "seen" || !!local?.confirmed || evaluated.has(snapshot.id);
    const franchiseBlocked = blocked.has(snapshot.id);
    const admissible = !!local && !franchiseBlocked && !seen && local.intention !== "not_interested" && quality.exclusionReasons.length === 0;
    return { snapshot, local, metadata, quality, seen, admissible, franchiseBlocked, poster: metadata.poster ?? snapshot.poster };
  });
}

export async function discoveryDiagnostic(db: CinemaDatabase, row: Exploration, cacheState: (path?: string, tmdbId?: number | null) => Promise<string>,
  referenceDate = todayUtc()) {
  const films = await inspectDiscovery(db, row, referenceDate);
  const lab = await labSeenIds(db, row.films.map(({ id }) => id));
  const identities = await db.select({ id: movies.id, title: movies.displayTitle, year: movies.year }).from(movies).all();
  const distinct = (values: (string | number)[]) => new Set(values).size;
  return {
    schemaVersion: 1, mode: row.mode, protocol: row.protocol, engine: row.engine, generatedAt: row.createdAt,
    checkedAt: referenceDate, seed: row.seed, eligibleAtGeneration: row.eligible,
    diversity: {
      genres: distinct(films.flatMap(({ metadata }) => metadata.genres.map(normalizeTitle))),
      countries: distinct(films.flatMap(({ metadata }) => metadata.countries)),
      directors: distinct(films.flatMap(({ metadata }) => metadata.directors.map(normalizeTitle))),
      decades: distinct(films.flatMap(({ snapshot }) => snapshot.year === null ? [] : [Math.floor(snapshot.year / 10) * 10])),
      repeatedFromLast: row.rotation.previous.length ? films.filter(({ snapshot }) => row.rotation.previous[0].includes(snapshot.id)).length : null,
      repeatedAcrossModes: films.filter(({ snapshot }) => row.rotation.adjacent.includes(snapshot.id)).length,
    },
    films: await Promise.all(films.map(async ({ snapshot, local, metadata, quality, seen, admissible, franchiseBlocked, poster }, index) => ({
      id: snapshot.id, title: snapshot.title, position: index + 1,
      reason: snapshot.trace ? snapshot.reason : null,
      rankingAtGeneration: snapshot.trace ? {
        ...snapshot.trace,
        contributions: undefined,
        positive: snapshot.trace.contributions.filter(({ contribution }) => contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 5),
        negative: snapshot.trace.contributions.filter(({ contribution }) => contribution < 0).sort((a, b) => a.contribution - b.contribution).slice(0, 5),
      } : null,
      catalogueNow: {
        present: !!local, tmdbId: local?.tmdbId ?? null, status: local?.status ?? "unknown", seen,
        dismissed: local?.intention === "not_interested", franchiseBlocked, seenInLab: lab.has(snapshot.id), admissible,
        sameTitleAndYear: !!local?.year && identities.some((other) => other.id !== local.id && other.year === local.year &&
          normalizeTitle(other.title) === normalizeTitle(local.title)),
        quality, metadata: {
          genres: metadata.genres.length, countries: metadata.countries.length, directors: metadata.directors.length,
          keywords: metadata.keywords.length, duration: !!metadata.minutes, language: !!metadata.language, synopsis: !!metadata.synopsis,
          popularity: metadata.popularity !== undefined,
        },
        posterCache: await cacheState(poster, local?.tmdbId),
      },
    }))),
  };
}
