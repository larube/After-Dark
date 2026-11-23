import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "../src/db/client";
import { discoveryExclusions, generateDiscovery, inspectDiscovery } from "../src/db/discovery";
import { startLab } from "../src/db/lab";
import { getCollection } from "../src/db/feedback";
import { franchiseExclusions, franchisePreferences, setFranchisePreference } from "../src/db/franchises";
import { cacheFilm, readCatalogue } from "../src/db/recommendations";
import { labProposals, movies } from "../src/db/schema";
import { compareCalibration, planBlindCalibration } from "../src/diagnostics/calibration";
import { rankLabModels } from "../src/domain/lab";
import { filmFranchise } from "../src/domain/franchises";
import { findTonight } from "../src/main/recommend";
import { TmdbClient } from "../src/main/tmdb";
import { metadataSchema, type Criteria } from "../src/shared/recommendation";

const tmdbMetadata = (id: number, name = "Collection vérifiée") => ({
  tmdb: { source: "TMDB", data: { collection: { id, name }, countries: ["JP", "US"] } },
});
const criteria: Criteria = {
  mood: "surprise", preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [],
};

it("identifie plusieurs collections et des films isolés sans assimiler les homonymes ou les coproductions", () => {
  for (const collection of [374509, 374511, 535790]) {
    expect(filmFranchise({ tmdbId: 123, metadata: tmdbMetadata(collection) })?.key).toBe("godzilla");
  }
  expect(filmFranchise({ tmdbId: 940721, metadata: null })?.key).toBe("godzilla");
  expect(filmFranchise({ tmdbId: 123, metadata: tmdbMetadata(535313) })?.key).toBe("collection:535313");
  expect(filmFranchise({ tmdbId: 123, metadata: { title: "Godzilla", keywords: ["godzilla"], countries: ["JP"] } })).toBeUndefined();
  expect(filmFranchise({ tmdbId: null, metadata: tmdbMetadata(374509) })).toBeUndefined();
});

const minusCollection = tmdbMetadata(1474814, "Godzilla Minus Collection");
const minusZero = { displayTitle: "Godzilla Minus Zero", tmdbId: 1381071, year: 2026, metadata: minusCollection };
const minusOne = { displayTitle: "Godzilla Minus One", tmdbId: 940721, year: 2023, metadata: minusCollection };

it("reconnaît Godzilla Minus par sa collection et chacun des deux films sans collection en cache", () => {
  expect(filmFranchise({ tmdbId: 123, metadata: minusCollection })?.key).toBe("godzilla");
  for (const { tmdbId } of [minusZero, minusOne]) {
    expect(filmFranchise({ tmdbId, metadata: minusCollection })?.key).toBe("godzilla");
    expect(filmFranchise({ tmdbId, metadata: null })?.key).toBe("godzilla");
  }
  expect(filmFranchise({ tmdbId: 123, metadata: { title: minusZero.displayTitle } })).toBeUndefined();
});

it("respecte et annule les exclusions persistées dans les sélections, sans toucher à la collection", async () => {
  const folder = await mkdtemp(join(tmpdir(), "after-dark-franchises-"));
  const file = join(folder, "catalogue.sqlite");
  const migrations = join(process.cwd(), "drizzle");
  let connection = await openDatabase(file, migrations);
  try {
    const [zero, one, other] = await connection.db.insert(movies).values([
      minusZero, minusOne,
      { displayTitle: "Godzilla Minus Zero", tmdbId: 99999999, year: 2026, metadata: { reputation: { source: "TMDB", average: 8, count: 500 } } },
      ...Array.from({ length: 3 }, (_, i) => ({ displayTitle: `Autre film ${i}`, year: 2001 + i })),
    ]).returning();
    const before = await getCollection(connection.db);
    expect(await franchiseExclusions(connection.db)).toEqual(new Set());
    const { catalogue, signals } = await readCatalogue(connection.db);
    const date = "2026-11-23";
    const historic = new Date(date);
    const rotation = { previous: [], adjacent: [] };
    const input = { catalogue, signals, date, seed: "common",
      rotations: { gems: rotation, affinities: rotation, offbeat: rotation }, preferences: {} };
    const expected = new Set([zero.id, one.id]);
    const baseline = compareCalibration({ ...input, excluded: new Set() });
    for (const { modes } of baseline.comparison) {
      for (const { ids } of modes) expect(ids).toEqual(expect.arrayContaining([...expected]));
    }
    for (const ids of Object.values(rankLabModels(catalogue, signals, criteria, new Set(), date))) {
      expect(ids.map(({ movieId }) => movieId)).toContain(zero.id);
    }
    await setFranchisePreference(connection.db, zero.id, "godzilla", true);
    connection.close();
    connection = await openDatabase(file, migrations);
    const { db } = connection;
    expect(await franchisePreferences(db, zero.id)).toEqual([{ key: "godzilla", name: "Godzilla", blocked: true,
      films: [{ title: minusOne.displayTitle, year: 2023 }, { title: minusZero.displayTitle, year: 2026 }] }]);
    const excluded = await discoveryExclusions(db);
    expect(excluded).toEqual(expected);
    const assertUnblocked = (ids: number[]) => {
      expect(ids).toContain(other.id);
      expect(ids.filter((id) => expected.has(id))).toEqual([]);
    };
    await startLab(db, criteria, true, historic, "franchise-smoke");
    assertUnblocked((await db.select().from(labProposals)).map(({ movieId }) => movieId));
    assertUnblocked((await findTonight(db, criteria, async () => undefined, historic)).films.map(({ id }) => id));
    for (const mode of ["gems", "affinities", "offbeat"] as const) {
      const pick = await generateDiscovery(db, mode, null, historic);
      assertUnblocked(pick!.films.map(({ id }) => id));
    }
    // Ignore the Ce soir test's recent-history write when checking the models' complete slates.
    for (const ids of Object.values(rankLabModels(catalogue, signals, criteria, new Set(), date, excluded))) {
      assertUnblocked(ids.map(({ movieId }) => movieId));
    }
    const comparison = compareCalibration({ ...input, excluded });
    expect(comparison.comparison.map(({ arm }) => arm)).toEqual(["A", "B", "C", "D"]);
    for (const { modes } of comparison.comparison) {
      for (const { ids, next } of modes) {
        assertUnblocked(ids);
        assertUnblocked(next);
      }
    }
    const plan = planBlindCalibration({ ...input, excluded }, "gems");
    expect(plan.coveredArms).toBe(4);
    assertUnblocked(plan.proposals.map(({ movieId }) => movieId));
    expect(await getCollection(db)).toEqual(before);
    expect(await franchisePreferences(db, other.id)).toEqual([]);
    await setFranchisePreference(db, null, "godzilla", false);
    expect(await franchiseExclusions(db)).toEqual(new Set());
    const pick = await generateDiscovery(db, "gems", null, new Date("2026-11-23"));
    if (pick) expect((await inspectDiscovery(db, pick)).every(({ franchiseBlocked }) => !franchiseBlocked)).toBe(true);
  } finally {
    connection.close();
    await rm(folder, { recursive: true, force: true });
  }
});

it("conserve les identifiants TMDB de collection et la version intégrale de l’aperçu", async () => {
  const overview = "Un couple tente de retrouver son fils. Les recherches les ramènent sur l’île de leur enfance.";
  const client = new TmdbClient("test", async () => new Response(JSON.stringify({
    id: 42, title: "Le retour", overview, belongs_to_collection: { id: 135, name: "Le retour", poster_path: null },
  })));
  const film = await client.film(42);
  expect(film?.metadata).toMatchObject({ collection: { id: 135, name: "Le retour" },
    synopsis: "Un couple tente de retrouver son fils.", fullSynopsis: overview });
  const folder = await mkdtemp(join(tmpdir(), "after-dark-collection-cache-"));
  const connection = await openDatabase(join(folder, "cache.sqlite"), join(process.cwd(), "drizzle"));
  try {
    const { db } = connection;
    expect(await cacheFilm(db, film!)).toBe(true);
    const [record] = (await readCatalogue(db)).movies;
    expect(filmFranchise(record)?.key).toBe("collection:135");
    expect((await readCatalogue(db)).catalogue[0].metadata.fullSynopsis).toBe(overview);
    await cacheFilm(db, { ...film!, metadata: metadataSchema.parse({ collection: null }) });
    expect(filmFranchise((await readCatalogue(db)).movies[0])).toBeUndefined();
  } finally {
    connection.close();
    await rm(folder, { recursive: true, force: true });
  }
});
