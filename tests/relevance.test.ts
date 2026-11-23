import { describe, expect, it } from "vitest";
import { createReport, compareReports, parseInput, scenarios } from "../src/diagnostics/report";
import { diagnoseRecommendation, recommend } from "../src/domain/recommendation";
import { tonightDefaults } from "../src/domain/tonight-preferences";
import periodFixture from "../docs/engine-diagnostics/period-fixture.json";
import fixture from "../docs/engine-diagnostics/relevance-fixture.json";

const { catalogue, signals: storedSignals } = parseInput(fixture);
const signals = storedSignals.map(({ id, ...signal }) => ({ ...signal, film: catalogue.find((film) => film.id === id)! }));
const policy = { referenceDate: "2026-11-23", mode: "classic" } as const;
const criteria = scenarios[0].criteria;
const recent = new Set<number>();
const ids = ({ films }: ReturnType<typeof recommend>) => films.map(({ id }) => id);

describe("classement par pertinence", () => {
  it("préfère le classique étayé à la rareté seule et propose moins de cinq films", () => {
    const updatedEra = catalogue.map((film) => film.id === 1 ? { ...film, year: 1973 } : film);
    expect(ids(recommend(catalogue, [], criteria, recent, policy, "current", "legacy"))[0]).toBe(3);
    expect(ids(recommend(updatedEra, [], criteria, recent, policy))).toEqual([1]);
  });

  it("fait passer le film de niche devant le classique avec des signaux convergents", () => {
    const trace = diagnoseRecommendation(catalogue, signals, criteria, recent, policy);
    expect(ids(trace.result)).toEqual([2]);
    expect(trace.base.find(({ id }) => id === 2)?.contributions.affinity).toBeCloseTo(2.8);
    expect(trace.base.find(({ id }) => id === 1)?.contributions.reputation).toBeCloseTo(2.727273 * 0.65, 6);
    expect(trace.steps[0].ranking.every(({ bonus }) => bonus === 0)).toBe(true);
    expect(trace.exclusions.find(({ id }) => id === 8)?.causes.seen).toBe(true);
    expect(trace.exclusions.find(({ id }) => id === 9)?.causes.dismissed).toBe(true);
  });

  it("n'invente pas de réputation et ramène un vote isolé vers la neutralité", () => {
    const trace = diagnoseRecommendation(catalogue, [], criteria, recent, policy);
    expect(trace.base.find(({ id }) => id === 5)?.score).toBe(0);
    expect(trace.base.find(({ id }) => id === 4)?.contributions.reputation).toBeCloseTo(5.25 / 51 * 0.65);
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
    expect(compareReports(before, after).scenarios[0].selection.after.map(({ id }) => id)).toEqual([2]);
  });
});

describe("préférences de programmation", () => {
  it("représente les décennies depuis 1970 en présence de plusieurs classiques à forte réputation", () => {
    const input = { ...periodFixture, signals: [] };
    const before = createReport(input, { ...policy, ranking: "relevance-initial" }).scenarios[0];
    const after = createReport(input, policy).scenarios[0];
    expect(before.decades.selected).toMatchObject({ 1940: 1, 1950: 1, 1960: 1 });
    expect(after.decades.candidates).toEqual(before.decades.candidates);
    expect(after.decades.selected).toEqual({ 1970: 1, 1980: 1, 1990: 1, 2020: 2 });
  });

  it("admet un classique très compatible et plafonne les exceptions même en cas de bons candidats anciens", () => {
    const { catalogue, signals: stored } = parseInput(periodFixture);
    const signals = stored.map(({ id, ...value }) => ({ ...value, film: catalogue.find((film) => film.id === id)! }));
    const preferred = diagnoseRecommendation(catalogue, signals, criteria, recent, policy);
    expect(ids(preferred.result).slice(0, 2)).toEqual([3, 7]);
    expect(preferred.result.films.filter(({ year }) => year && year < 1970)).toHaveLength(1);
    const duplicateEra = { ...catalogue[2], id: 12, year: 1967 };
    const trace = diagnoseRecommendation([...catalogue, duplicateEra], signals, criteria, recent, policy);
    expect(trace.exclusions.find(({ id }) => id === 12)?.causes.periodLimit).toBe(true);
    const noExceptions = createReport(periodFixture, { ...policy, preferences: {
      ...tonightDefaults, period: { ...tonightDefaults.period!, maxExceptions: 0 },
    } }).scenarios[0];
    expect(noExceptions.result.films.map(({ id }) => id)).toEqual([7, 4, 5, 6, 8]);
  });

  it("applique l’animation et la décennie comme préférences souples désactivables", () => {
    const { catalogue } = parseInput(periodFixture);
    const animated = catalogue.find(({ id }) => id === 9)!;
    const contemporary = catalogue.find(({ id }) => id === 8)!;
    const matching = { ...animated, metadata: { ...contemporary.metadata, genres: ["Animation"] } };
    expect(ids(recommend([matching, contemporary], [], criteria, recent, policy))).toEqual([8, 9]);
    expect(ids(recommend([matching], [], criteria, recent, policy))).toEqual([9]);
    const preferences = { period: null, animationPenalty: 0, repeatedDecadePenalty: 0 };
    expect(ids(recommend([matching, contemporary], [], criteria, recent, policy, "current", "relevance", preferences))).toEqual([8, 9]);
    const trace = diagnoseRecommendation([matching, contemporary], [], criteria, recent, policy);
    expect(trace.steps[1].ranking[0].decadePenalty).toBe(tonightDefaults.repeatedDecadePenalty);
    const disabled = diagnoseRecommendation([matching], [], criteria, recent, policy, "current", "relevance", preferences);
    expect(disabled.base[0].contributions.animation).toBe(0);
  });

  it("préfère l’affinité personnelle à une note communautaire maximale lors d’un duel", () => {
    const { catalogue, signals: stored } = parseInput(periodFixture);
    const signals = stored.map(({ id, ...value }) => ({ ...value, film: catalogue.find((film) => film.id === id)! }));
    const filmWithVotes = { ...catalogue[0], year: 1983 };
    const compatibleFilm = catalogue[6];
    const contenders = [filmWithVotes, compatibleFilm];
    const args = [contenders, signals, criteria, recent, policy] as const;
    expect(ids(recommend(...args, "current", "relevance-initial"))).toEqual([1, 7]);
    expect(ids(recommend(...args))).toEqual([7, 1]);
  });
});
