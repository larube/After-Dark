import { describe, expect, it } from "vitest";
import { createReport, compareReports, parseInput, scenarios } from "../src/diagnostics/report";
import { diagnoseRecommendation, recommend } from "../src/domain/recommendation";
import fixture from "../docs/engine-diagnostics/relevance-fixture.json";

const { catalogue, signals: storedSignals } = parseInput(fixture);
const signals = storedSignals.map(({ id, ...signal }) => ({ ...signal, film: catalogue.find((film) => film.id === id)! }));
const policy = { referenceDate: "2026-11-23", mode: "classic" } as const;
const criteria = scenarios[0].criteria;
const recent = new Set<number>();
const ids = ({ films }: ReturnType<typeof recommend>) => films.map(({ id }) => id);

describe("classement par pertinence", () => {
  it("préfère le classique étayé à la rareté seule et propose moins de cinq films", () => {
    const args: Parameters<typeof recommend> = [catalogue, [], criteria, recent, policy];
    expect(ids(recommend(catalogue, [], criteria, recent, policy, "current", "legacy"))[0]).toBe(3);
    expect(ids(recommend(...args))).toEqual([1]);
  });

  it("fait passer le film de niche devant le classique avec des signaux convergents", () => {
    const trace = diagnoseRecommendation(catalogue, signals, criteria, recent, policy);
    expect(ids(trace.result)).toEqual([2, 1]);
    expect(trace.base.find(({ id }) => id === 2)?.contributions.affinity).toBeCloseTo(2.8);
    expect(trace.base.find(({ id }) => id === 1)?.contributions.reputation).toBeCloseTo(2.727273, 6);
    expect(trace.steps[0].ranking.every(({ bonus }) => bonus === 0)).toBe(true);
    expect(trace.exclusions.find(({ id }) => id === 8)?.causes.seen).toBe(true);
    expect(trace.exclusions.find(({ id }) => id === 9)?.causes.dismissed).toBe(true);
  });

  it("n'invente pas de réputation et ramène un vote isolé vers la neutralité", () => {
    const trace = diagnoseRecommendation(catalogue, [], criteria, recent, policy);
    expect(trace.base.find(({ id }) => id === 5)?.score).toBe(0);
    expect(trace.base.find(({ id }) => id === 4)?.contributions.reputation).toBeCloseTo(5.25 / 51);
    expect(trace.exclusions.filter(({ causes }) => causes.weakEvidence).map(({ id }) => id)).toEqual([2, 3, 4, 5]);
    const zeroVotes = { ...catalogue[3], metadata: { ...catalogue[3].metadata, reputation: { source: "TMDB", average: 10, count: 0 } as const } };
    expect(diagnoseRecommendation([zeroVotes], [], criteria, recent, policy).base[0].score).toBe(0);
  });

  it("reproduit le résultat à catalogue identique et compare les deux politiques sur la même empreinte", () => {
    expect(recommend([...catalogue].reverse(), signals, criteria, recent, policy))
      .toEqual(recommend(catalogue, signals, criteria, recent, policy));
    const before = createReport(fixture, { ...policy, ranking: "legacy" });
    const after = createReport(fixture, policy);
    expect(after).toEqual(createReport(fixture, policy));
    expect(compareReports(before, after).scenarios[0].selection.after.map(({ id }) => id)).toEqual([2, 1]);
  });
});
