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
    expect(second.renewed).toBe(6);
    expect(run("gems", { previous: [ids(first)], adjacent: [] }, "second")).toEqual(second);
    const small = fixture.catalogue.filter(({ id }) => id === 1 || id === 37);
    const repeated = explore(small, [], new Set(), "offbeat", { previous: [[1, 37]], adjacent: [] }, "test", discoveryDate);
    expect(repeated.renewed).toBe(0);
    expect(ids(repeated).sort()).toEqual([1, 37]);
    expect(discoveryPool(small, new Set([1]), discoveryDate)[0].metadata.poster).toBeUndefined();
    expect(explore([], [], new Set(), "gems", blank, "test", discoveryDate).selected).toEqual([]);
  });

  it.each(discoveryModes)("préserve la pertinence des films récents en mode %s", (mode) => {
    const source = fixture.signals[0];
    const good = { ...source.film, id: 101, status: "unknown" as const };
    const disliked = fixture.catalogue.find(({ id }) => id === 19)!;
    const negative = { ...disliked, metadata: { ...disliked.metadata, directors: [] } };
    const signals = [...fixture.signals, {
      ...source, spontaneous: false, film: disliked, ratings: [{ numeric: 0 }],
    }];
    expect(explore([negative], signals, new Set(), mode, blank, "rotation", discoveryDate).selected[0].fit).toBe(-.85);
    expect(ids(explore([good, negative], signals, new Set(), mode, { ...blank, previous: [[good.id]] }, "rotation", discoveryDate)))
      .toEqual([good.id, negative.id]);
  });

  it.each(discoveryModes)("limite le bonus de nouveauté entre films admissibles du même niveau en mode %s", (mode) => {
    const source = fixture.signals[0].film;
    const metadata = { genres: [], directors: [], countries: [], keywords: source.metadata.keywords.slice(0, 3) };
    const recent = { ...source, id: 101, status: "unknown" as const, metadata };
    const fresh = { ...recent, id: 102, metadata: { ...metadata, keywords: ["rare weak trait"] } };
    const signals = [...fixture.signals, {
      film: fresh, ratings: [{ numeric: 7 }], spontaneous: false, memorable: false, rewatch: false,
    }];
    const result = explore([recent, fresh], signals, new Set(), mode,
      { ...blank, previous: [[recent.id]] }, "window", discoveryDate);
    expect(result.selected.every(({ qualityTier }) => qualityTier === 0)).toBe(true);
    expect(ids(result)).toEqual([recent.id, fresh.id]);
  });

  it.each(discoveryModes)("fait passer un inédit comparable devant son équivalent récent en mode %s", (mode) => {
    const source = fixture.signals[0].film;
    const recent = { ...source, id: 101, status: "unknown" as const };
    const older = { ...recent, id: 102 };
    const fresh = { ...recent, id: 103 };
    const result = explore([recent, older, fresh], fixture.signals, new Set(), mode,
      { ...blank, previous: [[recent.id], [older.id]] }, "comparable", discoveryDate);
    expect(ids(result)).toEqual([fresh.id, older.id, recent.id]);
  });

  it("laisse Hors piste explorer les fiches neutres mais garde les fortes affinités négatives en dernier recours", () => {
    const [neutral, disliked] = [28, 20].map((id) => fixture.catalogue.find((film) => film.id === id)!);
    const signals = [...fixture.signals, {
      film: disliked, ratings: [{ numeric: 0 }], spontaneous: false, memorable: false, rewatch: false,
    }];
    const result = explore([neutral, disliked], signals, new Set(), "offbeat", { ...blank, previous: [[neutral.id]] }, "test", discoveryDate);
    expect(ids(result)).toEqual([neutral.id, disliked.id]);
    expect(result.selected[1].fit).toBeLessThan(-1);
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
      expect(next?.renewed).toBeGreaterThan(0);
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
