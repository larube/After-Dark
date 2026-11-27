import { describe, expect, it } from "vitest";
import { compositionWinner as pick } from "../src/domain/selection-composition";
import { diagnoseRecommendation, recommend, tonightAffinityModel, tonightRanking, type Film } from "../src/domain/recommendation";
import { selectionPreferences, tonightDefaults } from "../src/domain/tonight-preferences";
import { criteriaSchema, metadataSchema, recentSelectionLimit } from "../src/shared/recommendation";

const criteria = criteriaSchema.parse({ mood: "surprise", selectionCategory: "personal", preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [] });
const film = (id: number, year: number | null, countries: string[] = []): Film => ({
  id, title: String(id), year, metadata: metadataSchema.parse({
    countries, minutes: 110, reputation: { source: "TMDB", average: 8.4, count: 900 },
  }),
});
const row = (film: Film, score = 2) => ({ candidate: { film }, score });
const compositionWinner = (rows: ReturnType<typeof row>[], selected: { film: Film }[], filters: typeof criteria) =>
  pick(rows, selected, filters, tonightDefaults.repeatedDecadePenalty);
const old = [film(10, 1977), film(11, 1979)].map((film) => ({ film }));
const dutch = [film(12, 2001, ["NL"]), film(13, 2002, ["NL"])].map((film) => ({ film }));

describe("composition de Sélection", () => {
  it("privilégie un film moderne comparable à partir du troisième film ancien", () => {
    const rows = [row(film(1, 1979)), row(film(2, null), 1.9), row(film(3, 1980), 1.8)];
    expect(compositionWinner(rows, old, criteria)).toBe(2);
    expect(compositionWinner(rows, old.slice(0, 1), criteria)).toBe(0);
    expect(compositionWinner(rows.slice(0, 2), old, criteria)).toBe(0);
  });

  it("préserve un classique nettement mieux classé ou seul admissible", () => {
    const rows = [row(film(1, 1979), 3), row(film(2, 1980), 2)];
    expect(compositionWinner(rows, old, criteria)).toBe(0);
    expect(compositionWinner(rows.slice(0, 1), old, criteria)).toBe(0);
  });

  it("favorise un pays documenté différent, avec une voix répartie entre coproducteurs", () => {
    const rows = [row(film(1, 2004, ["NL"])), row(film(2, 2004), 1.99), row(film(3, 2004, ["NL", "BE"]), 1.95), row(film(4, 2004, ["BE"]), 1.9)];
    expect(compositionWinner(rows, dutch, criteria)).toBe(3);
    expect(compositionWinner(rows.slice(0, 3), dutch, criteria)).toBe(2);
    expect(compositionWinner(rows.slice(0, 2), dutch, criteria)).toBe(0);
    expect(compositionWinner(rows, [dutch[0], { film: film(5, 2003, ["NL", "BE"]) }], criteria)).toBe(2);
    expect(compositionWinner(rows, dutch, { ...criteria, preferredCountries: ["NL"] })).toBe(0);
    expect(compositionWinner(rows, dutch, { ...criteria, requiredCountries: ["NL"] })).toBe(0);
    expect(compositionWinner([rows[0], row(film(6, 1978, ["BE"]), 1.9)], dutch, criteria)).toBe(0);
    expect(compositionWinner([rows[0], row(film(7, 2005, ["BE"]), 1)], dutch, criteria)).toBe(0);
  });

  it("préserve les étapes d’admissibilité, les contraintes et la rotation", () => {
    const catalogue = Array.from({ length: 37 }, (_, index) => film(index + 1, index < 8 ? 1978 : 1999, index % 3 < 2 ? ["NL"] : ["BE"]));
    catalogue[0].status = "seen";
    catalogue[1].dismissed = true;
    const policy = { referenceDate: "2026-11-27", excludedIds: new Set([3]) };
    const run = (recent: number[], preferences = selectionPreferences, filters = criteria) =>
      diagnoseRecommendation(catalogue, [], filters, new Set(recent), policy, tonightAffinityModel, tonightRanking, preferences, 10);
    const before = run([], tonightDefaults);
    const after = run([]);
    expect(after.exclusions).toEqual(before.exclusions);
    const unselected = (trace: typeof before) => trace.base.map((row) => ({ ...row, selectedRank: null }));
    expect(unselected(after)).toEqual(unselected(before));
    expect(after.result.films.filter(({ year }) => year === 1978)).toHaveLength(2);
    expect(after.steps.some(({ composition }) => composition)).toBe(true);
    expect(recommend(catalogue, [], criteria, new Set(), policy, tonightAffinityModel, tonightRanking, selectionPreferences, 10)).toEqual(after.result);
    const ids = after.result.films.map(({ id }) => id);
    expect(ids.every((id) => id > 3)).toBe(true);
    const next = run(ids).result.films.map(({ id }) => id);
    const third = run([...next, ...ids].slice(0, recentSelectionLimit));
    expect(next).toHaveLength(10);
    expect(next.some((id) => ids.includes(id))).toBe(false);
    expect(third.result.films.some(({ id }) => [...ids, ...next].includes(id))).toBe(false);
    expect(run(catalogue.slice(0, -4).map(({ id }) => id)).result.films).toHaveLength(4);
    const required = run([], selectionPreferences, { ...criteria, requiredCountries: ["NL"] });
    expect(required.result.films).toHaveLength(10);
    expect(required.result.films.every(({ metadata }) => metadata.countries.includes("NL"))).toBe(true);
  });

  it("laisse compléter une sélection quand le vivier est dominé par les classiques ou un seul pays", () => {
    const catalogue = Array.from({ length: 10 }, (_, index) => film(index + 1, 1978, ["NL"]));
    expect(recommend(catalogue, [], criteria, new Set(), { referenceDate: "2026-11-27" },
      tonightAffinityModel, tonightRanking, selectionPreferences, 10).films).toHaveLength(10);
  });
});
