import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client";
import { currentDiscovery, generateDiscovery } from "../src/db/discovery";
import { getCollection, saveFeedback } from "../src/db/feedback";
import { startLab } from "../src/db/lab";
import { readCatalogue, readHistory } from "../src/db/recommendations";
import { discoveryExplorations, favorites, labProposals, labSessions, movieEvaluations, movies, movieStatuses } from "../src/db/schema";
import { discoveryPool, explore, type Rotation } from "../src/domain/discovery";
import { discoveryModes } from "../src/shared/discovery";
import { ipc } from "../src/shared/ipc";
import { discoveryDate, discoveryFixture as fixture } from "./fixtures/discovery";

const blank: Rotation = { previous: [], adjacent: [] };
const ids = (result: ReturnType<typeof explore>) => result.selected.map(({ film }) => film.id);
const run = (mode: typeof discoveryModes[number], rotation = blank, seed = "fixture-v1") =>
  explore(fixture.catalogue, fixture.signals, fixture.excluded, mode, rotation, seed, discoveryDate);

describe("Découvertes", () => {
  it("différencie les modes à entrées identiques avec des raisons issues du classement", () => {
    const [gems, affinities, offbeat] = discoveryModes.map((mode) => run(mode));
    const average = (result: typeof gems, value: (pick: typeof gems.selected[number]) => number) =>
      result.selected.reduce((sum, pick) => sum + value(pick), 0) / result.selected.length;
    expect(average(gems, ({ popularity }) => popularity ?? .5)).toBeLessThan(average(affinities, ({ popularity }) => popularity ?? .5));
    expect(average(affinities, ({ fit }) => fit)).toBeGreaterThan(average(offbeat, ({ fit }) => fit));
    expect(offbeat.selected.some(({ reason }) => reason.includes("À explorer"))).toBe(true);
    expect(affinities.selected.every(({ reason }) => reason.includes("appréciations positives"))).toBe(true);
    for (const result of [gems, affinities, offbeat]) {
      expect(new Set(ids(result)).size).toBe(8);
      expect(ids(result).every((id) => ![3, 38, 39, 40, 41, 42].includes(id))).toBe(true);
    }
    expect(ids(gems).filter((id) => ids(affinities).includes(id)).length).toBeLessThan(7);
    expect(ids(offbeat).filter((id) => ids(affinities).includes(id)).length).toBeLessThan(7);
  });

  it("rejoue la même graine et renouvelle les films avant de réutiliser les plus anciens", () => {
    const first = run("gems");
    expect(run("gems")).toEqual(first);
    const second = run("gems", { previous: [ids(first)], adjacent: [] }, "second");
    expect(second.renewed).toBe(8);
    expect(ids(second).some((id) => ids(first).includes(id))).toBe(false);
    const small = fixture.catalogue.filter(({ id }) => id === 1 || id === 37);
    const repeated = explore(small, [], new Set(), "offbeat", { previous: [[1, 37]], adjacent: [] }, "test", discoveryDate);
    expect(repeated.renewed).toBe(0);
    expect(ids(repeated).sort()).toEqual([1, 37]);
    expect(discoveryPool(small, new Set([1]), discoveryDate)[0].metadata.poster).toBeUndefined();
    expect(explore([], [], new Set(), "gems", blank, "test", discoveryDate).selected).toEqual([]);
  });

  it("borne les mots-clés et accepte un film ambigu, un documentaire et une animation", () => {
    const affinity = run("affinities").selected[0];
    const keywords = affinity.film.metadata.keywords;
    const single = (traits: string[]) => explore(
      [{ ...affinity.film, metadata: { ...affinity.film.metadata, keywords: traits } }],
      fixture.signals, new Set(), "affinities", blank, "fixture", discoveryDate,
    ).selected[0].fit;
    expect(single(keywords)).toBe(single(keywords.slice(0, 3)));
    const pool = discoveryPool(fixture.catalogue, fixture.excluded, discoveryDate);
    expect(pool.map(({ id }) => id)).toEqual(expect.arrayContaining([19, 28, 37]));
  });

  it("préserve l’ordre et l’historique quand aucun autre candidat ne peut entrer", async () => {
    const folder = await mkdtemp(join(tmpdir(), "after-dark-discovery-small-"));
    const connection = await openDatabase(join(folder, "small.sqlite"), "drizzle");
    try {
      const { db } = connection;
      await db.insert(movies).values([{ displayTitle: "La Balise" }, { displayTitle: "Le Phare" }]);
      const first = await generateDiscovery(db, "gems", null, new Date(discoveryDate), "first");
      expect(first?.films).toHaveLength(2);
      const next = await generateDiscovery(db, "gems", first!.id, new Date(discoveryDate), "next");
      expect(next).toEqual({ ...first, renewed: 0 });
      expect(await db.select().from(discoveryExplorations)).toHaveLength(1);
    } finally {
      connection.close();
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("refuse les données internes ou les paramètres illégaux et reconnait une erreur IPC", () => {
    expect(ipc.discoveryCurrent.request.safeParse(["affinities"]).success).toBe(true);
    for (const args of [["hybrid", null], ["gems", 0], ["gems", null, "seed"]]) {
      expect(ipc.discoveryGenerate.request.safeParse(args).success).toBe(false);
    }
    expect(ipc.discoveryGenerate.request.safeParse(["offbeat", null]).success).toBe(true);
    expect(ipc.discoveryGenerate.response.safeParse({ ok: false, error: "Base indisponible" }).success).toBe(true);
    const view = { id: 1, films: [{ id: 4, title: "Sans affiche", year: null, genres: [], reason: "Catalogue." }], renewed: null, eligible: 1 };
    expect(ipc.discoveryCurrent.response.safeParse({ ok: true, data: view }).success).toBe(true);
    expect(ipc.discoveryCurrent.response.safeParse({ ok: true, data: { ...view, fingerprint: "privé" } }).success).toBe(false);
  });

  it("migre depuis le Laboratoire, reprend après redémarrage et isole les consultations du profil", async () => {
    const folder = await mkdtemp(join(tmpdir(), "after-dark-discovery-"));
    const previous = join(folder, "migrations");
    const filename = join(folder, "catalogue.sqlite");
    await mkdir(join(previous, "meta"), { recursive: true });
    const journal: { entries: { idx: number; tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    journal.entries = journal.entries.filter(({ idx }) => idx < 7);
    await writeFile(join(previous, "meta/_journal.json"), JSON.stringify(journal));
    await Promise.all(journal.entries.map(({ tag }) => copyFile(join("drizzle", tag + ".sql"), join(previous, tag + ".sql"))));
    let connection = await openDatabase(filename, previous);
    const date = new Date(discoveryDate + "T22:00:00Z");
    try {
      const { db } = connection;
      await db.insert(movies).values(fixture.catalogue.map(({ id, title, year, metadata }) => ({ id, displayTitle: title, year, metadata })));
      await db.insert(movieStatuses).values({ movieId: 41, status: "seen" });
      await db.insert(movieEvaluations).values({ movieId: 41, kind: "historical_score", score: "8,5", source: "import", sourceId: "original" });
      await db.insert(favorites).values({ movieId: 41, source: "import", spontaneous: true });
      await saveFeedback(db, { action: "intention", movieId: 3, intention: "not_interested" });
      await startLab(db, { mood: "surprise", preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [] }, false, date, "lab");
      const before = await readCatalogue(db);
      const historical = await db.select().from(movieEvaluations);
      const classic = await readHistory(db);
      const sessions = await db.select().from(labSessions);
      const proposals = await db.select().from(labProposals);
      expect(proposals.length).toBeGreaterThanOrEqual(2);
      connection.close();
      connection = await openDatabase(filename, "drizzle");
      const upgraded = connection.db;
      expect(await currentDiscovery(upgraded, "gems")).toBeNull();
      const first = await generateDiscovery(upgraded, "gems", null, date, "seed-one");
      expect(first?.films).toHaveLength(8);
      expect(first?.films.map(({ id }) => id)).not.toContain(3);
      expect(await generateDiscovery(upgraded, "gems", null, date, "duplicate")).toEqual(first);
      expect(await upgraded.select().from(discoveryExplorations)).toHaveLength(1);
      expect(await readCatalogue(upgraded)).toEqual(before);
      expect(await upgraded.select().from(movieEvaluations)).toEqual(historical);
      expect(await readHistory(upgraded)).toEqual(classic);
      expect(await upgraded.select().from(labSessions)).toEqual(sessions);
      expect(await upgraded.select().from(labProposals)).toEqual(proposals);

      const movieId = first!.films[0].id;
      await saveFeedback(upgraded, { action: "intention", movieId, intention: "watch_later" });
      expect((await getCollection(upgraded)).find((entry) => entry.movieId === movieId)?.intention).toBe("watch_later");
      expect(await currentDiscovery(upgraded, "gems")).toEqual(first);
      connection.close();
      connection = await openDatabase(filename, "drizzle");
      expect(await currentDiscovery(connection.db, "gems")).toEqual(first);
      const next = await generateDiscovery(connection.db, "gems", first!.id, date, "seed-two");
      expect(next?.renewed).toBe(8);
      expect((await getCollection(connection.db)).find((entry) => entry.movieId === movieId)?.intention).toBe("watch_later");
      await saveFeedback(connection.db, { action: "seen", movieId, score: null, appreciation: null });
      expect((await getCollection(connection.db)).find((entry) => entry.movieId === movieId)?.seenAt).toBeTruthy();
      expect((await generateDiscovery(connection.db, "affinities", null, date))?.films.map(({ id }) => id)).not.toContain(movieId);
      expect(await connection.db.select().from(movieEvaluations)).toEqual(historical);
    } finally {
      connection.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
