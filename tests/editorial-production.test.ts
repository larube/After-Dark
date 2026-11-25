import { compareEditorialProduction } from "../src/diagnostics/editorial";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { affinityModels } from "../src/domain/affinity";
import { assignLabFilms, rankLabModels } from "../src/domain/lab";
import { diagnoseRecommendation, tonightAffinityModel, tonightRanking, type Film } from "../src/domain/recommendation";
import { metadataSchema, selectionCategories, selectionSize, type Criteria, type SelectionCategory } from "../src/shared/recommendation";

const date = "2026-11-25";
const genre = ["Comedy", "Thriller", "Drama", "Horror", "Science Fiction", "Fantasy"];
const catalogue: Film[] = Array.from({ length: 108 }, (_, index) => ({
  id: index + 1, title: `Fiction ${index + 1}`, year: index % 11 === 0 ? 1954 : 1970 + index % 54,
  ...(index % 13 === 0 ? { status: "seen" as const } : {}),
  ...(index % 17 === 0 ? { dismissed: true } : {}),
  metadata: metadataSchema.parse({
    genres: [genre[index % genre.length], genre[(index + 1) % genre.length]], directors: [`Cinéma ${index % 11}`],
    keywords: [`Trait ${index % 5}`], minutes: 82 + index % 38, countries: [index % 2 ? "FR" : "US"],
    language: index % 2 ? "fr" : "en", popularity: index % 31,
    reputation: { source: "TMDB", average: 7.4 + index % 10 / 10, count: 55 + index * 6 },
    ...(index === 42 ? { release: { source: "TMDB", primaryDate: "2050-01-01" } } : {}),
  }),
}));
const signals = catalogue.slice(0, 18).map((film, index) => ({
  film, ratings: [{ numeric: index % 5 ? 9 : 4.5 }], spontaneous: index % 2 === 0, memorable: false, rewatch: false,
}));
const recent = new Set([19, 20, 26, 31]);
const policy = { referenceDate: date, excludedIds: new Set([22, 25, 40]) };
const criteria: Criteria = { mood: "surprise", preferredCountries: ["FR"], preferredLanguages: ["fr"], requiredCountries: [], requiredLanguages: [] };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const selectionTrace = (selectionCategory: SelectionCategory, filters: Partial<Criteria>) =>
  diagnoseRecommendation(catalogue, signals, { ...criteria, ...filters, selectionCategory }, recent,
    policy, tonightAffinityModel, tonightRanking, undefined, selectionSize);
const constrained = { requiredCountries: ["FR"], requiredLanguages: ["fr"], maxMinutes: 104 };

it("préserve les résultats, scores, contributions et étapes du moteur 4b3231a hors catégories éditoriales", () => {
  const traces = (Object.keys(selectionCategories) as SelectionCategory[]).filter((id) => id !== "classics" && id !== "gems")
    .map((category) => [category, selectionTrace(category, {}), selectionTrace(category, constrained)]);
  expect(digest(traces)).toBe("ee96e153d43fd42a119eda7d6d5123febb50f29a6f32411b7cd9bbf9b106125c");
});

it("préserve le classement des quatre modèles et les propositions du Laboratoire de 4b3231a", () => {
  const input = { ...criteria, ...constrained, mood: "tension" as const };
  const selections = rankLabModels(catalogue, signals, input, recent, date, policy.excludedIds);
  const traces = affinityModels.map((model) => diagnoseRecommendation(catalogue, signals, input, recent,
    { ...policy, mode: "classic" }, model, "legacy"));
  expect(digest(traces)).toBe("73f8f6fc42f0afa4424d1ba9e344e57b20941a8140bea359c6e69f60f75424af");
  expect(digest({ selections, blind: assignLabFilms(selections, new Set([21]), "fixture-pr28") }))
    .toBe("9ba85c2f054922b6966413693c443138f9ef116077deb95e5ccc7456bc684b1a");
});

it("exécute les politiques de production et leur rejeu historique sur les mêmes entrées", () => {
  const snapshot = { catalogue, signals, excludedIds: policy.excludedIds, round: 0, recent, movies: [] };
  const { report, markdown } = compareEditorialProduction(snapshot, criteria, date, [...recent]);
  expect(report.categories.every(({ matchesExperiment }) => matchesExperiment)).toBe(true);
  expect(report.before.engineVersion).toBe("1.5.0");
  expect(report.after.engineVersion).toBe("1.6.0");
  for (const { category, production } of report.categories) {
    const trace = selectionTrace(category, {});
    expect(production.selected.map(({ id }) => id)).toEqual(trace.result.films.map(({ id }) => id));
    expect(production.selected.every(({ id }) => !trace.exclusions.find((row) => row.id === id)!.excluded)).toBe(true);
    expect(trace.exclusions.find(({ id }) => id === 43)?.causes.content).toBe(true);
    expect(trace.exclusions.find(({ id }) => id === 22)?.causes.blocked).toBe(true);
    expect(trace.exclusions.find(({ id }) => id === 1)?.causes.seen).toBe(true);
    expect(trace.exclusions.find(({ id }) => id === 18)?.causes.dismissed).toBe(true);
    expect(trace.exclusions.find(({ id }) => id === 19)?.causes.recent).toBe(true);
    expect(selectionTrace(category, constrained).result.films.every(({ metadata }) =>
      metadata.countries.includes("FR") && metadata.language === "fr" && metadata.minutes! <= 104)).toBe(true);
  }
  expect(markdown).toContain("Variante PR27 reproduite");
});
