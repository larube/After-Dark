import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client";
import { getProfileSummary } from "../src/db/profile";
import { getCollection, saveFeedback } from "../src/db/feedback";
import { readCatalogue } from "../src/db/recommendations";
import { movieEvaluations, movies, movieStatuses, plannedViewings } from "../src/db/schema";
import { recommend } from "../src/domain/recommendation";
import { importProfile } from "../src/import/profile";
import { needsRating } from "../src/shared/feedback";
import { criteriaSchema } from "../src/shared/recommendation";

const migrations = resolve("drizzle");
const film = { canonicalId: "fixture:cure", displayTitle: "Cure", year: 1997 };
const other = { canonicalId: "fixture:arrival", displayTitle: "Arrival", year: 2016 };
const profile = {
  version: 1, entries: [{
    movie: film, status: "seen", evaluations: [
      { kind: "historical_score", source: "import", sourceId: "a", score: "8,5" },
      { kind: "historical_range", source: "import", sourceId: "b", min: "7,5", max: "9" },
    ],
  }, { movie: other, status: "unseen" }],
};

describe("Retours personnels SQLite", () => {
  let directory: string;
  let filename: string;
  let connection: Awaited<ReturnType<typeof openDatabase>>;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "after-dark-feedback-"));
    filename = join(directory, "test.sqlite");
    connection = await openDatabase(filename, migrations);
  });
  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true });
  });

  it("migre la base PR 3 en conservant le profil, les favoris et les séances planifiées", async () => {
    const legacy = join(directory, "legacy");
    mkdirSync(join(legacy, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(migrations, "meta", "_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 3);
    writeFileSync(join(legacy, "meta", "_journal.json"), JSON.stringify(journal));
    for (const { tag } of journal.entries) copyFileSync(join(migrations, tag + ".sql"), join(legacy, tag + ".sql"));
    const previousFile = join(directory, "pr3.sqlite");
    const previous = await openDatabase(previousFile, legacy);
    try {
      await previous.db.run(sql`INSERT INTO movies (id, display_title, year) VALUES (1, 'Cure', 1997)`);
      await previous.db.run(sql`INSERT INTO movie_statuses VALUES (1, 'seen')`);
      await previous.db.run(sql`INSERT INTO movie_evaluations (movie_id, source, source_id, kind, score) VALUES (1,'calibration','cure','historical_score','8,5')`);
      await previous.db.run(sql`INSERT INTO favorites (movie_id, source, spontaneous) VALUES (1,'calibration',1)`);
      await previous.db.run(sql`INSERT INTO planned_viewings (movie_id, selected_at) VALUES (1,'2026-01-01')`);
      await previous.db.run(sql`INSERT INTO mood_sessions (id, date, criteria) VALUES (1,'2026-01-01','{}')`);
      await previous.db.run(sql`INSERT INTO recommendation_history (mood_session_id, movie_id, rank, engine_version) VALUES (1,1,1,'1.1.0')`);
    } finally {
      previous.close();
    }
    const upgraded = await openDatabase(previousFile, migrations);
    try {
      expect(await getCollection(upgraded.db)).toEqual([]);
      expect(await upgraded.db.select().from(movieEvaluations)).toMatchObject([{ sourceId: "cure", score: "8,5" }]);
      expect(await upgraded.db.select().from(movieStatuses)).toEqual([{ movieId: 1, status: "seen" }]);
      for (const table of ["favorites", "planned_viewings", "recommendation_history"]) {
        expect(await upgraded.db.get(sql`SELECT count(*) AS total FROM ${sql.identifier(table)}`)).toMatchObject({ total: 1 });
      }
    } finally {
      upgraded.close();
    }
  });

  it("remplace, retire et restaure les intentions indépendamment du statut et du score", async () => {
    await importProfile(connection.db, { version: 1, entries: [{ movie: other, status: "unseen" }] });
    const request = { action: "intention", movieId: 1, intention: "watch_later" } as const;
    expect(await saveFeedback(connection.db, request)).toMatchObject({ ok: true, data: { intention: "watch_later" } });
    await saveFeedback(connection.db, request);
    expect(await getCollection(connection.db)).toHaveLength(1);
    for (const intention of ["not_interested", "none", "tonight"] as const) {
      expect(await saveFeedback(connection.db, { ...request, intention })).toMatchObject({
        ok: true, data: intention === "none" ? null : { intention },
      });
    }
    connection.close();
    connection = await openDatabase(filename, migrations);
    expect(await getCollection(connection.db)).toMatchObject([{ intention: "tonight", seenAt: null }]);
    expect(await connection.db.select().from(movieStatuses)).toEqual([{ movieId: 1, status: "unseen" }]);
    expect((await readCatalogue(connection.db)).signals).toEqual([]);
    await importProfile(connection.db, { version: 1, entries: [{ movie: other, status: "seen" }] });
    expect(await getCollection(connection.db)).toEqual([]);
  });

  it("exclut les films marqués vus, conserve les retours après relance et protège le réimport", async () => {
    await importProfile(connection.db, profile);
    expect(await saveFeedback(connection.db, { action: "intention", movieId: 2, intention: "watch_later" })).toMatchObject({ ok: true });
    const { catalogue, signals } = await readCatalogue(connection.db);
    const criteria = criteriaSchema.parse({
      mood: "surprise", preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [],
    });
    expect(recommend(catalogue, signals, criteria, new Set()).films.map(({ id }) => id)).toEqual([2]);
    await saveFeedback(connection.db, { action: "seen", movieId: 2, score: null, appreciation: "Je me suis endormi." });
    connection.close();
    connection = await openDatabase(filename, migrations);
    const { catalogue: updated, signals: updatedSignals } = await readCatalogue(connection.db);
    expect(recommend(updated, updatedSignals, criteria, new Set()).films).toEqual([]);
    expect(updatedSignals.map(({ film }) => film.id)).toEqual([1]);
    expect(await getCollection(connection.db)).toMatchObject([{ movieId: 2, intention: "none", appreciation: "Je me suis endormi." }]);
    expect(await importProfile(connection.db, profile)).toMatchObject({
      duplicates: 1, errors: [{ message: expect.stringContaining("visionnage enregistré") }],
    });
    expect(await connection.db.select().from(movieStatuses)).toMatchObject([{ status: "seen" }, { status: "seen" }]);
    expect(await saveFeedback(connection.db, { action: "intention", movieId: 2, intention: "tonight" })).toEqual({
      ok: false, error: "Ce film est déjà marqué comme vu.",
    });
  });

  it.each(["unseen", "unknown", undefined] as const)("annule un visionnage depuis le statut %s et persiste après relance", async (status) => {
    await importProfile(connection.db, { version: 1, entries: [{ movie: other, status }] });
    const seen = { action: "seen", movieId: 1, score: 6, appreciation: "Saisie par erreur" } as const;
    await saveFeedback(connection.db, seen);
    await saveFeedback(connection.db, { ...seen, score: 7 });
    connection.close();
    connection = await openDatabase(filename, migrations);
    const undo = { action: "undo_seen", movieId: 1 } as const;
    expect(await saveFeedback(connection.db, undo)).toEqual({ ok: true, data: null });
    expect(await saveFeedback(connection.db, undo)).toEqual({ ok: true, data: null });
    connection.close();
    connection = await openDatabase(filename, migrations);
    expect(await getCollection(connection.db)).toEqual([]);
    expect(await connection.db.select().from(movieEvaluations)).toEqual([]);
    expect(await connection.db.select().from(movieStatuses)).toEqual([{ movieId: 1, status: status ?? "unknown" }]);
    expect(await getProfileSummary(connection.db)).toMatchObject({ seen: 0, evaluated: 0, unseen: status === "unseen" ? 1 : 0 });
    const { catalogue, signals } = await readCatalogue(connection.db);
    const criteria = criteriaSchema.parse({
      mood: "surprise", preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [],
    });
    expect(recommend(catalogue, signals, criteria, new Set()).films.map(({ id }) => id)).toEqual([1]);
  });

  it("protège les notes historiques même lorsqu’elles arrivent après le marquage", async () => {
    await importProfile(connection.db, { version: 1, entries: [{ movie: film, status: "unknown" }] });
    await saveFeedback(connection.db, { action: "seen", movieId: 1, score: 6, appreciation: "Retour manuel" });
    const imported = { ...profile.entries[0], status: undefined };
    expect(await importProfile(connection.db, { version: 1, entries: [imported] })).toMatchObject({ errors: [], updated: 1 });
    const original = await connection.db.select().from(movieEvaluations).orderBy(movieEvaluations.id);
    expect(original).toHaveLength(3);
    expect(await saveFeedback(connection.db, { action: "undo_seen", movieId: 1 })).toMatchObject({ ok: false });
    expect(await connection.db.select().from(movieEvaluations).orderBy(movieEvaluations.id)).toEqual(original);
    expect(await getCollection(connection.db)).toMatchObject([{ score: 6, appreciation: "Retour manuel" }]);
    expect(await getProfileSummary(connection.db)).toMatchObject({ seen: 1, evaluated: 1 });
  });

  it.each([true, false])("protège un statut vu importé, avant ou après le marquage (%s)", async (before) => {
    const imported = { version: 1, entries: [{ movie: other, status: "seen" }] };
    await importProfile(connection.db, before ? imported : { version: 1, entries: [{ movie: other }] });
    await saveFeedback(connection.db, { action: "seen", movieId: 1, score: null, appreciation: null });
    if (!before) {
      expect(await importProfile(connection.db, imported)).toMatchObject({ updated: 1, errors: [] });
      expect(await importProfile(connection.db, imported)).toMatchObject({ duplicates: 1, errors: [] });
    }
    expect(await saveFeedback(connection.db, { action: "undo_seen", movieId: 1 })).toMatchObject({ ok: false });
    expect(await getProfileSummary(connection.db)).toMatchObject({ seen: 1, evaluated: 0 });
  });

  it("conserve plusieurs choix uniques et ne les relance qu’au démarrage suivant", async () => {
    await importProfile(connection.db, { version: 1, entries: [{ movie: film }, { movie: other, status: "unseen" }] });
    const startup = "2026-11-23T10:00:00.000Z";
    const chosen = new Date("2026-11-23T10:30:00.000Z");
    await saveFeedback(connection.db, { action: "intention", movieId: 1, intention: "watch_later" });
    const launch = { action: "launch", movieId: 1 } as const;
    await saveFeedback(connection.db, launch, chosen);
    await saveFeedback(connection.db, launch, new Date("2026-11-23T11:00:00.000Z"));
    await saveFeedback(connection.db, { ...launch, movieId: 2 }, chosen);
    expect(await connection.db.select().from(plannedViewings)).toHaveLength(2);
    expect((await getCollection(connection.db, startup)).every((entry) => !entry.needsConfirmation && !entry.seenAt)).toBe(true);

    connection.close();
    connection = await openDatabase(filename, migrations);
    const next = "2026-11-24T10:00:00.000Z";
    const pending = await getCollection(connection.db, next);
    expect(pending).toHaveLength(2);
    expect(pending.every((entry) => entry.needsConfirmation && entry.selectedAt === chosen.toISOString())).toBe(true);
    await saveFeedback(connection.db, { action: "cancel_viewing", movieId: 1 });
    expect(await getCollection(connection.db, next)).toContainEqual(expect.objectContaining({
      movieId: 1, intention: "watch_later", seenAt: null,
    }));
    expect(await saveFeedback(connection.db, { action: "confirm_viewing", movieId: 1 })).toMatchObject({ data: { seenAt: null } });
    await saveFeedback(connection.db, { action: "confirm_viewing", movieId: 2 });
    await saveFeedback(connection.db, { action: "confirm_viewing", movieId: 2 });
    expect((await getCollection(connection.db, next)).filter(needsRating).map((entry) => entry.movieId)).toEqual([2]);
    expect(await connection.db.select().from(movieEvaluations)).toEqual([]);
    expect(await connection.db.select().from(plannedViewings)).toMatchObject([
      { movieId: 1, status: "cancelled", watchedAt: null },
      { movieId: 2, status: "watched", watchedAt: expect.any(String) },
    ]);

    const rate = { action: "evaluate", movieId: 2, appreciation: "8/10 ? Ça se discute." } as const;
    await saveFeedback(connection.db, { ...rate, score: null });
    expect((await getCollection(connection.db)).filter(needsRating).map((entry) => entry.movieId)).toEqual([2]);
    expect(await connection.db.select().from(movieEvaluations)).toEqual([]);
    for (const score of [0, 7, 7]) await saveFeedback(connection.db, { ...rate, score });
    expect(await connection.db.select().from(movieEvaluations)).toMatchObject([{ score: "7", source: "after-dark:manual" }]);
    await saveFeedback(connection.db, { ...rate, score: null, appreciation: null });
    expect((await getCollection(connection.db)).filter(needsRating)).toHaveLength(1);
    await saveFeedback(connection.db, { action: "undo_seen", movieId: 2 });
    expect(await connection.db.select().from(movieStatuses)).toContainEqual({ movieId: 2, status: "unseen" });
    expect(await connection.db.select().from(plannedViewings)).toMatchObject([
      { status: "cancelled" }, { status: "cancelled", watchedAt: null },
    ]);
  });

  it("clôt une séance devenue incompatible après réimport sans créer de visionnage After Dark", async () => {
    await importProfile(connection.db, { version: 1, entries: [{ movie: film }] });
    await saveFeedback(connection.db, { action: "launch", movieId: 1 });
    const imported = { version: 1, entries: [profile.entries[0]] };
    await importProfile(connection.db, imported);
    expect(await importProfile(connection.db, imported)).toMatchObject({ duplicates: 1, errors: [] });
    expect(await connection.db.select().from(plannedViewings)).toMatchObject([{ status: "cancelled", watchedAt: null }]);
    expect(await connection.db.select().from(movieEvaluations)).toMatchObject([
      { source: "import", score: "8,5" }, { source: "import", rangeMin: "7,5" },
    ]);
    expect(await getCollection(connection.db)).toEqual([]);
  });

  it("attend une note entière après confirmation locale et conserve les évaluations importées après relance", async () => {
    await importProfile(connection.db, { version: 1, entries: [
      { movie: film, status: "seen", evaluations: [
        { kind: "qualitative", source: "import", sourceId: "comment", appreciation: "Une découverte." },
        { kind: "historical_score", source: "import", sourceId: "half", score: "8,50" },
      ] },
      { movie: other, status: "seen" },
      { movie: { ...other, canonicalId: "fixture:whole", displayTitle: "Prisoners" }, status: "seen", evaluations: [
        { kind: "historical_score", source: "import", sourceId: "whole", score: "10,00" },
      ] },
    ] });
    const imported = await connection.db.select().from(movieEvaluations).orderBy(movieEvaluations.id);
    expect(imported).toHaveLength(3);
    expect((await getCollection(connection.db)).filter(needsRating)).toEqual([]);

    const seen = { action: "seen", score: null, appreciation: "Revu, toujours marquant." } as const;
    for (const movieId of [1, 2, 3]) await saveFeedback(connection.db, { ...seen, movieId });

    async function reopenAndRead() {
      connection.close();
      connection = await openDatabase(filename, migrations);
      return (await getCollection(connection.db)).filter(needsRating).map((entry) => entry.movieId).sort();
    }
    expect(await reopenAndRead()).toEqual([1, 2]);

    const evaluation = { action: "evaluate", movieId: 1, appreciation: "Revu, toujours marquant." } as const;
    await saveFeedback(connection.db, { ...evaluation, score: 0 });
    expect(await reopenAndRead()).toEqual([2]);
    await saveFeedback(connection.db, { ...evaluation, score: 9 });
    expect(await reopenAndRead()).toEqual([2]);
    expect(await connection.db.select().from(movieEvaluations).orderBy(movieEvaluations.id)).toEqual([
      ...imported, expect.objectContaining({ source: "after-dark:manual", score: "9" }),
    ]);
    await saveFeedback(connection.db, { ...evaluation, score: null });
    expect(await reopenAndRead()).toEqual([1, 2]);
    expect(await getCollection(connection.db)).toContainEqual(expect.objectContaining({
      movieId: 1, appreciation: evaluation.appreciation, score: null,
    }));
    expect(await connection.db.select().from(movieEvaluations).orderBy(movieEvaluations.id)).toEqual(imported);
  });

  it("préserve les séances historiques en dédoublonnant une ancienne base", async () => {
    const legacy = join(directory, "pr6");
    mkdirSync(join(legacy, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(migrations, "meta", "_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 5);
    writeFileSync(join(legacy, "meta", "_journal.json"), JSON.stringify(journal));
    for (const { tag } of journal.entries) copyFileSync(join(migrations, tag + ".sql"), join(legacy, tag + ".sql"));
    const previousFile = join(directory, "pr6.sqlite");
    const previous = await openDatabase(previousFile, legacy);
    try {
      await previous.db.insert(movies).values({ id: 1, displayTitle: "Cure" }).run();
      for (const selectedAt of ["2026-10-10", "2026-10-12", "2026-10-12"]) {
        await previous.db.insert(plannedViewings).values({ movieId: 1, selectedAt }).run();
      }
    } finally {
      previous.close();
    }
    const upgraded = await openDatabase(previousFile, migrations);
    try {
      expect(await upgraded.db.select().from(plannedViewings)).toMatchObject([
        { id: 1, status: "cancelled" }, { id: 2, status: "cancelled" }, { id: 3, status: "planned" },
      ]);
    } finally {
      upgraded.close();
    }
  });

  it("édite une seule note manuelle et conserve les évaluations importées à l’identique", async () => {
    await importProfile(connection.db, profile);
    const original = await connection.db.select().from(movieEvaluations).orderBy(movieEvaluations.id);
    const request = { action: "seen", movieId: 1, score: 0, appreciation: "Bien" } as const;
    await saveFeedback(connection.db, request);
    await saveFeedback(connection.db, request);
    expect(await getCollection(connection.db)).toMatchObject([{ score: 0, appreciation: "Bien" }]);
    const rows = await connection.db.select().from(movieEvaluations).orderBy(movieEvaluations.id);
    expect(rows).toEqual([...original, expect.objectContaining({ source: "after-dark:manual", score: "0" })]);
    await saveFeedback(connection.db, { ...request, score: 7, appreciation: "Deuxième lecture" });
    expect((await connection.db.select().from(movieEvaluations).orderBy(movieEvaluations.id)).at(-1))
      .toEqual({ ...rows[2], score: "7" });
    expect(await importProfile(connection.db, profile)).toMatchObject({ duplicates: 2, errors: [] });
    expect((await readCatalogue(connection.db)).signals[0].ratings).toEqual([{ numeric: 8.5 }, { numeric: 8.25 }, { numeric: 7 }]);
    await saveFeedback(connection.db, { ...request, score: null, appreciation: null });
    expect(await connection.db.select().from(movieEvaluations).orderBy(movieEvaluations.id)).toEqual(original);
    expect(await connection.db.select().from(movies)).toHaveLength(2);
    expect(await saveFeedback(connection.db, { ...request, movieId: 999 })).toEqual({
      ok: false, error: "Ce film n’est plus dans le catalogue.",
    });
  });
});
