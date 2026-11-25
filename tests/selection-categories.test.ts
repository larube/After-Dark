import { auditSelection, selectionMarkdown } from "../src/diagnostics/selection";
import { describe, expect, it } from "vitest";
import { diagnoseRecommendation, recommend, tonightAffinityModel, tonightRanking, type Film, type Signal } from "../src/domain/recommendation";
import { discoveryQueries } from "../src/main/tmdb";
import { defaultFilters, readCriteria } from "../src/renderer/criteria";
import { ipc } from "../src/shared/ipc";
import { criteriaSchema, metadataSchema, selectionCategories, type SelectionCategory } from "../src/shared/recommendation";

function film(id: number, genres: string[], options: { matching?: boolean; year?: number; popularity?: number; average?: number; count?: number } = {}): Film {
  const { matching = false, year = 1995, popularity, average = 8.5, count = 300 } = options;
  return { id, title: `Film ${id}`, year, metadata: metadataSchema.parse({
    genres, popularity, minutes: 100,
    ...(matching ? { directors: ["Une cinéaste"], keywords: ["Paradoxe temporel", "Univers parallèle", "Mémoire effacée"] } : {}),
    reputation: { source: "TMDB", average, count },
  }) };
}

const policy = { referenceDate: "2026-12-01" };
const criteria = (category: SelectionCategory) => readCriteria(defaultFilters, category).data!;
const signal: Signal = { film: film(90, ["Drama"], { matching: true }), ratings: [{ numeric: 8.5 }], spontaneous: true, memorable: true, rewatch: true };
const signals = [signal, { ...signal, film: film(91, ["Drama"], { matching: true }) }];
const trace = (films: Film[], category: SelectionCategory, recent = new Set<number>(), excludedIds = new Set<number>()) =>
  diagnoseRecommendation(films, signals, criteria(category), recent, { ...policy, excludedIds }, tonightAffinityModel, tonightRanking);
const ids = (trace: ReturnType<typeof diagnoseRecommendation>) => trace.result.films.map(({ id }) => id);

describe("catégories de Sélection", () => {
  it("sérialise les huit catégories et laisse l’ancien contrat du Laboratoire lisible", () => {
    for (const key of Object.keys(selectionCategories) as SelectionCategory[]) {
      expect(ipc.recommend.request.parse([criteria(key), false])[0]).toMatchObject({ mood: "surprise", selectionCategory: key });
    }
    const old = { preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [] };
    expect(criteriaSchema.parse({ ...old, mood: "strange", avoid: "tension" })).toEqual({ ...old, mood: "strange", avoid: "tension" });
    expect(ipc.labStart.request.safeParse([{ ...old, mood: "strange" }, false]).success).toBe(true);
    expect(ipc.labStart.request.safeParse([criteria("drama"), false]).success).toBe(false);
    expect(criteriaSchema.safeParse({ ...criteria("drama"), mood: "emotion" }).success).toBe(false);
  });

  it.each([
    ["comedy", "Comédie", "35"], ["thriller", "Thriller", "53"], ["drama", "Drame", "18"],
    ["horror", "Horror", "27"], ["scifi", "Science-Fiction", "878|14"], ["scifi", "Fantasy", "878|14"],
  ] as const)("filtre %s (%s) dans le catalogue et toutes les sources TMDB", (category, name, tmdb) => {
    const candidates = [film(1, [name]), film(2, ["Crime", "Mystery"]), film(3, [])];
    expect(ids(trace(candidates, category))).toEqual([1]);
    expect(trace(candidates, category).exclusions[1].causes.genre).toBe(true);
    expect(ids(trace(candidates, category, new Set([1])))).toEqual([]);
    expect(trace(candidates, category, new Set([1])).result.status).toBe("exhausted");
    for (const query of discoveryQueries(criteria(category), 0, 2026)) expect(query.with_genres).toBe(tmdb);
  });

  it("utilise les identifiants TMDB et conserve les exclusions et l’ambiance à éviter", () => {
    const candidate = film(1, ["Crime"]);
    candidate.metadata.release = { source: "TMDB", genres: [{ id: 53, name: "Autre libellé" }] };
    const films = [candidate, { ...candidate, id: 2, status: "seen" as const },
      { ...candidate, id: 3, dismissed: true }, { ...candidate, id: 4 }];
    expect(ids(trace(films, "thriller", undefined, new Set([4])))).toEqual([1]);
    const result = diagnoseRecommendation(films, signals, { ...criteria("thriller"), avoid: "tension" }, new Set(), policy, tonightAffinityModel, tonightRanking);
    expect(result.base.find(({ id }) => id === 1)?.contributions.avoided).toBeLessThan(0);
  });

  it("garde le résultat et les requêtes de Pour moi identiques au mode surprise de production", () => {
    const legacy = criteriaSchema.parse({ ...criteria("personal"), selectionCategory: undefined });
    const films = [film(1, ["Drama"]), film(2, ["Horror"]), film(3, ["Fantasy"], { year: 2024 })];
    const recent = new Set([2]);
    expect(trace(films, "personal", recent).result).toEqual(recommend(films, signals, legacy, recent, policy, tonightAffinityModel, tonightRanking));
    expect(discoveryQueries(criteria("personal"), 0, 2026)).toEqual(discoveryQueries(legacy, 0, 2026));
  });

  it("différencie Cultes et Pépites par leurs conditions et contributions explicites", () => {
    const films = [film(1, ["Drama"], { popularity: 25 }),
      film(2, ["Drama"], { matching: true, year: 2024, popularity: 2, average: 7.6 }),
      film(3, ["Drama"], { popularity: 0.1, count: 1, average: 10 }),
      film(4, ["Drama"], { popularity: 30, average: 7.5 }), film(5, ["Drama"], { average: 7.5 }),
      film(6, ["Drama"], { popularity: 15, average: 6 })];
    const cult = trace(films, "classics");
    const gems = trace(films, "gems");
    expect(ids(cult)).toEqual([1]);
    expect(ids(gems)).toEqual([2]);
    expect(ids(trace(films, "personal"))).not.toEqual(ids(gems));
    expect(cult.base.find(({ id }) => id === 1)?.contributions.selectionCategory).toBeCloseTo(18 / 7);
    expect(gems.base.find(({ id }) => id === 2)?.contributions.selectionCategory).toBe(0.6);
    expect(gems.exclusions.find(({ id }) => id === 5)?.causes.categoryEvidence).toBe(true);
    expect(trace([...films].reverse(), "gems").result).toEqual(gems.result);
    expect(trace(films, "gems", new Set([2])).result.status).toBe("exhausted");
    expect(trace(films.slice(2, 3), "gems").result.status).toBe("no-match");
    expect(recommend(films, [], criteria("gems"), new Set(), policy, tonightAffinityModel, tonightRanking).status).toBe("no-match");
    expect(discoveryQueries(criteria("classics"), 0, 2026)[0]).toMatchObject({
      sort_by: "vote_count.desc", "vote_count.gte": "50", "primary_release_date.lte": "2016-12-31",
    });
    expect(discoveryQueries(criteria("gems"), 0, 2026)[0]).toMatchObject({
      sort_by: "popularity.asc", "vote_count.gte": "50",
    });
  });
});

describe("audit des catégories", () => {
  it("sépare rotation, admissibilité, exclusions et recoupement avec les mêmes entrées", () => {
    const candidate = film(1, ["Drama"], { matching: true, popularity: 1 });
    const catalogue = [candidate, film(2, ["Drama"], { popularity: 10 }),
      { ...candidate, id: 3, status: "seen" as const }, { ...candidate, id: 4, dismissed: true }, { ...candidate, id: 5 }];
    const snapshot = { catalogue, signals, round: 0, recent: new Set([1]), excludedIds: new Set([5]) };
    const audit = auditSelection(snapshot, criteria("personal"), policy.referenceDate);
    expect(audit).toEqual(auditSelection(snapshot, criteria("personal"), policy.referenceDate));
    expect(audit.personalParity).toBe(true);
    expect(audit.reports.map(({ category }) => category)).toEqual(Object.keys(selectionCategories));
    const drama = audit.reports.find(({ category }) => category === "drama")!;
    expect(drama.admissible.count).toBe(2);
    expect(drama.withRotation).toBe(1);
    expect(drama.selected.map(({ id }) => id)).toEqual([2]);
    expect(drama.withoutRotation.map(({ id }) => id)).toContain(1);
    expect(drama.exclusions).toEqual(expect.arrayContaining([["seen", 1], ["blocked", 1], ["dismissed", 1]]));
    expect(audit.overlaps[0][5]).toEqual({ rotated: 1, unrotated: 2 });
    expect(drama.selected[0].score - drama.selected[0].diversity).toBeCloseTo(drama.selected[0].finalScore);
    expect(selectionMarkdown(audit)).toContain("| Film 2 |");
    for (const acquisition of audit.acquisition) {
      expect(acquisition.preferred).toEqual(acquisition.neutral);
      expect(acquisition.strictMultiple).toEqual(acquisition.neutral);
      expect(acquisition.strictSingle.every((query) => query.with_original_language === "fr" && !query.with_origin_country)).toBe(true);
    }
  });

  it("identifie une Pépite écartée par la popularité manquante et un Culte écarté par la période", () => {
    const catalogue = [film(1, ["Drama"], { matching: true }), film(2, ["Drama"], { year: 1965 })];
    const audit = auditSelection({ catalogue, signals, round: 3, recent: new Set(), excludedIds: new Set() },
      criteria("personal"), policy.referenceDate);
    expect(audit.reports.find(({ category }) => category === "gems")?.nearMisses).toContainEqual(expect.objectContaining({
      title: "Film 1", failure: "popularity", popularity: null, weakEvidence: false,
    }));
    expect(audit.reports.find(({ category }) => category === "classics")?.classicConflicts).toContainEqual(expect.objectContaining({
      title: "Film 2", period: -0.8,
    }));
  });
});
