import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "../src/db/client";
import { discoveryExclusions, generateDiscovery, inspectDiscovery } from "../src/db/discovery";
import { getCollection } from "../src/db/feedback";
import { franchiseExclusions, franchisePreferences, setFranchisePreference } from "../src/db/franchises";
import { startLab } from "../src/db/lab";
import { cacheFilm, readCatalogue } from "../src/db/recommendations";
import { labProposals, movies } from "../src/db/schema";
import { planBlindCalibration } from "../src/diagnostics/calibration";
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

it("respecte et annule les exclusions persistées dans les sélections, sans toucher à la collection", async () => {
  const folder = await mkdtemp(join(tmpdir(), "after-dark-franchises-"));
  const file = join(folder, "catalogue.sqlite");
  const migrations = join(process.cwd(), "drizzle");
  let connection = await openDatabase(file, migrations);
  try {
    const [blocked, other] = await connection.db.insert(movies).values([
      { displayTitle: "Godzilla", tmdbId: 1678, year: 1954 },
      { displayTitle: "Godzilla", tmdbId: 99999999, year: 2025 },
      ...Array.from({ length: 10 }, (_, i) => ({ displayTitle: `Autre film ${i}`, year: 2001 + i })),
    ]).returning();
    const before = await getCollection(connection.db);
    expect(await franchiseExclusions(connection.db)).toEqual(new Set());
    await setFranchisePreference(connection.db, blocked.id, "godzilla", true);
    connection.close();
    connection = await openDatabase(file, migrations);
    const { db } = connection;
    expect(await franchisePreferences(db, blocked.id)).toEqual([{ key: "godzilla", name: "Godzilla", blocked: true,
      films: [{ title: "Godzilla", year: 1954 }] }]);
    expect(await discoveryExclusions(db)).toEqual(new Set([blocked.id]));
    expect((await findTonight(db, criteria, async () => undefined)).films.map(({ id }) => id)).not.toContain(blocked.id);
    for (const mode of ["gems", "affinities", "offbeat"] as const) {
      const pick = await generateDiscovery(db, mode, null);
      expect(pick?.films.map(({ id }) => id)).not.toContain(blocked.id);
    }
    await startLab(db, criteria, true);
    expect((await db.select().from(labProposals)).map(({ movieId }) => movieId)).not.toContain(blocked.id);
    const data = await readCatalogue(db);
    const plan = planBlindCalibration({ ...data, excluded: await discoveryExclusions(db), date: "2026-11-23", seed: "common",
      rotations: { gems: { previous: [], adjacent: [] }, affinities: { previous: [], adjacent: [] }, offbeat: { previous: [], adjacent: [] } },
      preferences: {} }, "gems");
    expect(plan.coveredArms).toBe(4);
    expect(plan.proposals.map(({ movieId }) => movieId)).not.toContain(blocked.id);
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
