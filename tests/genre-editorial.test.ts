import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/client";
import { writeGenreEditorialAudit } from "../src/diagnostics/genre-editorial";
import { importProfile } from "../src/import/profile";
import { acquisitionPlan } from "../src/main/acquisition-plan";
import { discoveryQueries } from "../src/main/tmdb";
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

  it("distingue horreur pour enfants, fantastique familial ambigu et horreur expérimentale", () => {
    const cases = [
      [14836, "Coraline", ["Animation", "Familial", "Fantastique", "Horreur"], ["horror for children", "dark fantasy"], false],
      [1119090, "Frankelda, c’est moi", ["Animation", "Familial", "Fantastique", "Horreur"], ["gothic horror", "supernatural horror"], true],
      [14282, "Ninja Scroll", ["Animation", "Action", "Fantastique", "Horreur"], ["demon", "dark fantasy"], true],
      [19035, "Možnosti dialogu", ["Animation", "Horreur", "Comédie"], ["surrealism", "grotesque imagery"], true],
    ] as const;
    for (const [id, title, genres, keywords, allowed] of cases) {
      expect(matchesSelectionGenre(film(id, title, [...genres], [...keywords]), "horror")).toBe(allowed);
    }
  });

  it("laisse Discover Thriller ciblé sur le genre 53 même si le catalogue local admet un hybride", () => {
    const input = { ...base, selectionCategory: "thriller" as const, preferredCountries: ["JP"] };
    const hybrid = film(36095, "Cure", ["Horreur", "Crime", "Mystère"], ["psychological thriller"]);
    expect(matchesSelectionGenre(hybrid, "thriller")).toBe(true);
    expect(matchesSelectionGenre(hybrid, "thriller", true)).toBe(false);
    const plan = acquisitionPlan(input, { directors: [123], keywords: [456] }, 0, 2026);
    expect([...discoveryQueries(input, 0, 2026), ...[...plan.initial, ...plan.reserve].map(({ parameters }) => parameters)]
      .every(({ with_genres }) => with_genres === "53")).toBe(true);
  });

  it("exporte les preuves des animations retirées, maintenues et déjà exclues", async () => {
    const directory = await mkdtemp(join(tmpdir(), "after-dark-genre-review-"));
    const sqlite = join(directory, "test.sqlite");
    try {
      const { db, close } = await openDatabase(sqlite, "drizzle");
      try {
        const entries = [
          film(1, "Fiction jeunesse", ["Animation", "Horreur", "Familial"], ["horror for children"]),
          film(2, "Fiction expérimentale", ["Animation", "Horreur"], ["surrealism"]),
          { ...film(3, "Fiction adulte", ["Animation", "Horreur"], ["adult animation"]), status: "seen" as const },
        ];
        await importProfile(db, { version: 1, entries: entries.map(({ id, title, year, metadata, status }) => ({
          movie: { canonicalId: "test:" + id, displayTitle: title, year, metadata }, status,
        })) });
      } finally {
        close();
      }
      await writeGenreEditorialAudit({ sqlite, date, output: directory });
      const report = JSON.parse(await readFile(join(directory, "genre-editorial.json"), "utf8"));
      const { animationEvidence } = report.categories[0];
      expect(animationEvidence).toMatchObject([
        { title: "Fiction jeunesse", keywords: ["horror for children"], before: { available: true, selections: [1] },
          after: { admissible: false, causes: ["familyHorror"] } },
        { title: "Fiction expérimentale", after: { admissible: true, selections: [1], reasons: expect.any(Array) } },
        { title: "Fiction adulte", before: { admissible: false, causes: ["seen"] }, after: { causes: ["seen"] } },
      ]);
      expect(await readFile(join(directory, "genre-editorial.md"), "utf8")).toContain("with_genres=53");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
