import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, type CinemaDatabase } from "../src/db/client";
import { abandonLab, answerLab, currentLab, exportLab, finishLab, labResults, pauseLab, startLab, transferLabSeen } from "../src/db/lab";
import { getCollection } from "../src/db/feedback";
import { readCatalogue, readHistory } from "../src/db/recommendations";
import { favorites, labProposals, movieEvaluations, movieStatuses, movies, moodSessions } from "../src/db/schema";
import { affinityModels } from "../src/domain/affinity";
import { assignLabFilms, rankLabModels, type LabSelections } from "../src/domain/lab";
import { recommend } from "../src/domain/recommendation";
import { ipc } from "../src/shared/ipc";
import { labResultsSchema, labStateSchema } from "../src/shared/lab";
import { criteriaSchema } from "../src/shared/recommendation";

const criteria = criteriaSchema.parse({
  mood: "tension", preferredCountries: [], preferredLanguages: [], requiredCountries: [], requiredLanguages: [],
});
const date = new Date("2026-11-23T20:00:00Z");
const picks = (...ids: number[]) => ids.map((movieId, index) => ({ movieId, rank: index + 1 }));
const collisions: LabSelections = {
  current: picks(1, 2), normalized: picks(1), rarity: picks(2, 3), hybrid: picks(3, 4, 5),
};

async function seed(db: CinemaDatabase) {
  await db.insert(movies).values([
    { id: 1, displayTitle: "Le Brouillard", metadata: { genres: ["Thriller"], minutes: 100, directors: ["Ariane Or"] } },
    { id: 2, displayTitle: "Le Quai", metadata: {} },
    { id: 3, displayTitle: "La Balise", year: 2020, metadata: { genres: ["Thriller"], synopsis: "Une balise émet encore.", minutes: 97 } },
    { id: 4, displayTitle: "Les Veilleurs", metadata: { countries: ["FR"], minutes: 110 } },
    { id: 5, displayTitle: "La Source", metadata: { genres: ["Thriller"], minutes: 98, directors: ["Ariane Or"] } },
    { id: 6, displayTitle: "Court", metadata: { minutes: 10 } },
  ]);
  await db.insert(movieEvaluations).values({ movieId: 5, kind: "historical_score", score: "8.5", source: "import", sourceId: "fictif" });
  await db.insert(movieStatuses).values({ movieId: 5, status: "seen" });
  await db.insert(favorites).values({ movieId: 5, spontaneous: true, source: "import" });
}

describe("procédure du Laboratoire", () => {
  it("maximise la couverture en résolvant une collision que le choix glouton ne résout pas", () => {
    const assigned = assignLabFilms(collisions, new Set(), "exemple");
    expect(assignLabFilms(collisions, new Set(), "exemple")).toEqual(assigned);
    expect(assigned.entries).toHaveLength(4);
    expect(new Set(assigned.entries.map(({ movieId }) => movieId)).size).toBe(4);
    expect(assigned.entries).toContainEqual({ model: "normalized", movieId: 1, rank: 1 });
    expect(assigned.entries).toContainEqual({ model: "hybrid", movieId: 4, rank: 2 });
    expect(assigned.collisions).toBe(3);
    const fresh = assignLabFilms(collisions, new Set([4]), "exemple");
    expect(fresh.entries).toContainEqual({ model: "hybrid", movieId: 5, rank: 3 });
    expect(fresh.repeated).toBe(0);
    const partial = assignLabFilms({ current: picks(1), normalized: picks(1), rarity: picks(2), hybrid: picks(2) }, new Set(), "exemple");
    expect(partial.entries).toHaveLength(2);
  });

  it("valide strictement le contrat IPC de vote et les champs de la carte aveugle", () => {
    const id = "87c7b129-4996-4d28-a9ca-466f187a454e";
    expect(ipc.labAnswer.request.safeParse([id, 1, { seen: true }]).success).toBe(true);
    expect(ipc.labAnswer.request.safeParse([id, 1, { seen: true, interest: "eager" }]).success).toBe(false);
    expect(ipc.labAnswer.request.safeParse([id, 5, { seen: false, interest: "maybe" }]).success).toBe(false);
    expect(ipc.labAnswer.request.safeParse([id, 1, { seen: false, interest: "maybe", reason: "x".repeat(181) }]).success).toBe(false);
    const publicCard = { status: "voting", sessionId: id, total: 2, answered: 0, position: 1, film: { title: "Sans affiche", year: null } };
    expect(ipc.labCurrent.response.safeParse({ ok: true, data: publicCard }).success).toBe(true);
    for (const field of ["model", "rank", "score", "reasons", "metadata", "movieId"]) {
      expect(labStateSchema.safeParse({ ...publicCard, film: { ...publicCard.film, [field]: 1 } }).success).toBe(false);
      expect(labStateSchema.safeParse({ ...publicCard, [field]: 1 }).success).toBe(false);
    }
  });

  it("migre une base antérieure, reprend après fermeture et sépare les réponses du profil", async () => {
    const folder = await mkdtemp(join(tmpdir(), "after-dark-lab-test-"));
    const previous = join(folder, "migrations");
    const filename = join(folder, "lab.sqlite");
    await mkdir(join(previous, "meta"), { recursive: true });
    const journal: { entries: { idx: number; tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    journal.entries = journal.entries.filter(({ idx }) => idx < 6);
    await writeFile(join(previous, "meta/_journal.json"), JSON.stringify(journal));
    await Promise.all(journal.entries.map(({ tag }) => copyFile(join("drizzle", tag + ".sql"), join(previous, tag + ".sql"))));
    let database = await openDatabase(filename, previous);
    try {
      await seed(database.db);
      database.close();
      database = await openDatabase(filename, "drizzle");
      const before = await readCatalogue(database.db);
      const history = await readHistory(database.db);
      const expected = rankLabModels(before.catalogue, before.signals, criteria, history.recent, "2026-11-23");
      for (const model of affinityModels) {
        expect(expected[model].map(({ movieId }) => movieId)).toEqual(recommend(
          before.catalogue, before.signals, criteria, history.recent, { referenceDate: "2026-11-23" }, model,
        ).films.map(({ id }) => id));
        expect(expected[model].some(({ movieId }) => movieId === 6)).toBe(false);
      }

      const { public: initial } = await startLab(database.db, criteria, false, date, "stable");
      if (initial.status !== "voting") throw Error("Proposition attendue");
      const id = initial.sessionId;
      expect(initial.total).toBe(4);
      expect(labStateSchema.parse(initial)).toEqual(initial);
      expect((await startLab(database.db, criteria, false, date, "other")).public).toEqual(initial);
      expect(await finishLab(database.db, id)).toBe(false);
      expect((await answerLab(database.db, id, 2, { seen: true })).public).toEqual(initial);
      await answerLab(database.db, id, 1, { seen: true, reason: "Souvenir" });
      await answerLab(database.db, id, 1, { seen: false, interest: "pass" });
      expect((await pauseLab(database.db, id, true)).public).toMatchObject({ status: "paused", answered: 1 });
      expect(await exportLab(database.db)).toMatchObject({ sessions: [], pending: { responses: 1 } });
      expect(JSON.stringify(await exportLab(database.db))).not.toMatch(/stable|hybrid|Souvenir/);
      expect((await labResults(database.db)).latest).toBeNull();
      expect(await transferLabSeen(database.db, id, 1)).toMatchObject({ ok: false });

      database.close();
      database = await openDatabase(filename, "drizzle");
      expect((await currentLab(database.db)).public).toMatchObject({ sessionId: id, status: "paused", answered: 1 });
      expect((await answerLab(database.db, id, 2, { seen: false, interest: "eager" })).public.status).toBe("paused");
      expect((await pauseLab(database.db, id, false)).public).toMatchObject({ status: "voting", position: 2 });
      for (let position = 2; position <= initial.total; position++) {
        const { public: view } = await answerLab(database.db, id, position, { seen: false, interest: "eager" });
        expect(labStateSchema.parse(view)).toEqual(view);
        expect(view.status).toBe(position === initial.total ? "ready" : "voting");
      }
      expect((await labResults(database.db)).latest).toBeNull();
      expect(await finishLab(database.db, id, date)).toBe(true);
      expect(await finishLab(database.db, id, date)).toBe(true);
      expect((await answerLab(database.db, id, 1, { seen: false, interest: "maybe" })).public.status).toBe("idle");
      const results = labResultsSchema.parse(await labResults(database.db));
      expect(results).toMatchObject({ complete: 1, incomplete: 0, latest: { covered: 4 } });
      expect(results.latest?.reviews[0].answer).toEqual({ seen: true, reason: "Souvenir" });

      const exported = await exportLab(database.db);
      const session = exported.sessions[0];
      expect(session).toMatchObject({ id, seed: "stable", protocol: "blind-v1", selections: expected, criteria });
      expect(session.proposals.map(({ movieId, model, originalRank }) => ({ movieId, model, rank: originalRank })))
        .toEqual(assignLabFilms(session.selections, new Set(session.labHistory), session.seed).entries);
      expect((await startLab(database.db, criteria, false, date)).public.status).toBe("no-new");
      const { public: repeat } = await startLab(database.db, criteria, true, date);
      if (repeat.status !== "voting") throw Error("Proposition répétée attendue");
      await answerLab(database.db, repeat.sessionId, 1, { seen: false, interest: "maybe", reason: "Abandonnée" });
      expect((await abandonLab(database.db, repeat.sessionId)).public.status).toBe("idle");
      expect(await finishLab(database.db, repeat.sessionId)).toBe(false);
      expect(await labResults(database.db)).toEqual({ ...results, incomplete: 1 });
      const withAbandoned = await exportLab(database.db);
      expect(withAbandoned).toMatchObject({ pending: null, abandoned: [{ responses: 1 }] });
      expect(JSON.stringify(withAbandoned)).not.toContain("Abandonnée");
      expect(await readCatalogue(database.db)).toEqual(before);
      expect(await readHistory(database.db)).toEqual(history);
      expect(await database.db.select().from(moodSessions)).toEqual([]);
      const [transfer] = results.seenForCollection;
      expect(transfer).toMatchObject({ sessionId: id, position: 1 });
      expect(await transferLabSeen(database.db, id, 2)).toMatchObject({ ok: false });
      const evaluations = await database.db.select().from(movieEvaluations);
      expect(await transferLabSeen(database.db, id, 1, date)).toMatchObject({ ok: true });
      expect(await transferLabSeen(database.db, id, 1)).toEqual({ ok: true, data: null });
      expect(await getCollection(database.db)).toContainEqual(expect.objectContaining({
        movieId: session.proposals[0].movieId, seenAt: date.toISOString(), score: null, appreciation: null,
      }));
      expect(await labResults(database.db)).toEqual({ ...results, incomplete: 1, seenForCollection: [] });
      expect(await database.db.select().from(movieEvaluations)).toEqual(evaluations);
      expect(await exportLab(database.db)).toEqual(withAbandoned);
      expect((await readCatalogue(database.db)).signals).toEqual(before.signals);
    } finally {
      database.close();
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("refuse un catalogue à un seul film et permet une comparaison partielle sans affiche", async () => {
    const folder = await mkdtemp(join(tmpdir(), "after-dark-lab-small-"));
    const { db, close } = await openDatabase(join(folder, "lab.sqlite"), "drizzle");
    try {
      await db.insert(movies).values({ displayTitle: "Seul", metadata: {} });
      expect((await startLab(db, criteria, false, date)).public.status).toBe("insufficient");
      expect(await db.select().from(labProposals)).toEqual([]);
      await db.insert(movies).values({ displayTitle: "Second", metadata: {} });
      const { public: view } = await startLab(db, criteria, false, date);
      expect(view).toMatchObject({ status: "voting", total: 2, film: { year: null } });
      expect(view.status === "voting" && view.film.posterData).toBeUndefined();
      expect(view.status === "voting" && view.film.synopsis).toBeUndefined();
    } finally {
      close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
