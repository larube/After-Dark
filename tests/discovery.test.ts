import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client";
import { enrichmentQueue } from "../src/db/enrichment";
import { enrichNext } from "../src/main/enrichment";
import { saveFeedback } from "../src/db/feedback";
import { cacheFilm, readCatalogue } from "../src/db/recommendations";
import { moodSessions, recommendationHistory } from "../src/db/schema";
import { importProfile } from "../src/import/profile";
import { attachPosters } from "../src/main/posters";
import { findTonight } from "../src/main/recommend";
import { discoveryQueries, TmdbClient, type TmdbFilm } from "../src/main/tmdb";
import { criteriaSchema, metadataSchema } from "../src/shared/recommendation";

const criteria = criteriaSchema.parse({
  mood: "tension", preferredCountries: [], requiredCountries: [],
  preferredLanguages: [], requiredLanguages: [],
});
const now = new Date("2026-07-13T00:00:00Z");
const remote: TmdbFilm = {
  title: "Premier Contact", originalTitle: "Arrival", year: 2016, aliases: ["Arrival"], tmdbId: 329865,
  imdbId: "tt2543164", releaseYears: [2016], fetchedAt: now.toISOString(),
  metadata: metadataSchema.parse({ countries: ["US"], minutes: 116, language: "en", directors: ["Denis Villeneuve"],
    reputation: { source: "TMDB", average: 8, count: 500 } }),
};
const mockResponse = (value: unknown) => Response.json(value);
let folder: string;
let database: Awaited<ReturnType<typeof openDatabase>>;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "after-dark-discovery-"));
  database = await openDatabase(join(folder, "cinema.sqlite"), resolve("drizzle"));
});

afterEach(async () => {
  database?.close();
  await rm(folder, { recursive: true, force: true });
});

describe("intégration TMDB et SQLite", () => {
  it("fusionne identifiants et variantes de titre avec un film importé, sans écraser ses données", async () => {
    const { db } = database;
    await importProfile(db, { version: 1, entries: [{
      movie: { canonicalId: "arrival", displayTitle: "Arrival", year: 2016, metadata: { custom: "préservé" } },
      evaluations: [{ kind: "historical_range", min: "8,5", max: "9", source: "notes", sourceId: "arrival" }],
    }] });
    expect(await cacheFilm(db, remote)).toBe(true);
    expect(await cacheFilm(db, remote)).toBe(true);
    const { movies, catalogue, signals } = await readCatalogue(db);
    expect(movies).toHaveLength(1);
    expect(movies[0]).toMatchObject({ tmdbId: 329865, metadata: { custom: "préservé", tmdb: { source: "TMDB", fetchedAt: now.toISOString() } } });
    expect(catalogue[0]).toMatchObject({ status: "seen", metadata: { minutes: 116 } });
    expect(signals[0].ratings).toEqual([{ numeric: 8.75 }]);
  });

  it("omet les correspondances de titre ambiguës sans créer de doublon", async () => {
    const { db } = database;
    await importProfile(db, { version: 1, entries: [
      { movie: { canonicalId: "arrival-inconnu", displayTitle: "Arrival" }, status: "seen" },
    ] });
    expect(await cacheFilm(db, remote)).toBe(false);
    expect((await readCatalogue(db)).movies).toHaveLength(1);
  });

  it("rapproche un titre alternatif et un décalage documenté sans changer l’année du profil", async () => {
    const { db } = database;
    await importProfile(db, { version: 1, entries: [
      { movie: { canonicalId: "alt", displayTitle: "L’Arrivée", year: 2015, aliases: ["Arrival"] }, status: "seen" },
    ] });
    expect(await cacheFilm(db, remote)).toBe(false);
    expect((await readCatalogue(db)).movies).toHaveLength(1);
    const verified = { ...remote, releaseYears: [2015, 2016] };
    expect(await cacheFilm(db, verified)).toBe(true);
    expect(await importProfile(db, { version: 1, entries: [
      { movie: { canonicalId: "edition", displayTitle: "Premier Contact", year: 2016 } },
    ] })).toMatchObject({ updated: 1, created: 0 });
    expect(await cacheFilm(db, { ...remote, tmdbId: 999, imdbId: undefined })).toBe(false);
    const { movies, catalogue } = await readCatalogue(db);
    expect(movies).toHaveLength(1);
    expect(movies[0]).toMatchObject({ displayTitle: "L’Arrivée", year: 2015, tmdbId: remote.tmdbId });
    expect(catalogue[0].status).toBe("seen");
  });

  it("refuse de fusionner en présence de deux titres locaux plausibles et accepte les remakes éloignés", async () => {
    const { db } = database;
    const entries = [
      { movie: { canonicalId: "festival", displayTitle: "Arrival", year: 2015 } },
      { movie: { canonicalId: "salle", displayTitle: "Premier Contact", year: 2016 } },
    ];
    await importProfile(db, { version: 1, entries });
    expect(await cacheFilm(db, { ...remote, releaseYears: [2015, 2016] })).toBe(false);
    expect((await readCatalogue(db)).movies.map(({ tmdbId }) => tmdbId)).toEqual([null, null]);
    expect(await cacheFilm(db, { ...remote, year: 1996, releaseYears: [1996] })).toBe(true);
    expect((await readCatalogue(db)).movies).toHaveLength(3);
  });

  it("valide un titre alternatif avec les années de projection et refuse deux résultats plausibles", async () => {
    const listing = [{ id: remote.tmdbId, title: "Premier Contact", release_date: "2016-11-10" }];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("search/movie")) return mockResponse({ results: listing });
      return mockResponse({
        ...listing[0], alternative_titles: { titles: [{ title: "L’Arrivée" }] },
        release_dates: { results: [{ release_dates: [
          { type: 1, release_date: "2015-12-31T00:00:00Z" },
          { type: 4, release_date: "2017-01-01T00:00:00Z" },
        ] }] },
      });
    });
    const client = new TmdbClient("test-token", fetcher, () => now);
    expect(await client.matchProfileFilm(["L’Arrivée"], 2015, () => false)).toMatchObject({
      tmdbId: remote.tmdbId, releaseYears: [2015, 2016],
    });
    listing[0].title = "L’Arrivée";
    listing.push({ id: 12345, title: "L’Arrivée", release_date: "2015-06-01" });
    expect(await client.matchProfileFilm(["L’Arrivée"], 2015, () => false)).toBeUndefined();
  });

  it("reprend après réouverture, conserve les échecs réseau en attente et n’attend pas le réseau pour classer le cache", async () => {
    await importProfile(database.db, { version: 1, entries: [
      { movie: { canonicalId: "arrival", displayTitle: "Arrival", year: 2016, tmdbId: remote.tmdbId, metadata: { genres: ["Thriller"] } }, status: "unseen" },
      { movie: { canonicalId: "cure", displayTitle: "Cure", year: 1997 }, status: "unseen" },
    ] });
    let releaseFetch: (response: Response) => void = () => undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise((resolveResponse) => { releaseFetch = resolveResponse; }))
      .mockRejectedValueOnce(Error("offline")).mockResolvedValue(mockResponse({ results: [] }));
    const client = new TmdbClient("test-token", fetcher, () => now);
    const step = () => enrichNext(database.db, async () => client, () => false, (write) => write());
    const first = step();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(await findTonight(database.db, criteria, async () => undefined, now)).toMatchObject({ status: "ready" });
    releaseFetch(mockResponse({ id: remote.tmdbId, title: "Arrival", release_date: "2016-11-10" }));
    expect(await first).toBe("working");
    expect(await enrichmentQueue(database.db)).toMatchObject({ total: 2, enriched: 1, skipped: 0, pending: [expect.anything()] });
    database.close();
    database = await openDatabase(join(folder, "cinema.sqlite"), resolve("drizzle"));
    expect(await step()).toBe("offline");
    expect(await enrichmentQueue(database.db)).toMatchObject({ enriched: 1, skipped: 0, pending: [expect.anything()] });
    expect(await step()).toBe("working");
    expect(await step()).toBe("complete");
    expect(await enrichmentQueue(database.db)).toMatchObject({ enriched: 1, skipped: 1, pending: [] });
    await importProfile(database.db, { version: 1, entries: [
      { movie: { canonicalId: "cure", displayTitle: "Cure", year: 1997, aliases: ["キュア"] } },
    ] });
    expect((await enrichmentQueue(database.db)).pending).toHaveLength(1);
    expect(await enrichNext(database.db, async () => client, () => true, (write) => write())).toBe("waiting");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("préserve le cache hors ligne, enregistre critères et version, évite les répétitions", async () => {
    const { db } = database;
    await cacheFilm(db, remote);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("network"));
    const client = new TmdbClient("test-token", fetcher, () => now);
    const result = await findTonight(db, criteria, async () => client, now);
    expect(result).toMatchObject({ status: "ready", connection: "offline", personalized: false, films: [{ title: "Premier Contact" }] });
    expect(await db.select().from(moodSessions).get()).toMatchObject({ criteria: { atmosphere: "tension" } });
    expect(await db.select().from(recommendationHistory).get()).toMatchObject({ rank: 1, engineVersion: "1.4.0" });
    expect(await findTonight(db, criteria, async () => undefined, now)).toMatchObject({ connection: "unconfigured", status: "exhausted" });
    expect(await findTonight(db, criteria, async () => undefined, now, true)).toMatchObject({ status: "ready" });
  });

  it("écarte durablement les refus et n’apprend rien d’un visionnage sans note", async () => {
    const { db } = database;
    await cacheFilm(db, remote);
    const [{ id }] = (await readCatalogue(db)).catalogue;
    expect((await findTonight(db, criteria, async () => undefined, now, true)).films.map((film) => film.id)).toEqual([id]);
    expect(await saveFeedback(db, { action: "intention", movieId: id, intention: "not_interested" })).toMatchObject({ ok: true });
    database.close();
    database = await openDatabase(join(folder, "cinema.sqlite"), resolve("drizzle"));
    const reopened = database.db;
    expect((await findTonight(reopened, criteria, async () => undefined, now, true)).films).toEqual([]);
    expect(await saveFeedback(reopened, { action: "seen", movieId: id, score: null, appreciation: "Un commentaire libre." }))
      .toMatchObject({ ok: true });
    expect(await readCatalogue(reopened)).toMatchObject({ catalogue: [{ id, status: "seen" }], signals: [] });
    expect((await findTonight(reopened, criteria, async () => undefined, now, true)).films).toEqual([]);
  });

  it("écarte les films fictifs du profil d’exemple et retrouve une affiche locale sans réseau", async () => {
    const { db } = database;
    await importProfile(db, { version: 1, entries: [
      { movie: { canonicalId: "demo:fictif-b", displayTitle: "La Dernière Lampe (film fictif)" }, status: "unseen" },
    ] });
    expect(await findTonight(db, criteria, async () => undefined, now)).toMatchObject({ status: "empty" });
    await cacheFilm(db, { ...remote, metadata: { ...remote.metadata, poster: "/arrival.jpg" } });
    const result = await findTonight(db, criteria, async () => undefined, now);
    const posterFolder = join(folder, "posters");
    await mkdir(posterFolder);
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    await writeFile(join(posterFolder, "arrival.jpg"), image);
    await attachPosters(result, folder);
    expect(result.films[0].posterData).toBe("data:image/jpeg;base64," + image.toString("base64"));
  });

  it("découvre des films, obtient des détails normalisés et réutilise les détails frais", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.themoviedb.org");
      expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer test-token");
      if (url.pathname.endsWith("/discover/movie")) return mockResponse({ results: [{ id: remote.tmdbId, title: remote.title }] });
      expect(url.pathname).toBe("/3/movie/329865");
      return mockResponse({
        id: remote.tmdbId, title: remote.title, original_title: remote.originalTitle, release_date: "2016-11-10",
        vote_average: 8.1, vote_count: 650, status: "Released", genres: [{ id: 878, name: "Science-Fiction" }],
        keywords: { keywords: [{ id: 123, name: "first contact" }] },
        release_dates: { results: [{ iso_3166_1: "US", release_dates: [{ type: 3, release_date: "2016-11-11T00:00:00.000Z" }] }] },
        original_language: "en", production_countries: [{ iso_3166_1: "US" }], runtime: 116,
        overview: "Une linguiste est appelée pour établir le premier contact. Suite du récit.",
        credits: { crew: [{ name: "Denis Villeneuve", job: "Director" }] }, imdb_id: remote.imdbId,
        poster_path: "/arrival.jpg",
      });
    });
    const client = new TmdbClient("test-token", fetcher, () => now);
    expect(await findTonight(database.db, criteria, async () => client, now)).toMatchObject({
      connection: "online", films: [{ metadata: { minutes: 116, directors: ["Denis Villeneuve"],
        synopsis: "Une linguiste est appelée pour établir le premier contact.", poster: "/arrival.jpg",
        reputation: { source: "TMDB", average: 8.1, count: 650 },
        release: { source: "TMDB", primaryDate: "2016-11-10", status: "Released", runtime: 116,
          genres: [{ id: 878, name: "Science-Fiction" }], keywords: [{ id: 123, name: "first contact" }],
          events: [{ country: "US", type: 3, date: "2016-11-11T00:00:00.000Z" }] } } }],
    });
    expect(await findTonight(database.db, criteria, async () => client, now, true)).toMatchObject({ connection: "cached" });
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/movie/329865"))).toHaveLength(1);
  });

  it("respecte Retry-After sur 429 et distingue une authentification refusée", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "20" } }));
    const client = new TmdbClient("test-token", fetcher, () => now);
    await expect(client.film(1)).rejects.toMatchObject({ connection: "limited" });
    await expect(client.film(2)).rejects.toMatchObject({ connection: "limited" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const unauthorized = new TmdbClient("test-token", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })));
    expect(await findTonight(database.db, criteria, async () => unauthorized, now)).toMatchObject({ connection: "unauthorized", status: "empty" });
  });

  it("plafonne à deux les résultats du flux pré-1970, sans réduire le nombre de candidats modernes", async () => {
    const client = new TmdbClient("test-token", vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const end = url.searchParams.get("primary_release_date.lte");
      const offset = end === "1949-12-31" ? 100 : end === "1979-12-31" ? 200
        : url.searchParams.has("vote_count.lte") ? 300 : 400;
      return mockResponse({ results: Array.from({ length: 20 }, (_, index) => ({ id: offset + index, title: "Film" })) });
    }), () => now);
    const ids = await client.discover(criteria, 0);
    expect(ids.filter((id) => id < 200)).toEqual([100, 101]);
    expect(ids.filter((id) => id >= 200)).toHaveLength(60);
    expect(ids.slice(0, 18).filter((id) => id < 200)).toHaveLength(2);
  });

  it("varie les ères et distingue paramètres d’origine et de langue pour la recherche", () => {
    const queries = discoveryQueries({ ...criteria, requiredCountries: ["ES"], requiredLanguages: ["ja"] }, 4, 2026);
    expect(queries[0]).toMatchObject({ page: "1", with_original_language: "ja", "primary_release_date.gte": "1970-01-01" });
    expect(queries[1]).toMatchObject({ "primary_release_date.gte": "2010-01-01" });
    expect(queries[3]).toMatchObject({ "primary_release_date.gte": "1950-01-01", "primary_release_date.lte": "1959-12-31",
      "vote_count.gte": "35", with_original_language: "ja" });
    expect([0, 4, 8].map((round) => discoveryQueries(criteria, round, 2026)[3]["primary_release_date.gte"]))
      .toEqual(["1900-01-01", "1950-01-01", "1960-01-01"]);
    expect([0, 1, 2, 3, 4, 5].map((round) => discoveryQueries(criteria, round, 2026)[1]["primary_release_date.gte"]))
      .toEqual(["1970-01-01", "1980-01-01", "1990-01-01", "2000-01-01", "2010-01-01", "2020-01-01"]);
    expect(discoveryQueries(criteria, 1, 2026)).toHaveLength(3);
    expect(queries[2]).toMatchObject({ with_origin_country: "ES", with_original_language: "ja" });
  });
});
