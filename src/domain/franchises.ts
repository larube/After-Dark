import { tmdbCollectionSchema } from "../shared/franchises";

// Collection groups are catalogue metadata. Blocking is a separate, opt-in local preference.
export const franchiseGroups = [
  { key: "harry-potter", name: "Harry Potter", collections: [1241], films: [671, 672, 673, 674, 675, 767, 12444, 12445] },
  // MonsterVerse crossovers are explicit film IDs. Kong's solo films are outside this group.
  { key: "godzilla", name: "Godzilla", collections: [374509, 374511, 374512, 535790],
    films: [1678, 929, 124905, 373571, 315011, 399566, 823464, 940721] },
];

export function filmFranchise({ tmdbId, metadata }: { tmdbId: number | null; metadata: Record<string, unknown> | null }) {
  if (!tmdbId) return;
  const tmdb = metadata?.tmdb;
  const data = tmdb && typeof tmdb === "object" && "source" in tmdb && tmdb.source === "TMDB" && "data" in tmdb
    ? tmdb.data : undefined;
  const membership = tmdbCollectionSchema.safeParse(data && typeof data === "object" && "collection" in data
    ? data.collection : null);
  const collection = membership.success ? membership.data : undefined;
  const group = franchiseGroups.find(({ collections, films }) =>
    films.includes(tmdbId) || (collection && collections.includes(collection.id)));
  return group ?? (collection ? { key: `collection:${collection.id}`, name: collection.name } : undefined);
}
