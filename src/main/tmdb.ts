import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { Criteria, Metadata } from "../shared/recommendation";
import { normalizeTitle } from "../domain/ratings";

const idSchema = z.number().int().positive();
const listing = z.object({
  id: idSchema, title: z.string().min(1), original_title: z.string().nullish(),
  release_date: z.string().nullish(), adult: z.boolean().optional(),
});
const results = z.object({ results: z.array(z.unknown()).max(100) });
const named = z.object({ id: z.number().int().optional(), name: z.string().min(1) });
const details = listing.extend({
  status: z.string().nullish(), runtime: z.number().int().nullish(), original_language: z.string().nullish(),
  genres: z.array(named).optional(), production_countries: z.array(z.object({ iso_3166_1: z.string() })).optional(),
  credits: z.object({ crew: z.array(named.extend({ job: z.string() })) }).optional(),
  keywords: z.object({ keywords: z.array(named) }).optional(),
  alternative_titles: z.object({ titles: z.array(z.object({ title: z.string().min(1) })) }).optional(),
  release_dates: z.object({ results: z.array(z.object({
    iso_3166_1: z.string().optional(),
    release_dates: z.array(z.object({ release_date: z.string(), type: z.number().int() })),
  })) }).optional(),
  imdb_id: z.string().nullish(), overview: z.string().nullish(), poster_path: z.string().nullish(),
  popularity: z.number().nonnegative().optional(),
});

export type TmdbFilm = {
  tmdbId: number; title: string; originalTitle?: string; year?: number;
  imdbId?: string; aliases: string[]; releaseYears: number[]; metadata: Metadata; fetchedAt: string;
};
type ConnectionError = "offline" | "limited" | "unauthorized" | "unavailable";

export class TmdbError extends Error {
  constructor(public readonly connection: ConnectionError) { super(connection); }
}

const discoveryGenres = {
  laugh: "35", tension: "53|80|9648", strange: "27|14|878",
  emotion: "18|10749", immersion: "12|878|10752",
};

export function discoveryQueries(criteria: Criteria, round: number, year: number): Record<string, string>[] {
  const bounds = {
    ...(criteria.requiredLanguages.length === 1 ? { with_original_language: criteria.requiredLanguages[0] } : {}),
    ...(criteria.maxMinutes ? { "with_runtime.lte": String(criteria.maxMinutes) } : {}),
    include_adult: "false",
  };
  const page = String(1 + Math.floor(round / 3) % 4);
  const moodGenres: Record<string, string> = criteria.mood === "surprise" ? {} : { with_genres: discoveryGenres[criteria.mood] };
  const era = [[1980, 2004], [2005, 2015], [2016, year]][round % 3];
  const base = { ...bounds, ...moodGenres, page, "vote_count.gte": "35" };
  const regions = [...new Set([...criteria.requiredCountries, ...criteria.preferredCountries])];
  const languages = [...new Set([...criteria.requiredLanguages, ...criteria.preferredLanguages])];
  return [
    { ...base, sort_by: "popularity.desc" },
    { ...base, sort_by: "vote_average.desc", "primary_release_date.gte": era[0] + "-01-01", "primary_release_date.lte": era[1] + "-12-31" },
    { ...bounds, page, sort_by: "vote_average.desc", "vote_count.gte": "25", "vote_count.lte": "1500",
      ...(regions.length ? { with_origin_country: regions[round % regions.length] } : {}),
      ...(languages.length ? { with_original_language: languages[round % languages.length] } : {}),
    },
  ];
}

function yearOf(date: string | null | undefined) {
  const year = Number(date?.match(/^(\d{4})-/)?.[1]);
  return year > 0 ? year : undefined;
}

function synopsis(overview?: string | null) {
  // Show the first complete sentence only. TMDB supplies the copy.
  return overview?.trim().match(/^.{10,280}?[.!?](?=\s|$)/s)?.[0];
}

export class TmdbClient {
  private retryUntil = 0;
  private nextRequest = 0;
  private requestGate = Promise.resolve();

  constructor(private readonly token: string, private readonly fetcher = fetch, private readonly now = () => new Date()) {}

  private async get<T extends z.ZodType>(path: string, parameters: Record<string, string>, schema: T): Promise<z.output<T> | undefined> {
    if (this.now().getTime() < this.retryUntil) throw new TmdbError("limited");
    const turn = this.requestGate.then(async () => {
      const wait = this.nextRequest - Date.now();
      if (wait > 0) await delay(wait);
      if (this.now().getTime() < this.retryUntil) throw new TmdbError("limited");
      this.nextRequest = Date.now() + 250;
    });
    this.requestGate = turn.catch(() => undefined);
    await turn;
    const url = new URL("https://api.themoviedb.org/3/" + path);
    url.search = new URLSearchParams({ language: "fr-FR", ...parameters }).toString();
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { Authorization: "Bearer " + this.token, Accept: "application/json" },
        signal: AbortSignal.timeout(5000), redirect: "error",
      });
    } catch {
      throw new TmdbError("offline");
    }
    if (response.status === 429) {
      const retry = response.headers.get("retry-after");
      const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry ?? "") - this.now().getTime();
      this.retryUntil = this.now().getTime() + Math.max(1000, Number.isFinite(delay) ? delay : 60_000);
      throw new TmdbError("limited");
    }
    if ([401, 403].includes(response.status)) throw new TmdbError("unauthorized");
    if (response.status === 404 && /^movie\/\d+$/.test(path)) return;
    if (!response.ok) throw new TmdbError("unavailable");
    try {
      return schema.parse(await response.json());
    } catch {
      throw new TmdbError("unavailable");
    }
  }

  private async list(path: string, parameters: Record<string, string>) {
    const result = results.parse(await this.get(path, parameters, results));
    return result.results.flatMap((row) => {
      const parsed = listing.safeParse(row);
      return parsed.success && !parsed.data.adult ? [parsed.data] : [];
    });
  }

  async discover(criteria: Criteria, round: number) {
    const batches = await Promise.all(discoveryQueries(criteria, round, this.now().getUTCFullYear())
      .map((parameters) => this.list("discover/movie", parameters)));
    const ids = new Set<number>();
    for (let i = 0; i < 20; i++) for (const batch of batches) {
      if (batch[i]) ids.add(batch[i].id);
    }
    return [...ids];
  }

  async findImdb(imdbId: string) {
    if (!/^tt\d+$/.test(imdbId)) return;
    const response = await this.get("find/" + imdbId, { external_source: "imdb_id" },
      z.object({ movie_results: z.array(listing) }));
    const films = response?.movie_results.filter(({ adult }) => !adult);
    return films?.length === 1 ? films[0].id : undefined;
  }

  async matchProfileFilm(titles: string[], year: number, shouldPause: () => boolean) {
    const keys = new Set(titles.map(normalizeTitle));
    const possible = new Set<number>();
    const exact = new Set<number>();
    for (const title of [...new Map(titles.map((name) => [normalizeTitle(name), name])).values()].slice(0, 3)) {
      if (shouldPause()) return;
      const rows = await this.list("search/movie", { query: title, include_adult: "false" });
      for (const row of rows) {
        const releaseYear = yearOf(row.release_date);
        if (releaseYear !== undefined && Math.abs(releaseYear - year) > 1) continue;
        possible.add(row.id);
        if ([row.title, row.original_title].some((name) => name && keys.has(normalizeTitle(name)))) exact.add(row.id);
      }
      if (exact.size > 1 || possible.size > 4) return;
    }

    let match: TmdbFilm | undefined;
    for (const id of possible) {
      if (shouldPause()) return;
      const film = await this.film(id);
      if (!film || ![film.title, film.originalTitle, ...film.aliases].some((name) => name && keys.has(normalizeTitle(name)))) continue;
      if (match) return;
      match = film;
    }
    if (match && match.year !== undefined && (match.year === year || match.releaseYears.includes(year))) return match;
  }

  async film(id: number): Promise<TmdbFilm | undefined> {
    const movie = await this.get("movie/" + id, { append_to_response: "credits,keywords,alternative_titles,release_dates" }, details);
    if (!movie || movie.adult || movie.id !== id) return;
    const valid = (value: string | null | undefined, regex: RegExp) => value && regex.test(value) ? value : undefined;
    return {
      tmdbId: id, title: movie.title, originalTitle: movie.original_title || undefined,
      year: yearOf(movie.release_date), imdbId: valid(movie.imdb_id, /^tt\d+$/),
      aliases: [...new Set((movie.alternative_titles?.titles ?? []).map(({ title }) => title.trim()).filter(Boolean))],
      releaseYears: [...new Set([
        yearOf(movie.release_date),
        ...(movie.release_dates?.results.flatMap(({ release_dates }) => release_dates
          .filter(({ type }) => type >= 1 && type <= 3).map(({ release_date }) => yearOf(release_date))) ?? []),
      ].filter((year): year is number => year !== undefined))].sort((a, b) => a - b),
      fetchedAt: this.now().toISOString(),
      metadata: {
        minutes: movie.runtime && movie.runtime > 0 ? movie.runtime : undefined,
        genres: [...new Set(movie.genres?.map(({ name }) => name))],
        countries: [...new Set(movie.production_countries?.map(({ iso_3166_1 }) => iso_3166_1).filter((code) => /^[A-Z]{2}$/.test(code)))].slice(0, 20),
        language: valid(movie.original_language, /^[a-z]{2}$/),
        directors: [...new Set(movie.credits?.crew.filter(({ job }) => job === "Director").map(({ name }) => name))],
        keywords: [...new Set(movie.keywords?.keywords.map(({ name }) => name))],
        synopsis: synopsis(movie.overview), poster: valid(movie.poster_path, /^\/[A-Za-z0-9_-]+\.jpg$/),
        popularity: movie.popularity,
        release: {
          source: "TMDB", primaryDate: movie.release_date, status: movie.status, runtime: movie.runtime,
          genres: movie.genres, keywords: movie.keywords?.keywords,
          events: movie.release_dates?.results.flatMap(({ iso_3166_1, release_dates }) =>
            release_dates.map(({ release_date, type }) => ({ country: iso_3166_1, date: release_date, type }))),
        },
      },
    };
  }
}
