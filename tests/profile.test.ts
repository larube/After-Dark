import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import example from "../examples/profile.v1.json";
import { openDatabase } from "../src/db/client";
import { readMood, saveMood } from "../src/db/moods";
import { getProfileSummary } from "../src/db/profile";
import { favorites, movieEvaluations, movieStatuses, movies } from "../src/db/schema";
import { importProfile } from "../src/import/profile";
import { evaluationSchema, newScore, type ProfileEntry } from "../src/shared/profile";

const source = "calibration";
const film = {
  canonicalId: "film:a", displayTitle: "Les Affranchis", originalTitle: "Goodfellas", year: 1990,
};

describe("validation des évaluations", () => {
  it("accepte les entiers de 0 à 10 et refuse les valeurs hors limites ou non entières", () => {
    for (const score of [0, 5, 10]) expect(newScore.safeParse(score).success).toBe(true);
    for (const score of [-1, 8.5, 11, "8"]) expect(newScore.safeParse(score).success).toBe(false);
  });

  it("valide exactement les décimales historiques et l’ordre des bornes", () => {
    const range = { kind: "historical_range", source, sourceId: "1", min: "8,5000", max: "8.5000000000000001" };
    expect(evaluationSchema.parse(range)).toEqual(range);
    expect(evaluationSchema.safeParse({ ...range, min: "8.5000000000000002" }).success).toBe(false);
    expect(evaluationSchema.safeParse({ ...range, max: "10,1" }).success).toBe(false);
    expect(evaluationSchema.safeParse({ ...range, min: 8.5 }).success).toBe(false);
  });

  it("conserve le libellé qualitatif et refuse un score associé", () => {
    const qualitative = { kind: "qualitative", source, sourceId: "q", appreciation: "  Beaucoup aimé " };
    expect(evaluationSchema.parse(qualitative)).toEqual(qualitative);
    expect(evaluationSchema.safeParse({ ...qualitative, score: 10 }).success).toBe(false);
    expect(evaluationSchema.safeParse({ ...qualitative, appreciation: " " }).success).toBe(false);
  });
});

describe("profil dans une base SQLite temporaire", () => {
  let dir: string;
  let filename: string;
  let connection: Awaited<ReturnType<typeof openDatabase>>;
  const migrations = resolve("drizzle");

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "after dark-test-"));
    filename = join(dir, "profile.sqlite");
    connection = await openDatabase(filename, migrations);
  });
  afterEach(() => {
    connection.close();
    rmSync(dir, { recursive: true });
  });

  function load(...entries: ProfileEntry[]) {
    return importProfile(connection.db, { version: 1, entries });
  }

  it("importe le fichier d’exemple à l’identique et retrouve les valeurs après fermeture", async () => {
    expect(await importProfile(connection.db, example)).toMatchObject({ created: 6, updated: 0, duplicates: 0, errors: [] });
    expect(await importProfile(connection.db, example)).toMatchObject({ created: 0, updated: 0, duplicates: 6, errors: [] });
    connection.close();
    connection = await openDatabase(filename, migrations);
    expect(await getProfileSummary(connection.db)).toMatchObject({ movies: 6, seen: 4, evaluated: 4, unseen: 1 });
    expect(await connection.db.select().from(movieEvaluations).orderBy(movieEvaluations.id).all()).toMatchObject([
      { kind: "historical_score", score: "9" },
      { kind: "historical_score", score: "8,5" },
      { kind: "historical_range", score: null, rangeMin: "8,5", rangeMax: "9" },
      { kind: "qualitative", score: null, appreciation: "Beaucoup aimé" },
    ]);
  });

  it("distingue vu, non vu, inconnu et absence de statut", async () => {
    const make = (name: string) => ({ canonicalId: name, displayTitle: name });
    await load({ movie: make("A"), status: "seen" }, { movie: make("B"), status: "unseen" },
      { movie: make("C"), status: "unknown" }, { movie: make("D") });
    expect((await connection.db.select().from(movieStatuses).orderBy(movieStatuses.movieId).all()).map(({ status }) => status))
      .toEqual(["seen", "unseen", "unknown"]);
    expect(await getProfileSummary(connection.db)).toMatchObject({ movies: 4, seen: 1, evaluated: 0, unseen: 1 });
  });

  it("réconcilie les titres français et originaux, les alias et les identifiants externes", async () => {
    const foreign = { movie: { canonicalId: "v2:a", displayTitle: "Goodfellas", year: 1990, externalIds: { imdb: "tt0099685" } } };
    const namedElsewhere = { movie: { canonicalId: "v3:a", displayTitle: "Altra versione", externalIds: { imdb: "tt0099685" } } };
    const seven = { movie: { canonicalId: "seven", displayTitle: "Seven", year: 1995, aliases: ["Se7en"] } };
    const alternate = { movie: { canonicalId: "se7en", displayTitle: "Se7en", year: 1995 } };
    const enemy = { movie: { canonicalId: "enemy", displayTitle: "Enemy" } };
    expect(await load({ movie: film }, foreign, foreign, namedElsewhere, seven, alternate, enemy, enemy))
      .toMatchObject({ created: 3, updated: 3, duplicates: 2, ambiguities: [], errors: [] });
  });

  it("signale un titre ambigu ou des identifiants qui se contredisent", async () => {
    const a = { movie: { ...film, tmdbId: 1 } };
    const b = { movie: { ...film, canonicalId: "film:b", tmdbId: 2 } };
    expect((await load(a, b)).created).toBe(2);
    expect((await load(
      { movie: { ...film, canonicalId: "film:c" } },
      { movie: { ...a.movie, tmdbId: 2 } },
      { movie: { canonicalId: "unknown-year", displayTitle: "Goodfellas" } },
    )).ambiguities.map(({ entry }) => entry)).toEqual([1, 2, 3]);
    expect(await connection.db.select().from(movies).all()).toHaveLength(2);
  });

  it("garde les sources distinctes et refuse toute réécriture contradictoire", async () => {
    const legacy = { kind: "historical_score", source, sourceId: "old", score: "8,50", evaluatedOn: "2020-03-03" } as const;
    const recent = { kind: "score", source: "recent", sourceId: "new", score: 9, evaluatedOn: "2024-01-01" } as const;
    await load({ movie: film, status: "seen", evaluations: [legacy, recent] });
    expect(await load({ movie: film, status: "unknown" })).toMatchObject({ duplicates: 1 });
    expect(await load({
      movie: { ...film, metadata: { overview: "Non enregistré car entrée en conflit" } },
      evaluations: [{ ...recent, score: 7, evaluatedOn: "2020-01-01" }],
    }, { movie: { canonicalId: "film:b", displayTitle: "Film B" } }))
      .toMatchObject({ errors: [{ entry: 1 }], created: 1, updated: 0 });
    expect(await connection.db.select().from(movieEvaluations).orderBy(movieEvaluations.id).all()).toMatchObject([
      { score: "8,50", source, evaluatedOn: "2020-03-03" },
      { score: "9", source: "recent", evaluatedOn: "2024-01-01" },
    ]);
    expect((await connection.db.select().from(movies).get())?.metadata).toBeNull();
    expect(await getProfileSummary(connection.db)).toMatchObject({ movies: 2, seen: 1 });
  });

  it("marque comme vus les films évalués sans statut ou déclarés inconnus", async () => {
    const first = { movie: film, evaluations: [{ kind: "historical_score", source, sourceId: "old", score: "8,50", evaluatedOn: "2020-03-03" }] } satisfies ProfileEntry;
    const second = {
      movie: { canonicalId: "film:b", displayTitle: "Film B" },
      status: "unknown",
      evaluations: [{ kind: "qualitative", source, sourceId: "b", appreciation: "Bien" }],
    } satisfies ProfileEntry;
    expect(await load(first, second)).toMatchObject({ created: 2, errors: [] });
    expect(await load(first, second)).toMatchObject({ updated: 0, duplicates: 2, errors: [] });
    expect(await getProfileSummary(connection.db)).toMatchObject({ movies: 2, seen: 2, evaluated: 2, unseen: 0 });
    expect(await connection.db.select().from(movieEvaluations).orderBy(movieEvaluations.id).all()).toMatchObject([
      { source, sourceId: "old", score: "8,50", evaluatedOn: "2020-03-03" },
      { source, sourceId: "b", appreciation: "Bien" },
    ]);
  });

  it.each([undefined, "seen"] as const)("passe de non vu à vu après visionnage (statut fourni : %s)", async (status) => {
    const unseen = { movie: film, status: "unseen" } satisfies ProfileEntry;
    const evaluation = { kind: "score", source, sourceId: "later", score: 7 } as const;
    const watched = { movie: film, status, evaluations: [evaluation] };
    await load(unseen);
    expect(await getProfileSummary(connection.db)).toMatchObject({ seen: 0, evaluated: 0, unseen: 1 });
    expect(await load(watched)).toMatchObject({ updated: 1, errors: [] });
    expect(await load(watched)).toMatchObject({ updated: 0, duplicates: 1, errors: [] });
    expect(await load(unseen)).toMatchObject({ errors: [{ entry: 1 }], updated: 0 });
    expect(await getProfileSummary(connection.db)).toMatchObject({ seen: 1, evaluated: 1, unseen: 0 });
  });

  it("refuse une déclaration non vue contradictoire dans l’import et dans SQLite", async () => {
    const evaluation = { kind: "score", source, sourceId: "invalid", score: 7 } as const;
    await load({ movie: film, status: "unseen" });
    expect((await load({ movie: film, status: "unseen", evaluations: [evaluation] })).errors).toHaveLength(1);
    expect(await getProfileSummary(connection.db)).toMatchObject({ seen: 0, evaluated: 0, unseen: 1 });
    await expect(connection.db.insert(movieEvaluations).values({ ...evaluation, score: "7", movieId: 1 }).run())
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/explicitly unseen/) } });
    await load({ movie: film, status: "seen", evaluations: [evaluation] });
    await expect(connection.db.update(movieStatuses).set({ status: "unseen" }).where(eq(movieStatuses.movieId, 1)).run())
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/explicitly unseen/) } });
  });

  it("rétablit les statuts vus dans une base créée avant la migration sans toucher aux évaluations", async () => {
    const legacyMigrations = join(dir, "legacy");
    mkdirSync(join(legacyMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(migrations, "meta", "_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 2);
    writeFileSync(join(legacyMigrations, "meta", "_journal.json"), JSON.stringify(journal));
    for (const tag of ["0000_initial", "0001_unseen_cannot_be_evaluated"]) {
      copyFileSync(join(migrations, `${tag}.sql`), join(legacyMigrations, `${tag}.sql`));
    }
    const legacyFilename = join(dir, "legacy.sqlite");
    const legacy = await openDatabase(legacyFilename, legacyMigrations);
    let originalEvaluations: (typeof movieEvaluations.$inferSelect)[];
    try {
      await legacy.db.insert(movies).values([1, 2, 3, 4, 5].map((id) => ({ id, displayTitle: `Film ${id}` }))).run();
      await legacy.db.insert(movieStatuses).values([
        { movieId: 2, status: "unknown" }, { movieId: 3, status: "unknown" }, { movieId: 4, status: "unseen" },
      ]).run();
      await legacy.db.insert(movieEvaluations).values([1, 2].map((movieId) => ({
        movieId, kind: "historical_score" as const, source, sourceId: String(movieId), score: "8,50",
      }))).run();
      originalEvaluations = await legacy.db.select().from(movieEvaluations).orderBy(movieEvaluations.id).all();
    } finally {
      legacy.close();
    }
    const upgraded = await openDatabase(legacyFilename, migrations);
    try {
      expect(await upgraded.db.select().from(movieStatuses).orderBy(movieStatuses.movieId).all()).toEqual([
        { movieId: 1, status: "seen" }, { movieId: 2, status: "seen" },
        { movieId: 3, status: "unknown" }, { movieId: 4, status: "unseen" },
      ]);
      expect(await upgraded.db.select().from(movieEvaluations).orderBy(movieEvaluations.id).all()).toEqual(originalEvaluations);
    } finally {
      upgraded.close();
    }
  });

  it("applique les clés étrangères après un import transactionnel", async () => {
    await load({ movie: film });
    await expect(connection.db.insert(movieStatuses).values({ movieId: 999, status: "seen" }).run())
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/FOREIGN KEY constraint failed/i) } });
  });

  it("préserve les préférences indépendantes et leur source", async () => {
    await load({ movie: film, favorites: [{ source, spontaneous: true, memorable: false, rewatch: true }] });
    expect((await load({ movie: film, favorites: [{ source, rewatch: true }, { source: "other", rewatch: false }] })).updated).toBe(1);
    expect(await connection.db.select().from(favorites).orderBy(favorites.source).all()).toMatchObject([
      { source, spontaneous: true, memorable: false, rewatch: true },
      { source: "other", spontaneous: null, memorable: null, rewatch: false },
    ]);
    expect(await getProfileSummary(connection.db)).toMatchObject({ evaluated: 0, favorites: [{ title: "Les Affranchis" }] });
  });

  it("valide tout le document avant les écritures et valide version et structure", async () => {
    expect((await importProfile(connection.db, { version: 2, entries: [{ movie: film }] })).errors).toHaveLength(1);
    expect((await load({ movie: film }, { movie: { ...film, year: -1 } })).errors).toHaveLength(1);
    expect((await getProfileSummary(connection.db)).movies).toBe(0);
  });

  it("conserve les paramètres de mood et l’option Surprends-moi après redémarrage", async () => {
    const mood = {
      date: "2026-11-22T20:00:00+01:00", energy: "Basse", atmosphere: "Intime", experience: "Surprise",
      maxMinutes: 105, preferredCountries: ["FR"], requiredCountries: ["JP"],
      preferredLanguages: ["fr"], requiredLanguages: ["ja"], constraints: ["Sans violence graphique"], surpriseMe: true,
    };
    await expect(saveMood(connection.db, { ...mood, maxMinutes: 0 })).rejects.toThrow();
    const id = await saveMood(connection.db, mood);
    connection.close();
    connection = await openDatabase(filename, migrations);
    expect(await readMood(connection.db, id)).toEqual(mood);
  });
});
