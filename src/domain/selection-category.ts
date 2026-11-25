import type { SelectionCategory } from "../shared/recommendation";
import type { Film } from "./recommendation";
import { normalizeTitle } from "./ratings";

export const reputationPriorVotes = 50;
export const classicMinimumAge = 10;

const genres = {
  comedy: { ids: [35], names: ["comedy", "comedie"] },
  thriller: { ids: [53], names: ["thriller"] },
  drama: { ids: [18], names: ["drama", "drame"] },
  horror: { ids: [27], names: ["horror", "horreur"] },
  scifi: { ids: [878, 14], names: ["science fiction", "fantasy", "fantastique"] },
};

export function selectionGenre(category?: SelectionCategory) {
  return category && category in genres ? genres[category as keyof typeof genres] : undefined;
}

export function matchesSelectionGenre(film: Film, category?: SelectionCategory) {
  const genre = selectionGenre(category);
  if (!genre) return true;
  const raw = film.metadata.release?.genres ?? [];
  return raw.some(({ id }) => id !== undefined && genre.ids.includes(id)) ||
    [...film.metadata.genres, ...raw.map(({ name }) => name)].some((name) => genre.names.includes(normalizeTitle(name)));
}

export function exposureRanks(films: Film[]) {
  const sorted = films.flatMap(({ id, metadata: { popularity } }) =>
    popularity === undefined ? [] : [{ id, popularity }]).sort((a, b) => a.popularity - b.popularity);
  const ranks = new Map<number, number>();
  let end = 0;
  for (const [index, { id, popularity }] of sorted.entries()) {
    if (index === end) {
      while (end < sorted.length && sorted[end].popularity === popularity) end++;
    }
    // Ties have the same rank. A film needs to be strictly less exposed than half the pool.
    ranks.set(id, (sorted.length - end) / sorted.length);
  }
  return ranks;
}

export function categoryEvidence(category: SelectionCategory | undefined, film: Film, referenceDate: string,
  reputation: number, affinity: number, lessExposedThan: number | undefined) {
  const supported = (film.metadata.reputation?.count ?? 0) >= reputationPriorVotes;
  if (category === "classics") {
    const established = film.year !== null && film.year > 0 && Number(referenceDate.slice(0, 4)) - film.year >= classicMinimumAge;
    return { accepted: established && supported && reputation >= 1.5, boost: reputation,
      reason: "Film sorti depuis au moins dix ans, avec des avis TMDB favorables et suffisamment nombreux." };
  }
  if (category === "gems") {
    return { accepted: supported && reputation > 0 && affinity >= 1 && (lessExposedThan ?? 0) >= 0.5,
      boost: lessExposedThan ?? 0,
      reason: "Popularité TMDB dans la moitié basse du vivier renseigné, avec des avis favorables et des signaux personnels positifs." };
  }
  return { accepted: true, boost: 0 };
}
