import type { CinemaDatabase } from "../db/client";
import { franchiseExclusions } from "../db/franchises";
import { cacheFilm, readCatalogue } from "../db/recommendations";
import type { Acquisition } from "../diagnostics/tonight";
import { acquisitionPolicy as policy, type AcquisitionStrategy } from "../domain/acquisition-policy";
import { acquisitionProfile } from "../domain/acquisition-profile";
import { tonightPool } from "../domain/recommendation";
import type { TonightPreferences } from "../domain/tonight-preferences";
import type { Criteria } from "../shared/recommendation";
import { acquisitionPlan, type AcquisitionQuery } from "./acquisition-plan";
import { discoveryQueries, TmdbClient, TmdbError } from "./tmdb";

export type AcquisitionBudget = Readonly<{ pages: number; details: number }>;

type Catalogue = Awaited<ReturnType<typeof readCatalogue>>;
const isFresh = (metadata: Record<string, unknown> | null, now: Date) => {
  const tmdb = metadata?.tmdb;
  return !!tmdb && typeof tmdb === "object" && "fetchedAt" in tmdb && typeof tmdb.fetchedAt === "string"
    && now.getTime() - Date.parse(tmdb.fetchedAt) < policy.freshnessMs;
};

export async function acquireTonight(db: CinemaDatabase, state: Catalogue, criteria: Criteria, recent: ReadonlySet<number>,
  round: number, now: Date, getClient: () => Promise<TmdbClient | undefined>, preferences?: TonightPreferences,
  options: { strategy?: AcquisitionStrategy; measure?: boolean; budget?: AcquisitionBudget } = {}) {
  const strategy = options.strategy ?? "baseline";
  const discoveryBudget = options.budget?.pages ?? policy.discoveryRequests;
  const detailBudget = options.budget?.details ?? policy.details;
  const observe = strategy === "profile" || options.measure !== false;
  const referenceDate = now.toISOString().slice(0, 10);
  let blocked = await franchiseExclusions(db, state.movies);
  const measure = () => tonightPool(state.catalogue, state.signals, criteria, recent, { referenceDate, excludedIds: blocked }, preferences);
  const report: Acquisition = { round, before: state.catalogue.length, after: state.catalogue.length, connection: "unconfigured",
    sources: [], discovered: [], lookups: [] };
  const before = observe ? measure() : undefined;
  let after = before;
  const attempted = new Set<number>();
  const considered = new Map<number, Acquisition["lookups"][number]["result"]>();
  let lists = 0;
  let stop: NonNullable<Acquisition["pool"]>["stop"] = "unconfigured";
  const local = new Map(state.movies.map((movie) => [movie.tmdbId, movie]));
  const films = new Map(state.catalogue.map((film) => [film.id, film]));
  let changed = false;
  const reload = async (force = false) => {
    if (!changed && !force) return;
    state = await readCatalogue(db);
    blocked = await franchiseExclusions(db, state.movies);
    if (observe) after = measure();
    changed = false;
  };

  try {
    const client = await getClient();
    if (client) {
      const rejectedAttribution = new Map<number, NonNullable<Awaited<ReturnType<TmdbClient["film"]>>>>();
      const sourceById = new Map<number, AcquisitionQuery[]>();
      const hydrate = async (ordered: Iterable<number>, detailsLimit: number) => {
        const queue = [...ordered].filter((id) => considered.get(id) === "over-budget").slice(0, detailsLimit);
        for (let index = 0; index < queue.length; index += policy.detailConcurrency) {
          const ids = queue.slice(index, index + policy.detailConcurrency);
          ids.forEach((id) => { attempted.add(id); considered.set(id, "interrupted"); });
          const batch = await Promise.allSettled(ids.map((id) => client.film(id)));
          for (const [offset, result] of batch.entries()) {
            const id = ids[offset];
            const sources = sourceById.get(id);
            const directorMatch = result.status === "fulfilled" && result.value && sources?.every(({ kind }) => kind === "director")
              ? sources.some(({ parameters }) => result.value?.directorIds?.includes(Number(parameters.with_crew))) : true;
            const outcome = result.status === "rejected" ? "failed" : !result.value ? "missing" : !directorMatch ? "director-mismatch"
              : await cacheFilm(db, result.value) ? "cached" : "unmatched";
            if (outcome === "director-mismatch" && result.status === "fulfilled" && result.value) rejectedAttribution.set(id, result.value);
            changed ||= outcome === "cached";
            considered.set(ids[offset], outcome);
          }
          const failed = batch.find((result) => result.status === "rejected");
          if (failed) throw failed.reason;
        }
        if (strategy === "profile") await reload();
      };
      const consider = (id: number) => {
        if (considered.has(id)) return;
        const movie = local.get(id);
        const film = movie && films.get(movie.id);
        const excluded = strategy === "profile" && film && (film.status === "seen" || film.dismissed || recent.has(film.id) || blocked.has(film.id));
        considered.set(id, excluded ? "excluded-local" : isFresh(movie?.metadata ?? null, now) ? "fresh-cache" : "over-budget");
      };

      if (strategy === "baseline") {
        const budget = options.budget && { pages: discoveryBudget, onAttempt: () => { lists++; } };
        if (!budget) lists = discoveryQueries(criteria, round, now.getUTCFullYear()).length;
        const ids = await client.discover(criteria, round, (source) => report.sources.push(source), now.getUTCFullYear(), budget);
        ids.forEach(consider);
        await hydrate(ids, detailBudget);
        await reload(true);
      } else {
        const plan = acquisitionPlan(criteria, acquisitionProfile(state.catalogue, state.signals, state.movies), round, now.getUTCFullYear());
        const batches: number[][] = [];
        const load = async (queries: AcquisitionQuery[]) => {
          for (const query of queries.slice(0, discoveryBudget - lists)) {
            const { kind, parameters, limit } = query;
            lists++;
            const page = await client.discoverPage(parameters);
            const forwarded = page.slice(0, limit);
            report.sources.push({ kind, parameters, listed: page.length, forwarded: forwarded.length, ids: forwarded });
            batches.push(forwarded);
            for (const id of new Set(forwarded)) {
              sourceById.set(id, [...sourceById.get(id) ?? [], query]);
              const saved = kind === "director" ? undefined : rejectedAttribution.get(id);
              if (saved) {
                const cached = await cacheFilm(db, saved);
                changed ||= cached;
                considered.set(id, cached ? "cached" : "unmatched");
                rejectedAttribution.delete(id);
              } else {
                consider(id);
              }
            }
          }
        };
        const ordered = () => new Set(Array.from({ length: policy.pageSize }, (_, index) =>
          batches.flatMap((batch) => batch[index] === undefined ? [] : [batch[index]])).flat());
        await load(plan.initial);
        await hydrate(ordered(), Math.min(policy.firstDetails, detailBudget));
        if (after!.afterRotation < policy.poolTarget) {
          await load(plan.reserve);
          await hydrate(ordered(), detailBudget - attempted.size);
        }
      }
      stop = strategy === "profile" && after!.afterRotation >= policy.poolTarget ? "target"
        : !attempted.size ? "no-new-candidates"
        : attempted.size === detailBudget || lists === discoveryBudget ? "budget"
        : after && before && after.afterRotation <= before.afterRotation ? "low-yield" : "plan-complete";
      report.connection = attempted.size ? "online" : "cached";
    }
  } catch (error) {
    if (!(error instanceof TmdbError)) throw error;
    report.connection = error.connection;
    stop = "tmdb-unavailable";
    await reload(strategy === "baseline");
  }
  if (strategy === "baseline" && report.connection === "unconfigured") await reload(true);
  report.after = state.catalogue.length;
  report.discovered = [...considered.keys()];
  report.lookups = [...considered].map(([tmdbId, result]) => ({ tmdbId, result }));
  if (before && after) report.pool = { strategy, before, after, target: policy.poolTarget, stop, discoveryRequests: lists, detailRequests: attempted.size };
  return { state, blocked, report };
}
