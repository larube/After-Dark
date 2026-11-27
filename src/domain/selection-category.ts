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

function hasGenre(film: Film, genre: { ids: number[]; names: string[] }) {
  const raw = film.metadata.release?.genres ?? [];
  return raw.some(({ id }) => id !== undefined && genre.ids.includes(id)) ||
    [...film.metadata.genres, ...raw.map(({ name }) => name)].some((name) => genre.names.includes(normalizeTitle(name)));
}

const familyGenre = { ids: [10751], names: ["family", "familial", "famille"] };
const crimeOrMystery = { ids: [80, 9648], names: ["crime", "mystery", "mystere"] };
const youthKeywords = new Set(["cartoon", "cartoon dog", "talking dog", "horror for children"]);

export function selectionGenreExclusions(film: Film, category: SelectionCategory, tagsOnly = false): { genre: boolean; familyHorror?: true } {
  const genre = selectionGenre(category);
  if (!genre) return { genre: false };
  const tagged = hasGenre(film, genre);
  if (tagsOnly || (category !== "horror" && category !== "thriller")) return { genre: !tagged };

  if (category === "horror" ? !tagged : tagged) return { genre: !tagged };
  const keywords = new Set([...film.metadata.keywords, ...(film.metadata.release?.keywords ?? []).map(({ name }) => name)]
    .map(normalizeTitle));
  if (category === "thriller") {
    const corroborated = keywords.has("psychological thriller") && hasGenre(film, crimeOrMystery);
    return { genre: !corroborated };
  }

  // Family and a separate youth marker must agree. Animation alone never determines eligibility.
  if (hasGenre(film, familyGenre) && !keywords.has("adult animation") &&
    [...keywords].some((keyword) => youthKeywords.has(keyword))) return { genre: false, familyHorror: true };
  return { genre: false };
}

export function matchesSelectionGenre(film: Film, category?: SelectionCategory, tagsOnly = false) {
  return !category || !Object.values(selectionGenreExclusions(film, category, tagsOnly)).some(Boolean);
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

export type EditorialPolicy = Readonly<{
  classics: Readonly<{ bonusScale: number; period: "current" | "admit" | "half" | "none" | "no-decade" }>;
  gems: Readonly<{ minimumAffinity: number | null; affinityScale?: number }>;
}>;

export type EditorialExperiment = Partial<EditorialPolicy>;

export const previousEditorialPolicy: EditorialPolicy = {
  classics: { bonusScale: 1, period: "current" },
  gems: { minimumAffinity: 1 },
};

export const productionEditorialPolicy: EditorialPolicy = {
  classics: { bonusScale: 0.25, period: "admit" },
  gems: { minimumAffinity: 0.8 },
};

export function categoryEvidence(category: SelectionCategory | undefined, film: Film, referenceDate: string,
  reputation: number, affinity: number, lessExposedThan: number | undefined, policy: EditorialPolicy) {
  const supported = (film.metadata.reputation?.count ?? 0) >= reputationPriorVotes;
  if (category === "classics") {
    const established = film.year !== null && film.year > 0 && Number(referenceDate.slice(0, 4)) - film.year >= classicMinimumAge;
    const checks = { established, votes: supported, reputation: reputation >= 1.5 };
    return { accepted: Object.values(checks).every(Boolean), checks, boost: reputation * policy.classics.bonusScale,
      reason: "Film sorti depuis au moins dix ans, avec des avis TMDB favorables et suffisamment nombreux." };
  }
  if (category === "gems") {
    const checks = { votes: supported, reputation: reputation > 0, affinity: policy.gems.minimumAffinity === null || affinity >= policy.gems.minimumAffinity, popularity: (lessExposedThan ?? 0) >= 0.5 };
    return { accepted: Object.values(checks).every(Boolean), checks,
      boost: lessExposedThan ?? 0,
      reason: "Popularité TMDB dans la moitié basse du vivier renseigné, avec des avis favorables et des signaux personnels positifs." };
  }
  return { accepted: true, boost: 0 };
}
