import { describe, expect, it } from "vitest";
import fixture from "../docs/engine-diagnostics/fixture.json";
import { compareAffinityModels, createReport } from "../src/diagnostics/report";
import { affinityDetails, affinityModels, buildAffinity, catalogueFrequency, rarityWeight } from "../src/domain/affinity";
import { holdoutInputs, type Film, type Signal } from "../src/domain/recommendation";

const film = (id: number, metadata: Partial<Film["metadata"]> = {}): Film => ({
  id, title: String(id), year: null, metadata: { directors: [], genres: [], countries: [], keywords: [], ...metadata },
});
const vote = (source: Film, ...numeric: number[]): Signal => ({
  film: source, ratings: numeric.map((value) => ({ numeric: value })), spontaneous: false, memorable: false, rewatch: false,
});
const date = "2026-11-23";

describe("affinity experiments", () => {
  it("reduces the benefit of many generic keywords, keeping a sparse relevant match", () => {
    const generic = Array.from({ length: 12 }, (_, i) => "mot " + i);
    const director = { directors: ["Mina Ocre"] };
    const source = film(1, { ...director, keywords: generic });
    const sparse = film(2, director);
    const verbose = film(3, { keywords: generic });
    const catalogue = [source, sparse, verbose, ...Array.from({ length: 20 }, (_, i) => film(i + 4, { keywords: generic }))];
    const frequency = catalogueFrequency(catalogue);
    const traits = buildAffinity([vote(source, 10)], undefined, true);
    expect(affinityDetails(verbose, traits).score).toBe(4);
    expect(affinityDetails(verbose, traits, "normalized").raw).toBeCloseTo(4.2);
    expect(affinityDetails(sparse, traits, "normalized").score).toBe(1.25);
    expect(affinityDetails(sparse, traits, "hybrid", frequency).score)
      .toBeGreaterThan(affinityDetails(verbose, traits, "hybrid", frequency).score);
    expect(rarityWeight(100, 1)).toBeLessThan(rarityWeight(100, 4));
    expect(rarityWeight(100, 99)).toBeLessThan(rarityWeight(100, 4));
    expect(rarityWeight(100, 0)).toBe(0);
  });

  it("accounts for unmatched tags and never invents a match from missing metadata", () => {
    const sparse = film(1, { keywords: ["silence"] });
    const verbose = film(2, { keywords: ["silence", "silence", ...Array.from({ length: 11 }, (_, i) => "autre " + i)] });
    const traits = buildAffinity([vote(sparse, 10)], undefined, true);
    const result = affinityDetails(verbose, traits, "normalized");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ normalization: 0.5, signalCount: 1 });
    expect(result.score).toBe(affinityDetails(sparse, traits, "normalized").score / 2);
    for (const model of affinityModels) {
      expect(affinityDetails(film(3), traits, model).score).toBe(0);
      expect(affinityDetails(sparse, buildAffinity([]), model).score).toBe(0);
    }
  });

  it("attenuates an isolated negative while preserving coherent negatives and conflicting evidence", () => {
    const subject = film(1, { genres: ["Drama"], directors: ["Mina Ocre"] });
    const other = film(2, { genres: ["Drama"] });
    const another = film(3, { genres: ["Drama"] });
    const score = (...signals: Signal[]) => affinityDetails(other, buildAffinity(signals, undefined, true), "normalized");
    expect(score(vote(subject, 0)).raw).toBeCloseTo(-1 / 6);
    expect(score(vote(subject, 0), vote(other, 0), vote(another, 0)).raw).toBeCloseTo(-0.45);
    expect(score(vote(subject, 0), vote(other, 10)).raw).toBe(0);
    expect(affinityDetails(film(4, { directors: ["Mina Ocre"], genres: ["Comedy"] }),
      buildAffinity([vote(subject, 10)]), "normalized").matches).toEqual([
      expect.objectContaining({ id: "director:mina ocre", signalCount: 1, contribution: 1.25 }),
    ]);
  });

  it("keeps the 8.5, 0 and favorite votes and drops all held-out personal evidence", () => {
    const source = film(1, { genres: ["Drama"] });
    const candidate = film(2, { genres: ["Drama"] });
    const mixed = { ...vote(source, 8.5, 0), ratings: [{ numeric: 8.5 }, { numeric: 0 }, { qualitative: "commentaire arbitraire" }] };
    const favorite = { ...vote(candidate), spontaneous: true };
    const traits = buildAffinity([mixed, favorite]);
    expect(traits.get("genre:drama")).toEqual({ sum: (0.625 - 1) / 2 + 0.45, count: 2 });
    const { candidates, training } = holdoutInputs([source, candidate], [mixed, favorite], new Set([1]));
    expect(buildAffinity(training).get("genre:drama")).toEqual({ sum: 0.45, count: 1 });
    expect(catalogueFrequency(candidates).counts.get("genre:drama")).toBe(2);
    expect(mixed.ratings[0].numeric).toBe(8.5);
  });

  it("replays all scenarios on the same candidates and holdout folds, with exact baseline scores", () => {
    const comparison = compareAffinityModels(fixture, date);
    expect(compareAffinityModels(fixture, date)).toEqual(comparison);
    const current = createReport(fixture, { referenceDate: date });
    expect(comparison.models[0].holdout).toEqual(current.holdout);
    expect(comparison.models[0].runs.map(({ ranking }) => ranking.map(({ id, score }) => [id, score])))
      .toEqual(current.scenarios.map(({ base }) => base.map(({ id, score }) => [id, score])));
    for (const variant of [...comparison.models, ...comparison.baselines]) {
      expect(variant.holdout.folds.map(({ targets }) => targets.map(({ id, numeric }) => [id, numeric])))
        .toEqual(current.holdout.folds.map(({ targets }) => targets.map(({ id, numeric }) => [id, numeric])));
    }
    const hybrid = createReport(fixture, { referenceDate: date, affinityModel: "hybrid" });
    expect(hybrid.fingerprint).toBe(current.fingerprint);
    expect(hybrid.scenarios.map(({ exclusions }) => exclusions)).toEqual(current.scenarios.map(({ exclusions }) => exclusions));
    expect(hybrid.holdout).toEqual(comparison.models[3].holdout);
    for (const { affinity } of hybrid.scenarios.flatMap(({ base }) => base)) {
      expect(affinity.raw).toBe(affinity.matches.reduce((sum, { contribution }) => sum + contribution, 0));
    }
  });
});
