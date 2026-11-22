import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client";
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
  imdbId: "tt2543164", fetchedAt: now.toISOString(),
  metadata: metadataSchema.parse({ countries: ["US"], minutes: 116, language: "en", directors: ["Denis Villeneuve"] }),
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

  it("préserve le cache hors ligne, enregistre critères et version, évite les répétitions", async () => {
    const { db } = database;
    await cacheFilm(db, remote);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("network"));
    const client = new TmdbClient("test-token", fetcher, () => now);
    const result = await findTonight(db, criteria, async () => client, now);
    expect(result).toMatchObject({ status: "ready", connection: "offline", personalized: false, films: [{ title: "Premier Contact" }] });
    expect(await db.select().from(moodSessions).get()).toMatchObject({ criteria: { atmosphere: "tension" } });
    expect(await db.select().from(recommendationHistory).get()).toMatchObject({ rank: 1, engineVersion: "1.0.0" });
    expect(await findTonight(db, criteria, async () => undefined, now)).toMatchObject({ connection: "unconfigured", status: "exhausted" });
    expect(await findTonight(db, criteria, async () => undefined, now, true)).toMatchObject({ status: "ready" });
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
        original_language: "en", production_countries: [{ iso_3166_1: "US" }], runtime: 116,
        overview: "Une linguiste est appelée pour établir le premier contact. Suite du récit.",
        credits: { crew: [{ name: "Denis Villeneuve", job: "Director" }] }, imdb_id: remote.imdbId,
        poster_path: "/arrival.jpg",
      });
    });
    const client = new TmdbClient("test-token", fetcher, () => now);
    expect(await findTonight(database.db, criteria, async () => client, now)).toMatchObject({
      connection: "online", films: [{ metadata: { minutes: 116, directors: ["Denis Villeneuve"],
        synopsis: "Une linguiste est appelée pour établir le premier contact.", poster: "/arrival.jpg" } }],
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

  it("varie les ères et distingue paramètres d’origine et de langue pour la recherche", () => {
    const queries = discoveryQueries({ ...criteria, requiredCountries: ["ES"], requiredLanguages: ["ja"] }, 4, 2026);
    expect(queries[0]).toMatchObject({ page: "2", with_original_language: "ja" });
    expect(queries[1]).toMatchObject({ "primary_release_date.gte": "2005-01-01" });
    expect(queries[2]).toMatchObject({ with_origin_country: "ES", with_original_language: "ja" });
  });
});
