import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client";
import { saveFeedback } from "../src/db/feedback";
import { setFranchisePreference } from "../src/db/franchises";
import { cacheFilm, readCatalogue, readHistory } from "../src/db/recommendations";
import { acquisitionMarkdown, compareAcquisition } from "../src/diagnostics/acquisition";
import { acquisitionProfile } from "../src/domain/acquisition-profile";
import { recommend, tonightAffinityModel, tonightRanking, type Film, type Signal } from "../src/domain/recommendation";
import { finishBlindAcquisition, prepareBlindAcquisition } from "../src/diagnostics/acquisition-blind";
import { acquireTonight } from "../src/main/acquire";
import { acquisitionPlan } from "../src/main/acquisition-plan";
import { TmdbClient, TmdbError, type TmdbFilm } from "../src/main/tmdb";
import { criteriaSchema, metadataSchema } from "../src/shared/recommendation";

const date = new Date("2026-11-25T00:00:00Z");
const horror = criteriaSchema.parse({ mood: "surprise", selectionCategory: "horror", preferredCountries: [],
  requiredCountries: [], preferredLanguages: [], requiredLanguages: [] });
const tags = [{ id: 1, name: "friendship" }, { id: 2, name: "fugue historique" }, { id: 3, name: "exil ferroviaire" }];
const signal = (film: Film, numeric: number): Signal => ({
  film, ratings: [{ numeric }], spontaneous: false, memorable: false, rewatch: false,
});
const film = (id: number): Film => ({ id, title: "Film " + id, year: 1998, status: "unknown",
  metadata: metadataSchema.parse({ release: { source: "TMDB", keywords: id <= 2 ? tags : [tags[0]] } }) });
const remote = (id: number, horrorGenre = true): TmdbFilm => ({
  tmdbId: id, title: "Film " + id, year: 1998, aliases: [], releaseYears: [1998], fetchedAt: date.toISOString(),
  metadata: metadataSchema.parse({ genres: horrorGenre ? ["Horreur"] : ["Comédie"], minutes: 105, countries: ["JP"], language: "ja",
    reputation: { source: "TMDB", average: 8.2, count: 150 }, popularity: id % 8 }),
});
function client() {
  return new TmdbClient("mock", vi.fn<typeof fetch>().mockRejectedValue(new Error("Réseau inattendu")), () => date);
}

describe("acquisition guidée par le profil", () => {
  it("utilise les identifiants vérifiés et des signaux multiples, écarte les thèmes génériques et redondants", () => {
    const catalogue = Array.from({ length: 25 }, (_, index) => film(index + 1));
    const ratings = [signal(catalogue[0], 8.5), signal(catalogue[1], 9), signal(catalogue[2], 0)];
    const movie = (id: number, directorIds: number[]) => ({ id, metadata: { tmdb: { directorIds } } });
    expect(acquisitionProfile(catalogue, ratings, [movie(1, [50, 90]), movie(2, [50, 90]), movie(3, [90])]))
      .toEqual({ directors: [50], keywords: [2] });
    expect(acquisitionProfile(catalogue, ratings.slice(0, 1), [])).toEqual({ directors: [], keywords: [] });
  });

  it("préserve l’exploration et les filtres de genre et de durée sur tous les flux", () => {
    const input = { ...horror, maxMinutes: 110 };
    const profile = { directors: [22, 33], keywords: [44, 55] };
    const plan = acquisitionPlan(input, profile, 0, 2026);
    expect(plan.initial.map(({ kind }) => kind)).toEqual(["general", "general", "director", "keyword"]);
    expect([...plan.initial, ...plan.reserve].every(({ parameters }) =>
      parameters.with_genres === "27" && parameters["with_runtime.lte"] === "110")).toBe(true);
    expect(acquisitionPlan(input, profile, 1, 2026).initial[2].parameters.with_crew).toBe("33");
    const classics = acquisitionPlan({ ...horror, selectionCategory: "classics",
      requiredCountries: ["JP", "ES"], preferredCountries: ["US"], requiredLanguages: ["ja", "es"], preferredLanguages: ["en"],
    }, profile, 5, 2026);
    expect(classics.initial.some(({ parameters }) => parameters["primary_release_date.gte"] === "1900-01-01")).toBe(true);
    expect(classics.initial.find(({ kind }) => kind === "geography")?.parameters).toMatchObject({
      with_origin_country: "ES", with_original_language: "ja", "vote_count.gte": "50",
    });
    const regionalHorror = { ...input, preferredCountries: ["JP"] };
    expect([0, 2].map((round) => acquisitionPlan(regionalHorror, profile, round, 2026).initial.find(({ kind }) => kind === "director")?.parameters.with_crew))
      .toEqual(["22", "33"]);
    const gems = acquisitionPlan({ ...horror, selectionCategory: "gems", preferredLanguages: ["fr"] }, profile, 0, 2026);
    expect(gems.initial.find(({ kind }) => kind === "geography")?.parameters).toMatchObject({
      with_original_language: "fr", "vote_count.gte": "50", "vote_count.lte": "1500",
    });
  });

  it("déduplique les pages, ignore les exclusions locales et élargit un vivier Horreur sans modifier le classement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "after-dark-acquisition-test-"));
    const { db, close } = await openDatabase(join(directory, "test.sqlite"), "drizzle");
    try {
      for (const id of [10, 11, 12, 13]) await cacheFilm(db, {
        ...remote(id), fetchedAt: "2025-12-01T00:00:00Z",
        ...(id === 12 ? { metadata: { ...remote(id).metadata, collection: { id: 535790, name: "Godzilla" } } } : {}),
      });
      const initial = await readCatalogue(db);
      const byId = new Map(initial.movies.map(({ tmdbId, id }) => [tmdbId, id]));
      await saveFeedback(db, { movieId: byId.get(10)!, action: "seen", score: null, appreciation: null }, date);
      await saveFeedback(db, { movieId: byId.get(11)!, action: "intention", intention: "not_interested" }, date);
      await setFranchisePreference(db, null, "godzilla", true);
      const recent = new Set([byId.get(13)!]);
      const tmdb = client();
      let page = 0;
      const discover = vi.spyOn(tmdb, "discoverPage").mockImplementation(async () => {
        const offset = 100 + 10 * page++;
        return [10, 11, 12, 13, 20, ...Array.from({ length: 10 }, (_, index) => offset + index)];
      });
      const details = vi.spyOn(tmdb, "film").mockImplementation(async (id) => remote(id, id !== 20));
      const start = await readCatalogue(db);
      const { report, state, blocked } = await acquireTonight(db, start, horror, recent, 0, date, async () => tmdb,
        undefined, { strategy: "profile" });
      expect(discover.mock.calls.length).toBeLessThanOrEqual(6);
      expect(details.mock.calls).toHaveLength(18);
      expect(new Set(details.mock.calls.flat()).size).toBe(18);
      expect(details.mock.calls.flat().some((id) => [10, 11, 12, 13].includes(id))).toBe(false);
      expect(report.lookups.filter(({ result }) => result === "excluded-local").map(({ tmdbId }) => tmdbId)).toEqual([10, 11, 12, 13]);
      expect(report.pool).toMatchObject({ stop: "budget", before: { afterRotation: 0 }, after: { afterRotation: 17 } });
      const result = recommend(state.catalogue, state.signals, horror, recent,
        { referenceDate: "2026-11-25", excludedIds: blocked }, tonightAffinityModel, tonightRanking, undefined, 10);
      expect(result.films).toHaveLength(10);
      expect(result.films.every(({ metadata }) => metadata.genres.includes("Horreur"))).toBe(true);
      expect(state.signals).toEqual(start.signals);
      discover.mockRejectedValueOnce(new TmdbError("limited"));
      const offline = await acquireTonight(db, state, horror, recent, 1, date, async () => tmdb, undefined, { strategy: "profile" });
      expect(offline.report).toMatchObject({ connection: "limited", pool: { stop: "tmdb-unavailable", detailRequests: 0 } });
      expect(offline.state).toBe(state);
    } finally {
      close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("vérifie le rôle de réalisation avec les détails et réutilise les fiches fraîches", async () => {
    const directory = await mkdtemp(join(tmpdir(), "after-dark-acquisition-director-"));
    const { db, close } = await openDatabase(join(directory, "test.sqlite"), "drizzle");
    try {
      for (const id of [30, 31]) await cacheFilm(db, { ...remote(id), directorIds: [50] });
      const initial = await readCatalogue(db);
      for (const movie of initial.movies) {
        await saveFeedback(db, { movieId: movie.id, action: "seen", score: null, appreciation: null }, date);
        await saveFeedback(db, { movieId: movie.id, action: "evaluate", score: 9, appreciation: null }, date);
      }
      const tmdb = client();
      vi.spyOn(tmdb, "discoverPage").mockImplementation(async (query) => query.with_crew === "50" ? [32, 33] : []);
      const details = vi.spyOn(tmdb, "film").mockImplementation(async (id) => ({
        ...remote(id), directorIds: id === 32 ? [50] : [51],
      }));
      const state = await readCatalogue(db);
      const result = await acquireTonight(db, state, horror, new Set(), 0, date, async () => tmdb, undefined, { strategy: "profile" });
      expect(result.report.lookups).toEqual([{ tmdbId: 32, result: "cached" }, { tmdbId: 33, result: "director-mismatch" }]);
      expect(result.state.movies.map(({ tmdbId }) => tmdbId)).toEqual([30, 31, 32]);
      details.mockClear();
      vi.mocked(tmdb.discoverPage).mockResolvedValue([32]);
      const again = await acquireTonight(db, result.state, horror, new Set(), 1, date, async () => tmdb, undefined, { strategy: "profile" });
      expect(details).not.toHaveBeenCalled();
      expect(again.report.lookups).toEqual([{ tmdbId: 32, result: "fresh-cache" }]);
      expect(again.report.pool?.stop).toBe("no-new-candidates");
    } finally {
      close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("compare deux séances par bras sur des copies indépendantes et préserve le catalogue et l’historique d’origine", async () => {
    const directory = await mkdtemp(join(tmpdir(), "after-dark-acquisition-compare-"));
    const snapshot = join(directory, "test.sqlite");
    const { db, close } = await openDatabase(snapshot, "drizzle");
    try {
      const tmdb = client();
      vi.spyOn(tmdb, "discover").mockResolvedValue([40]);
      vi.spyOn(tmdb, "discoverPage").mockResolvedValue([40, 41]);
      vi.spyOn(tmdb, "film").mockImplementation(async (id) => remote(id));
      const { results: [{ arms: [baseline, profile] }] } = await compareAcquisition({
        snapshot, date, client: async () => tmdb, categories: ["horror"], sessions: 2,
      });
      expect(baseline.rounds.map(({ newFilms }) => newFilms)).toEqual([1, 0]);
      expect(profile.rounds.map(({ newFilms }) => newFilms)).toEqual([2, 0]);
      expect(profile.rounds[1].report.pool?.before).toEqual({ afterRotation: 0, beforeRotation: 2 });
      expect(profile.rounds[1].selected).toEqual([]);
      expect(profile.summary).toMatchObject({ newFilms: 2, newAdmissible: 2, selectedFromAcquisition: 2, uniqueSelectedAcquisitions: 2, incomplete: 2 });
      expect(profile.summary.newAffinity.count).toBe(2);
      expect(profile.summary.yieldPerRequest).toBe(2 / profile.summary.requests);
      expect((await readCatalogue(db)).catalogue).toEqual([]);
      expect(await readHistory(db)).toEqual({ round: 0, recent: new Set() });
    } finally {
      close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("conserve la rotation sur six séances et compte les retours au-delà de l’historique récent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "after-dark-long-acquisition-"));
    const snapshot = join(directory, "test.sqlite");
    const { db, close } = await openDatabase(snapshot, "drizzle");
    try {
      for (let id = 100; id < 140; id++) await cacheFilm(db, remote(id));
      const options = { snapshot, date, client: async () => undefined, categories: ["horror"] as const };
      const args = { ...options, categories: [...options.categories] };
      const report = await compareAcquisition(args);
      const { arms, decision, differences } = report.results[0];
      expect(report.sessions).toBe(6);
      expect(report.budget).toEqual({ maximumDiscover: 60, maximumDetails: 216 });
      expect(decision.verdict).toBe("indecis");
      for (const { rounds, summary } of arms) {
        expect(rounds.map((round) => round.selected.length)).toEqual([10, 10, 10, 10, 10, 10]);
        expect(summary).toMatchObject({ newFilms: 0, selectedFromAcquisition: 0, repeated: 20,
          recentSelected: 0, incomplete: 0, yieldPerRequest: null, eligibleHiddenByRotation: 120 });
        expect(summary.selectionDiversity).toMatchObject({ decades: 1, languages: 1, genres: 1 });
      }
      expect(differences.every(({ profileOnly, baselineOnly }) => !profileOnly.length && !baselineOnly.length)).toBe(true);
      const replay = await compareAcquisition(args);
      expect(replay.results.map(({ arms }) => arms.map(({ rounds }) => rounds.map(({ selected }) => selected))))
        .toEqual([arms.map(({ rounds }) => rounds.map(({ selected }) => selected))]);
      expect(acquisitionMarkdown(report, false)).toContain("6 séances par catégorie et stratégie");
      expect((await readCatalogue(db)).catalogue).toHaveLength(40);
      expect((await readHistory(db)).round).toBe(0);
      for (const sessions of [0, 1.5, 21]) await expect(compareAcquisition({ ...args, sessions })).rejects.toThrow("entre 1 et 20");
    } finally {
      close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("distingue les acquisitions sélectionnées plus tard du catalogue initial", async () => {
    const directory = await mkdtemp(join(tmpdir(), "after-dark-acquisition-origin-"));
    const snapshot = join(directory, "test.sqlite");
    const { db, close } = await openDatabase(snapshot, "drizzle");
    try {
      await cacheFilm(db, remote(9));
      const tmdb = client();
      const ids = Array.from({ length: 12 }, (_, index) => 100 + index);
      vi.spyOn(tmdb, "discover").mockResolvedValue(ids);
      vi.spyOn(tmdb, "discoverPage").mockResolvedValue(ids);
      vi.spyOn(tmdb, "film").mockImplementation(async (id) => remote(id));
      const { results: [{ arms }] } = await compareAcquisition({
        snapshot, date, client: async () => tmdb, categories: ["horror"], sessions: 3,
      });
      for (const { rounds, summary } of arms) {
        expect(rounds[0].selected.filter(({ origin }) => origin === "initial")).toHaveLength(1);
        expect(rounds[1].selected.map(({ origin }) => origin)).toEqual(Array(3).fill("acquired-earlier"));
        expect(rounds[2].selected).toEqual([]);
        expect(summary).toMatchObject({ newFilms: 12, newAdmissible: 12, selectedFromAcquisition: 12, incomplete: 2 });
      }
    } finally {
      close();
      await rm(directory, { recursive: true, force: true });
    }
  });


  it("borne les deux stratégies et distingue appels tentés, cache et échecs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "after-dark-equal-budget-"));
    const snapshot = join(directory, "test.sqlite");
    const { db, close } = await openDatabase(snapshot, "drizzle");
    try {
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/discover/movie")) {
          return Response.json({ results: [{ id: 500, title: "Fiction" }, { id: 501, title: "Suite" }] });
        }
        return Response.json({ id: 500, title: "Fiction", genres: [{ id: 27, name: "Horreur" }],
          release_date: "2005-01-01", vote_average: 8.2, vote_count: 150 });
      });
      const tmdb = new TmdbClient("test", fetcher, () => date);
      const report = await compareAcquisition({
        snapshot, date, client: async () => tmdb, categories: ["horror"], sessions: 1, budget: { pages: 1, details: 1 },
      });
      expect(report.perSessionBudget).toEqual({ pages: 1, details: 1 });
      expect(report.budget).toEqual({ maximumDiscover: 2, maximumDetails: 2 });
      expect(fetcher).toHaveBeenCalledTimes(4);
      for (const { summary } of report.results[0].arms) {
        expect(summary).toMatchObject({ discover: 1, details: 1, newAdmissible: 1, incomplete: 1,
          costPerAdmissible: 2, costPerSelectedAcquisition: 2 });
      }
      fetcher.mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "60" } }));
      const initial = await readCatalogue(db);
      for (const strategy of ["baseline", "profile"] as const) {
        const { report } = await acquireTonight(db, initial, horror, new Set(), 0, date, async () => tmdb, undefined,
          { strategy, budget: { pages: 1, details: 1 } });
        expect(report).toMatchObject({ connection: "limited", pool: { discoveryRequests: 1, detailRequests: 0, stop: "tmdb-unavailable" } });
      }
      expect(fetcher).toHaveBeenCalledTimes(5);
      expect((await readCatalogue(db)).catalogue).toEqual([]);
      expect((await readHistory(db)).round).toBe(0);
    } finally {
      close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("prépare un questionnaire aveugle reproductible, exclut les titres communs et révèle seulement après les réponses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "after-dark-blind-acquisition-"));
    const snapshot = join(directory, "test.sqlite");
    const { db, close } = await openDatabase(snapshot, "drizzle");
    try {
      const tmdb = client();
      vi.spyOn(tmdb, "discover").mockResolvedValue([100, 101]);
      vi.spyOn(tmdb, "discoverPage").mockResolvedValue([100, 102]);
      vi.spyOn(tmdb, "film").mockImplementation(async (id) => remote(id));
      const report = await compareAcquisition({ snapshot, date, client: async () => tmdb, categories: ["horror"], sessions: 2 });
      const packet = prepareBlindAcquisition(report, "fixture-secret");
      expect(prepareBlindAcquisition(report, "fixture-secret")).toEqual(packet);
      expect(packet.markdown).not.toMatch(/baseline|profile|Film 100|fixture-secret/);
      expect(packet.markdown).toContain("Film 101");
      expect(packet.markdown).toContain("Film 102");
      expect(Object.values(packet.responses.answers)).toEqual([null, null]);
      expect(() => finishBlindAcquisition(packet.manifest, packet.responses)).toThrow("réponses complètes");
      const answers = Object.fromEntries(Object.entries(packet.manifest.cards).map(([id, film]) =>
        [id, film.title === "Film 101" ? "envie" : "informations"]));
      const result = finishBlindAcquisition(packet.manifest, { ...packet.responses, answers });
      expect(result.results.find(({ strategy }) => strategy === "baseline")?.byCategory.horror.envie).toBe(1);
      expect(result.results.find(({ strategy }) => strategy === "profile")?.counts).toMatchObject({ informations: 1, non: 0 });
      expect(() => finishBlindAcquisition(packet.manifest, { ...packet.responses, session: "0000000000000000", answers }))
        .toThrow("correspondre");
      expect((await readCatalogue(db)).catalogue).toEqual([]);
      expect((await readHistory(db)).round).toBe(0);
    } finally {
      close();
      await rm(directory, { recursive: true, force: true });
    }
  });

});
