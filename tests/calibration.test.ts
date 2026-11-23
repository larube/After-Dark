import { expect, it } from "vitest";
import { compareCalibration } from "../src/diagnostics/calibration";
import { buildAffinity, catalogueFrequency } from "../src/domain/affinity";
import { calibratedContributions, productionPreferences } from "../src/domain/discovery-calibration";
import { inspectDiscoveryRanking } from "../src/domain/discovery";
import type { Film, Signal } from "../src/domain/recommendation";
import { calibrationFixture } from "./fixtures/calibration";

function film(id: number, metadata: Partial<Film["metadata"]> = {}, year: number | null = null): Film {
  return { id, title: `Film ${id}`, year, metadata: { countries: [], directors: [], genres: [], keywords: [], ...metadata } };
}

function signal(film: Film, numeric: number): Signal {
  return { film, ratings: [{ numeric }], spontaneous: false, memorable: false, rewatch: false };
}

const input = {
  ...calibrationFixture, seed: "calibration-1", preferences: { lessIndianCinema: true, preferFrUs1960To1979: true },
};

it("separates saturated upper ranks without touching eligibility or the current baseline", () => {
  const report = compareCalibration(input);
  const [a, b, c, d] = report.comparison.map(({ modes }) => modes.find(({ mode }) => mode === "affinities")!);
  expect(a.selection.saturatedFit).toBe(8);
  expect(a.selection.saturatedEvidence).toBe(8);
  expect(a.selection.raw.distinct).toBeGreaterThan(1);
  expect(a.selection.score.distinct).toBe(1);
  expect(c.selection.saturatedFit).toBe(0);
  expect(c.selection.score.distinct).toBeGreaterThan(1);
  expect(c.candidates.familyShares.keyword).toBeLessThan(a.candidates.familyShares.keyword!);
  expect(c.candidates.size).toBe(a.candidates.size);
  for (const run of [a, b, c, d]) expect(run.ids.every((id) => ![3, 38, 39, 40, 41, 42].includes(id))).toBe(true);
  expect(d.selection.indian).toBeLessThan(c.selection.indian);
  expect(d.selection.other1960To1979).toBe(1);
  expect(c.selection.other1960To1979).toBeGreaterThan(1);
  expect(report.comparison.map(({ holdout }) => holdout.targets)).toEqual([13, 13, 13, 13]);
  expect(compareCalibration(input)).toEqual(report);
});

it("discounts ubiquitous terms, averages a family, and preserves negative contributions and fractional notes", () => {
  const dense = film(1, { keywords: ["common", "rare", "unknown", "RARE"], genres: ["Drama"] });
  const sparse = film(2, { keywords: ["common", "rare"], genres: ["Drama"] });
  const negative = film(3, { keywords: ["common"], genres: ["Drama"] });
  const blank = film(4, { keywords: ["common"] });
  const positive = film(5, { keywords: ["common", "rare"] });
  const signals = [signal(positive, 8.5), signal(negative, 0)];
  const traits = buildAffinity(signals);
  const frequency = catalogueFrequency([dense, sparse, negative, blank, positive]);
  const detailed = calibratedContributions(dense, traits, frequency);
  const byLabel = Object.fromEntries(detailed.map(({ label, contribution }) => [label.toLowerCase(), contribution]));
  expect(byLabel.common).toBeCloseTo(0);
  expect(byLabel.rare).toBeCloseTo(1.4 * .625 / 3 * .4 / 3);
  expect(byLabel.drama).toBeLessThan(0);
  expect(calibratedContributions(sparse, traits, frequency).find(({ label }) => label === "rare")!.contribution)
    .toBeGreaterThan(byLabel.rare);
  expect(calibratedContributions(film(9), traits, frequency)).toEqual([]);
  expect(signals.map(({ ratings }) => ratings[0].numeric)).toEqual([8.5, 0]);
});

it("keeps negative keywords outside the current model's three-keyword budget", () => {
  const candidate = film(1, { keywords: ["a", "b", "c", "critique"] });
  const liked = film(2, { keywords: ["a", "b", "c"] });
  const disliked = film(3, { keywords: ["critique"] });
  const stronger = [signal(liked, 10), signal(film(4, liked.metadata), 10), signal(disliked, 0)];
  const rank = (calibrated: boolean) => inspectDiscoveryRanking([candidate, liked, disliked], stronger,
    new Set(), "affinities", { previous: [], adjacent: [] }, "negative", input.date, { calibrated }).ranked[0];
  expect(rank(false).omittedNegative).toBe(1);
  expect(rank(true).contributions.find(({ label }) => label === "critique")!.contribution).toBeLessThan(0);
});

it("uses production countries only and respects the inclusive decade bounds", () => {
  expect(productionPreferences(film(1, { countries: ["IN", "FR"] }, 1960))).toEqual({ indian: true, other1960To1979: false });
  expect(productionPreferences(film(1, { countries: ["JP", "US"] }, 1979)).other1960To1979).toBe(false);
  expect(productionPreferences(film(1, { countries: ["JP"] }, 1979)).other1960To1979).toBe(true);
  expect(productionPreferences(film(1, { countries: ["JP"] }, 1980)).other1960To1979).toBe(false);
  expect(productionPreferences(film(1, { countries: ["JP"] }, 1959)).other1960To1979).toBe(false);
  expect(productionPreferences(film(1, { language: "hi" }, 1970))).toEqual({ indian: false, other1960To1979: false });
  expect(productionPreferences(film(1, { countries: ["JP"] })).other1960To1979).toBe(false);
});

it("allows highly relevant exceptions even after the period target is reached", () => {
  const candidates = [film(1, { countries: ["IN"], directors: ["Spécifique"] }, 1970),
    film(2, { countries: ["JP"], directors: ["Spécifique"] }, 1969),
    film(3, { countries: ["FR"], genres: ["Modeste"] }, 1970),
    film(4, { countries: ["IN"], genres: ["Modeste"] }, 2000)];
  const training = Array.from({ length: 8 }, (_, i) => signal(film(10 + i, { directors: ["Spécifique"] }), 10));
  training.push(signal(film(20, { genres: ["Modeste"] }), 8.5));
  const { selected } = inspectDiscoveryRanking(candidates, training, new Set(), "affinities",
    { previous: [], adjacent: [] }, "exception", input.date, input.preferences);
  expect(selected.slice(0, 2).map(({ film }) => film.id).sort()).toEqual([1, 2]);
  expect(selected[1].decision.explicitPenalty).toBeGreaterThan(0);
  expect(selected.slice(2).map(({ film }) => film.id)).toEqual([3, 4]);
});
