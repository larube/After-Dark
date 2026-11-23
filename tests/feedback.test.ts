import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client";
import { getCollection, saveFeedback } from "../src/db/feedback";
import { readCatalogue } from "../src/db/recommendations";
import { movieEvaluations, movies, movieStatuses } from "../src/db/schema";
import { recommend } from "../src/domain/recommendation";
import { importProfile } from "../src/import/profile";
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
