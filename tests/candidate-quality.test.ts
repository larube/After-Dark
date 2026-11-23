import { describe, expect, it } from "vitest";
import fixture from "../docs/engine-diagnostics/candidate-quality-fixture.json";
import { classifyContent } from "../src/domain/candidate-quality";
import { buildAffinity, diagnoseRecommendation, recommend } from "../src/domain/recommendation";
import { compareReports, createReport, parseInput, scenarios } from "../src/diagnostics/report";
import { metadataSchema } from "../src/shared/recommendation";

const referenceDate = "2026-11-23";
const policy = { referenceDate };
const input = parseInput(fixture);
const signals = input.signals.map(({ id, ...signal }) => ({ ...signal, film: input.catalogue.find((film) => film.id === id)! }));
const classify = (raw: unknown) => classifyContent(metadataSchema.parse(raw), referenceDate);

describe("politique de séance classique", () => {
  it.each([
    [1, "feature_film", []],
    [2, "feature_film", []],
    [3, "feature_film", []],
    [4, "feature_film", []],
    [5, "concert", ["concert"]],
    [6, "stage_performance", ["stage_performance"]],
    [7, "other_special", ["other_special"]],
    [8, "short_film", ["short_film"]],
    [9, "feature_film", ["future_release"]],
    [10, "unknown", []],
  ])("classe le film fictif %i comme %s", (id, category, exclusionReasons) => {
    const film = input.catalogue.find((film) => film.id === id)!;
    expect(classify(film.metadata)).toMatchObject({ category, exclusionReasons });
  });

  it("conserve les téléfilms ambigus et des œuvres dont les signaux se contredisent", () => {
    expect(classify({ minutes: 73, genres: ["Animation", "Téléfilm", "Family"], keywords: ["zombie"] }))
      .toMatchObject({ category: "tv_movie", certainty: "inferred", exclusionReasons: [], missing: ["releaseDate", "releaseStatus"] });
    expect(classify({ minutes: 98, keywords: ["short film"] })).toMatchObject({ category: "unknown", exclusionReasons: [] });
    expect(classify({ minutes: 89, keywords: ["filmed play", "concert film"] }))
      .toMatchObject({ category: "unknown", exclusionReasons: [] });
    expect(classify({ minutes: 40, genres: ["Documentaire"] })).toMatchObject({ category: "feature_film", exclusionReasons: [] });
  });

  it("distingue une captation et un documentaire incluant des extraits musicaux", () => {
    expect(classify({
      minutes: 197, genres: ["Musique"],
      keywords: ["concert", "musician", "celebrity", "celebration", "death of a musician", "death of friend"],
    })).toMatchObject({ category: "concert", certainty: "strong", exclusionReasons: ["concert"] });
    expect(classify({
      minutes: 118, genres: ["Musique", "Documentaire"],
      keywords: ["concert footage", "archive footage", "music documentary", "celebrity interview"],
    })).toMatchObject({ category: "feature_film", exclusionReasons: [] });
    expect(classify({ minutes: 112, genres: ["Musique"], keywords: ["concert"] })).toMatchObject({ exclusionReasons: [] });
    expect(classify({ minutes: 91, keywords: ["recorded stage performance", "tv special"] }))
      .toMatchObject({ category: "stage_performance", exclusionReasons: ["stage_performance"] });
    expect(classify({ keywords: ["concert footage"], genres: ["Music"] })).toMatchObject({ category: "unknown", exclusionReasons: [] });
  });

  it("distingue les programmes TV des films et téléfilms diffusés à la télévision", () => {
    const tv = { source: "TMDB", events: [{ type: 6, date: "2007-07-25" }, { type: 6, date: "2008-10-17" }] };
    expect(classify({ minutes: 87, genres: ["Documentaire", "Horreur"], keywords: ["investigation", "paranormal"], release: tv }))
      .toMatchObject({ category: "feature_film", exclusionReasons: [] });
    expect(classify({ minutes: 90, genres: ["TV Movie"], keywords: ["based on tv series"] }))
      .toMatchObject({ category: "tv_movie", exclusionReasons: [] });
    expect(classify({ minutes: 90, genres: ["TV Movie"], keywords: ["tv pilot"] }))
      .toMatchObject({ category: "unknown", exclusionReasons: [] });
    expect(classify({ minutes: 90, genres: ["TV Movie"], keywords: ["tv pilot"], release: tv }))
      .toMatchObject({ category: "tv_program", exclusionReasons: ["tv_program"] });
    expect(classify({ genres: ["Documentaire"], keywords: ["television miniseries"] }))
      .toMatchObject({ category: "tv_program", exclusionReasons: ["tv_program"] });
    expect(classify({ minutes: 90, keywords: ["tv episode"], release: { ...tv, events: [{ type: 3, date: "2007-07-26" }] } }))
      .toMatchObject({ category: "unknown", exclusionReasons: [] });
  });

  it("utilise les dates valides et respecte le premier événement connu", () => {
    const release = { source: "TMDB", primaryDate: "2030-02-30", status: "Post Production" };
    expect(classify({ release })).toMatchObject({ exclusionReasons: [], missing: expect.arrayContaining(["releaseDate"]) });
    expect(classify({ release: { ...release, primaryDate: "2030-03-08", status: "Released" } })).toMatchObject({
      exclusionReasons: [], evidence: expect.arrayContaining(["conflict:releasedStatusWithFutureDates"]),
    });
    expect(classify({ release: { source: "TMDB", primaryDate: "2030-03-08" } }).exclusionReasons).toEqual(["future_release"]);
    const metadata = metadataSchema.parse({ release: { ...release, primaryDate: "2030-03-08", events: [
      { country: "FR", date: "2026-11-23T00:00:00.000Z", type: 1 },
    ] } });
    expect(classifyContent(metadata, "2026-11-22").exclusionReasons).toEqual(["future_release"]);
    expect(classifyContent(metadata, referenceDate).exclusionReasons).toEqual([]);
  });

  it("partage le filtre avec la production et préserve les signaux du catalogue", () => {
    const traits = buildAffinity(signals);
    expect([...traits.keys()]).toContain("keyword:concert film");
    for (const { criteria } of scenarios) {
      const history = new Set(input.recent);
      const args = [input.catalogue, signals, criteria, history] as const;
      const trace = diagnoseRecommendation(...args, policy);
      const legacy = diagnoseRecommendation(...args, { ...policy, mode: "legacy" });
      expect(trace.result).toEqual(recommend(...args, policy));
      expect(trace.exclusions.filter(({ causes }) => causes.content).map(({ id }) => id)).toEqual([5, 6, 7, 8, 9, 11]);
      for (const row of trace.base) {
        const before = legacy.base.find(({ id }) => row.id === id);
        expect(row.contributions).toEqual(before?.contributions);
        expect(row.score).toBe(before?.score);
      }
    }
    expect(buildAffinity(signals)).toEqual(traits);
    expect(signals[0].ratings).toEqual([{ numeric: 8.5 }]);
  });

  it("compare deux politiques sur un instantané fixe et conserve le dénominateur du holdout", () => {
    const classic = createReport(fixture, { ...policy, ranking: "legacy" });
    const legacy = createReport(fixture, { ...policy, mode: "legacy" });
    expect(createReport(fixture, { ...policy, ranking: "legacy" })).toEqual(classic);
    expect(classic.scenarios[0]).toMatchObject({ eligibleBeforePolicy: 10, eligible: 5 });
    expect(classic.holdout).toMatchObject({ targets: 2, eligibleTargets: 1 });
    expect(legacy.holdout).toMatchObject({ targets: 2, eligibleTargets: 2 });
    expect(classic.holdout.folds.flatMap(({ targets }) => targets)).toContainEqual(
      expect.objectContaining({ id: 11, numeric: [8.5], exclusions: ["concert"], baseRank: null }),
    );
    expect(compareReports(legacy, classic).scenarios[0].exclusionChanges.map(({ id }) => id)).toEqual([5, 6, 7, 8, 9, 11]);
    expect(() => compareReports(legacy, createReport(fixture, { referenceDate: "2026-11-24" }))).toThrow("Comparaison impossible");
    const modified = structuredClone(fixture);
    modified.catalogue[0].metadata.minutes = 100;
    expect(() => compareReports(legacy, createReport(modified, policy))).toThrow("Comparaison impossible");
  });
});
