import { describe, expect, it } from "vitest";
import { diagnoseRecommendation, type Film } from "../src/domain/recommendation";
import { matchesSelectionGenre, selectionGenreExclusions } from "../src/domain/selection-category";
import { metadataSchema, type Criteria } from "../src/shared/recommendation";

const base: Criteria = { mood: "surprise", preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [] };
const date = "2026-11-27";
function film(id: number, title: string, genres: string[], keywords: string[] = []): Film {
  return { id, title, year: 2001, metadata: metadataSchema.parse({ genres, keywords, minutes: 102,
    reputation: { source: "TMDB", average: 8.4, count: 400 } }) };
}

describe("politique éditoriale Horreur et Thriller", () => {
  // TMDB identifiers and a subset of the verified genres and keywords. Ratings and runtime are synthetic.
  it.each([
    [13151, "Scooby-Doo ! Sur l’île aux zombies", ["Animation", "Familial", "Mystère", "Horreur"], ["cartoon", "cartoon dog", "zombie"], false, false],
    [721656, "Joyeux Halloween, Scooby-Doo !", ["Animation", "Familial", "Mystère", "Comédie", "Horreur"], ["talking dog", "halloween"], false, false],
    [310131, "The Witch", ["Horreur", "Fantastique", "Mystère"], ["folk horror"], true, false],
    [765, "Evil Dead 2", ["Horreur", "Comédie", "Fantastique"], ["splatter horror"], true, false],
    [10494, "Perfect Blue", ["Animation", "Thriller"], ["psychological thriller", "adult animation", "psychological horror"], false, true],
    [146233, "Prisoners", ["Drame", "Thriller", "Crime"], ["psychological thriller"], false, true],
    [36095, "Cure", ["Horreur", "Mystère", "Crime"], ["psychological thriller", "psychological horror"], true, true],
    [15999, "Vampire Hunter D: Bloodlust", ["Animation", "Fantastique", "Horreur"], ["gore", "adult animation"], true, false],
    [587092, "Unicorn Wars", ["Action", "Animation", "Fantastique", "Horreur", "Guerre"], ["adult animation", "gore", "psychological thriller"], true, false],
  ] as const)("%s %s suit les indices vérifiés", (id, title, genres, keywords, horror, thriller) => {
    const candidate = film(id, title, [...genres], [...keywords]);
    expect(matchesSelectionGenre(candidate, "horror")).toBe(horror);
    expect(matchesSelectionGenre(candidate, "thriller")).toBe(thriller);
  });

  it("conserve les fiches ambiguës et les animations adultes sans preuve jeunesse concordante", () => {
    const candidates = [
      film(1, "Animation sans mots-clés", ["Animation", "Horreur"]),
      film(2, "Familial sans mots-clés", ["Horreur", "Familial"]),
      film(3, "Incohérence explicite", ["Animation", "Horror", "Family"], ["cartoon", "adult animation"]),
      film(4, "Famille seule", ["Horror", "Family"], ["friendship", "family"]),
      film(5, "Chien parlant sans indication de public", ["Horreur"], ["talking dog"]),
    ];
    expect(candidates.every((candidate) => matchesSelectionGenre(candidate, "horror"))).toBe(true);
    expect(matchesSelectionGenre(film(6, "Métadonnées absentes", []), "horror")).toBe(false);
    expect(matchesSelectionGenre(film(7, "Crime seul", ["Crime"], ["investigation"]), "thriller")).toBe(false);
    expect(matchesSelectionGenre(film(8, "Mot-clé seul", [], ["psychological thriller"]), "thriller")).toBe(false);
  });

  it("combine genres TMDB et mots-clés bruts, tout en préservant la rotation, les exclusions et les autres catégories", () => {
    const family = film(1, "Tout public", ["Horreur", "Comédie"]);
    family.metadata.release = { source: "TMDB", genres: [{ id: 10751, name: "Familial" }], keywords: [{ name: "Cartoon Dog" }] };
    const hybrid = film(2, "Thriller horrifique", ["Mystère", "Horreur"], ["psychological thriller"]);
    const catalogue = [family, hybrid, { ...film(3, "Vu", ["Horreur"]), status: "seen" as const },
      { ...film(4, "Refusé", ["Horreur"]), dismissed: true }, film(5, "Franchise bloquée", ["Horreur"]), film(6, "Récent", ["Horreur"])];
    const run = (selectionCategory: Criteria["selectionCategory"], genreTagsOnly = false) =>
      diagnoseRecommendation(catalogue, [], { ...base, selectionCategory }, new Set([6]),
        { referenceDate: date, excludedIds: new Set([5]), genreTagsOnly });
    expect(selectionGenreExclusions(family, "horror")).toEqual({ genre: false, familyHorror: true });
    expect(run("horror").result.films.map(({ id }) => id)).toEqual([2]);
    expect(run("horror", true).result.films.map(({ id }) => id)).toContain(1);
    expect(run("thriller").result.films.map(({ id }) => id)).toEqual([2]);
    for (const category of ["personal", "comedy", "classics", "gems", "drama", "scifi"] as const) {
      expect(run(category)).toEqual(run(category, true));
    }
  });
});
