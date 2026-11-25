import { acquisitionPolicy as policy } from "./acquisition-policy";
import { signalValue } from "./affinity";
import type { Film, Signal } from "./recommendation";
import { normalizeTitle } from "./ratings";

type CachedMovie = { id: number; metadata: Record<string, unknown> | null };
type Support = { liked: Set<number>; disliked: number; sum: number };
export type AcquisitionProfile = { directors: number[]; keywords: number[] };

function keywords(film: Film) {
  return new Map((film.metadata.release?.keywords ?? []).flatMap(({ id, name }) =>
    id && id > 0 ? [[id, normalizeTitle(name)] as const] : []));
}

function directorIds(movie?: CachedMovie) {
  const cached = movie?.metadata?.tmdb;
  return cached && typeof cached === "object" && "directorIds" in cached && Array.isArray(cached.directorIds)
    ? [...new Set(cached.directorIds.filter((id): id is number => Number.isSafeInteger(id) && id > 0))] : [];
}

export function acquisitionProfile(catalogue: Film[], signals: Signal[], movies: CachedMovie[]): AcquisitionProfile {
  const directors = new Map<number, Support>();
  const themes = new Map<number, Support>();
  const known = new Map(movies.map((movie) => [movie.id, movie]));
  const frequency = new Map<number, number>();
  let documented = 0;
  for (const film of catalogue) {
    const tags = keywords(film);
    if (tags.size) documented++;
    for (const id of tags.keys()) frequency.set(id, (frequency.get(id) ?? 0) + 1);
  }
  const record = (table: Map<number, Support>, id: number, movieId: number, value: number) => {
    const entry = table.get(id) ?? { liked: new Set(), disliked: 0, sum: 0 };
    if (value > 0) entry.liked.add(movieId);
    if (value < 0) entry.disliked++;
    entry.sum += value;
    table.set(id, entry);
  };
  const generic = new Set<string>(policy.genericKeywords);
  for (const signal of signals) {
    const value = signalValue(signal);
    if (value === undefined || value === 0) continue;
    for (const id of directorIds(known.get(signal.film.id))) record(directors, id, signal.film.id, value);
    for (const [id, label] of keywords(signal.film)) {
      if (!generic.has(label) && (frequency.get(id) ?? 0) <= policy.maximumKeywordShare * documented) record(themes, id, signal.film.id, value);
    }
  }
  const ranked = (table: Map<number, Support>) => [...table]
    .filter(([, { liked, disliked, sum }]) => liked.size >= policy.minimumPositiveFilms && liked.size > disliked && sum >= policy.minimumNetSupport)
    .sort(([idA, a], [idB, b]) => b.sum - a.sum || idA - idB);
  const selected: number[] = [];
  const audiences: Set<number>[] = [];
  for (const [id, { liked }] of ranked(themes)) {
    if (audiences.some((other) => [...liked].filter((film) => other.has(film)).length >= policy.redundantKeywordOverlap * new Set([...liked, ...other]).size)) continue;
    selected.push(id);
    audiences.push(liked);
  }
  return { directors: ranked(directors).map(([id]) => id), keywords: selected };
}
