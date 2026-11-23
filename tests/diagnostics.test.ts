import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLocalDatabase } from "../src/diagnostics/cli";
import { renderReport } from "../src/diagnostics/html";
import { compareReports, createReport, parseInput, scenarios } from "../src/diagnostics/report";
import { diagnoseRecommendation, holdoutInputs, recommend } from "../src/domain/recommendation";
import { openDatabase } from "../src/db/client";
import { favorites, moodSessions, movieEvaluations, movies, recommendationHistory } from "../src/db/schema";
import fixture from "../docs/engine-diagnostics/fixture.json";
import baseline from "../docs/engine-diagnostics/production-v1.1.0.json";

const input = parseInput(fixture);
const signals = input.signals.map(({ id, ...signal }) => ({ ...signal, film: input.catalogue.find((film) => film.id === id)! }));
const neutral = scenarios[0].criteria;

describe("engine diagnostics", () => {
  it("matches the pre-instrumentation engine for all scenarios, including every slot's scores and order", () => {
    const report = createReport(input);
    for (const run of report.scenarios) {
      const production = recommend(input.catalogue, signals, run.criteria, new Set(input.recent));
      expect(run.result).toEqual(production);
      const { films, ...rest } = production;
      expect({
        ...rest, films: films.map(({ id, category, reasons, warnings }) => ({ id, category, reasons, warnings })),
        base: Object.fromEntries(run.base.map(({ id, score }) => [id, score])),
        steps: run.steps.map(({ ranking }) => ranking.map(({ id, score }) => ({ id, score }))),
      }).toEqual(baseline[run.id as keyof typeof baseline]);
      for (const row of run.base) {
        expect(Object.values(row.contributions).reduce((sum, value) => sum + value, 0)).toBe(row.score);
      }
      expect(run.steps.map(({ ranking }) => ranking[0].id)).toEqual(films.map(({ id }) => id));
      for (const { ranking } of run.steps) {
        for (const row of ranking) expect(row.score).toBe(run.base.find(({ id }) => id === row.id)!.score - row.penalty + row.bonus);
      }
    }
    const tension = report.scenarios.find(({ id }) => id === "tension")!;
    const station = tension.base.find(({ id }) => id === 7)!;
    expect(station.mood?.weight).toBe(4);
    expect(station.affinity.matches).toContainEqual(expect.objectContaining({ label: "Mina Ocre", signalCount: 2 }));
    expect(tension.base.find(({ id }) => id === 9)!.affinity.matches.some(({ contribution }) => contribution < 0)).toBe(true);
    expect(report.scenarios.find(({ id }) => id === "avoid")!.base.find(({ id }) => id === 7)!.contributions.avoided).toBe(-6);
  });

  it("reports overlapping exclusions, missing metadata, empty history and stable ties", () => {
    const trace = diagnoseRecommendation(input.catalogue, [], { ...neutral, requiredCountries: ["ES", "JP"],
      requiredLanguages: ["es", "ja"], maxMinutes: 105 }, new Set([2, 7]));
    expect(trace.exclusions.find(({ id }) => id === 2)?.causes).toEqual({ seen: true, country: false, language: false, duration: false, recent: true });
    expect(trace.exclusions.find(({ id }) => id === 13)?.causes).toEqual({ seen: false, country: true, language: true, duration: true, recent: false });
    expect(trace.base.map(({ id }) => id)).toEqual(expect.arrayContaining([8, 15, 16, 17]));
    const films = [13, 16].map((id) => ({ ...input.catalogue.find((film) => film.id === id)!, metadata: { genres: [], directors: [], countries: [], keywords: [] } })).reverse();
    const noSignals = diagnoseRecommendation(films, [], neutral, new Set());
    expect(noSignals.base.map(({ id, score }) => [id, score])).toEqual([[13, 0], [16, 0]]);
    expect(noSignals.result.films.map(({ id }) => id)).toEqual([13, 16]);
    expect(diagnoseRecommendation(films, [], neutral, new Set([13, 16])).result.status).toBe("exhausted");
    expect(diagnoseRecommendation(films, [], { ...neutral, requiredCountries: ["JP"], requiredLanguages: ["es"] }, new Set()).result.status).toBe("no-match");
    expect(diagnoseRecommendation(films.map((film) => ({ ...film, status: "seen" })), [], neutral, new Set()).result.status).toBe("empty");
  });

  it("holds out all signals by identity, preserves decimals and reports the actual five positions", () => {
    const { training, candidates } = holdoutInputs(input.catalogue, signals, new Set([2]));
    expect(training.some(({ film }) => film.id === 2)).toBe(false);
    expect(candidates.find(({ id }) => id === 2)?.status).toBe("unknown");
    const report = createReport(input);
    expect(report.holdout.targets).toBe(5);
    const fold = report.holdout.folds.find(({ targets }) => targets.some(({ id }) => id === 2))!;
    expect(fold.trainingSignals).toBe(6);
    expect(fold.targets[0]).toEqual(expect.objectContaining({ numeric: [8.5], mean: 8.5, baseRank: expect.any(Number) }));
    expect(fold.targets[0].selectedRank).toBe(fold.selected.includes(2) ? fold.selected.indexOf(2) + 1 : null);
    expect(createReport({ ...input, signals: [] }).holdout).toMatchObject({ targets: 0, recallAt5: null, ndcgAt5: null });
  });

  it("computes binary Recall@5 and NDCG@5 at the actual selection position", () => {
    const report = createReport({
      catalogue: [1, 2].map((id) => ({ id, title: String(id), year: null, metadata: {}, status: id === 2 ? "seen" : "unknown" })),
      signals: [{ id: 2, ratings: [{ numeric: 8.5 }], spontaneous: true, memorable: false, rewatch: false }],
      recent: [2],
    });
    expect(report.holdout.folds[0].selected).toEqual([1, 2]);
    expect(report.holdout.recallAt5).toBe(1);
    expect(report.holdout.ndcgAt5).toBe(1 / Math.log2(3));
  });

  it("generates deterministic offline HTML/JSON and identifies score, selection and metric changes", () => {
    const report = createReport(input);
    const serialized = JSON.stringify(report);
    expect(JSON.stringify(createReport(fixture))).toBe(serialized);
    expect(renderReport(report)).toBe(renderReport(createReport(fixture)));
    const injected = createReport({ ...input, catalogue: input.catalogue.map((film) => ({ ...film, title: "<script>alert(1)</script>" })) });
    expect(renderReport(injected)).not.toContain("<script>");
    const comparison = compareReports(JSON.parse(serialized), report);
    expect(comparison.scenarios.every(({ changes }) => !changes.length)).toBe(true);
    const changed = structuredClone(report);
    changed.scenarios[0].base[0].score += 1;
    changed.scenarios[0].steps[0].ranking.reverse();
    changed.scenarios[0].result.films.reverse();
    changed.holdout.recallAt5 = 0;
    const delta = compareReports(report, changed);
    expect(delta.scenarios[0].changes).not.toHaveLength(0);
    expect(delta.scenarios[0].selection.before).not.toEqual(delta.scenarios[0].selection.after);
    expect(delta.holdout.after.recallAt5).toBe(0);
    expect(() => compareReports(report, createReport({ ...input, recent: [] }))).toThrow("Comparaison impossible");
  });

  it("reads SQLite including uncheckpointed WAL and leaves files, ratings and history untouched", async () => {
    const directory = await mkdtemp(join(tmpdir(), "after-dark-diagnostic-test-"));
    const path = join(directory, "fixture.sqlite");
    const { db, close } = await openDatabase(path, "drizzle");
    try {
      await db.insert(movies).values({ id: 1, displayTitle: "Film fictif", metadata: { genres: ["Drama"] } });
      await db.insert(movieEvaluations).values({ movieId: 1, kind: "historical_range", rangeMin: "8", rangeMax: "9", sourceId: "fixture:range", source: "import" });
      await db.insert(favorites).values({ movieId: 1, spontaneous: true, source: "import" });
      await db.insert(moodSessions).values({ id: 1, date: "2024-01-01", criteria: { ...neutral, constraints: [], surpriseMe: true } });
      await db.insert(recommendationHistory).values({ moodSessionId: 1, movieId: 1, rank: 1, engineVersion: "1.1.0" });
      const files = async () => Promise.all((await readdir(directory)).sort().map(async (name) => [name, await readFile(join(directory, name))]));
      const before = await files();
      expect(before.some(([name]) => name === "fixture.sqlite-wal")).toBe(true);
      const snapshot = await readLocalDatabase(path);
      expect(snapshot).toMatchObject({ catalogue: [{ id: 1, status: "seen" }], recent: [1],
        signals: [{ id: 1, spontaneous: true, ratings: [{ numeric: 8.5 }] }] });
      expect(await files()).toEqual(before);
    } finally {
      close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
