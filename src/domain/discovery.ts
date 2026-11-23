import { createHash } from "node:crypto";
import type { DiscoveryFilm, DiscoveryMode } from "../shared/discovery";
import { affinityDetails, buildAffinity, catalogueFrequency, features } from "./affinity";
import { eligible, type Film, type Signal } from "./recommendation";

export const discoveryProtocol = "discovery-v2";
export const discoverySize = 8;
export const discoveryHistorySize = 3;
export const discoveryHash = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");

export type Rotation = { previous: number[][]; adjacent: number[] };
export type DiscoverySnapshot = Omit<DiscoveryFilm, "posterData"> & { poster?: string };

const criteria: Parameters<typeof eligible>[1] = {
  mood: "surprise", requiredCountries: [], requiredLanguages: [], preferredCountries: [], preferredLanguages: [],
};

const decade = (year: Film["year"]) => year ? Math.floor(year / 10) * 10 : null;

export function discoveryPool(catalogue: Film[], excluded: ReadonlySet<number>, referenceDate: string) {
  return catalogue.filter((film) => !excluded.has(film.id) && eligible(film, criteria, { referenceDate }));
}

function rankCandidates(pool: Film[], signals: Signal[], mode: DiscoveryMode, rotation: Rotation, seed: string) {
  const traits = buildAffinity(signals);
  const frequency = catalogueFrequency(pool);
  const popularities = pool.flatMap(({ metadata }) => metadata.popularity ?? []).sort((a, b) => a - b);
  const percentiles = new Map(popularities.map((value, index) => [value, (index + 1) / popularities.length]));
  const otherModes = new Set(rotation.adjacent);
  const knownDecades = new Set(signals.flatMap(({ film }) => decade(film.year) ?? []));

  return pool.map((film) => {
    const { metadata, year, id } = film;
    // The production model supplies the trait contributions. Discovery budgets keyword evidence separately.
    const affinity = affinityDetails(film, traits);
    const core = affinity.matches.filter(({ key }) => key !== "keyword");
    const keywords = affinity.matches.filter(({ key }) => key === "keyword")
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3);
    const sum = [...core, ...keywords].reduce((total, { contribution }) => total + contribution, 0);
    const fit = Math.max(-4, Math.min(4, sum));
    const positive = [...core, ...keywords].filter(({ contribution }) => contribution > .08)
      .sort((a, b) => (b.contribution * specificity(b.id)) - (a.contribution * specificity(a.id)));
    function specificity(trait: string) {
      return 1 - .5 * (frequency.counts.get(trait) ?? 0) / pool.length;
    }
    const evidence = Math.min(2, positive.reduce((total, item) => total + item.contribution * specificity(item.id), 0));
    const formatTraits = features(metadata).filter(({ key }) => key !== "keyword");
    const newTraits = formatTraits.filter(({ id }) => !traits.has(id));
    const period = decade(year);
    const newDecade = traits.size > 0 && knownDecades.size > 0 && period !== null && !knownDecades.has(period);
    const distance = formatTraits.length && traits.size
      ? newTraits.length / Math.max(3, formatTraits.length) : 0;
    const popularity = metadata.popularity === undefined ? undefined : percentiles.get(metadata.popularity);
    const hidden = popularity === undefined ? .5 : 1 - popularity;
    const rotationTier = rotation.previous.findIndex((ids) => ids.includes(id));
    const affinityReason = positive.length ? `Traits associés à vos appréciations positives : ${positive.slice(0, 2).map(traitLabel).join(", ")}.` : "";
    const scores = {
      gems: .6 * fit + 2.2 * hidden,
      affinities: fit + .65 * evidence,
      offbeat: .65 * Math.min(1.3, fit) + 1.8 * distance + .45 * Number(newDecade),
    };
    const reasons = {
      gems: popularity !== undefined && popularity <= .5
        ? `Popularité TMDB dans la moitié basse des films renseignés.${affinityReason ? " " + affinityReason : ""}`
        : affinityReason,
      affinities: affinityReason,
      offbeat: newTraits.length && traits.size
        ? `À explorer : ${newTraits.slice(0, 2).map(traitLabel).join(", ")}, des repères absents de vos retours.`
        : newDecade ? `Une décennie peu représentée dans vos retours : les années ${period}.` : affinityReason,
    };
    const tie = discoveryHash([seed, id]);
    const priorityFallback = mode === "affinities" ? fit <= .08 || !positive.length : mode === "gems" && fit < 0;
    const qualityTier = fit < -1 ? 2 : Number(priorityFallback);
    return {
      film, fit, popularity, tier: rotationTier + 1, crossMode: Number(otherModes.has(id)),
      preferenceTier: mode === "affinities" ? Number(fit <= .08) : mode === "gems" ? Number(fit < 0) : Number(fit < -.5),
      qualityTier,
      score: scores[mode], jitter: parseInt(tie.slice(0, 8), 16) / 0xffffffff * .32, tie,
      reason: reasons[mode] || (mode === "gems" && popularity === undefined
        ? "Popularité TMDB inconnue. Le film reste admissible dans la sélection."
        : "Une proposition du catalogue local sans lien positif assez marqué à afficher."),
    };
  });
}

const regions = new Intl.DisplayNames(["fr"], { type: "region" });
const traitLabel = ({ key, label }: { key: string; label: string }) =>
  key === "country" && /^[A-Z]{2}$/.test(label) ? regions.of(label) ?? label : label;
type Ranked = ReturnType<typeof rankCandidates>[number];

function similarity(candidate: Film, selected: Film) {
  const overlap = (a: string[], b: string[]) => a.some((item) => b.includes(item));
  const a = candidate.metadata;
  const b = selected.metadata;
  return .45 * Number(overlap(a.genres, b.genres)) + .85 * Number(overlap(a.directors, b.directors)) +
    .45 * Number(overlap(a.countries, b.countries)) + .35 * Number(decade(candidate.year) !== null && decade(candidate.year) === decade(selected.year));
}

function diversify(ranked: Ranked[], mode: DiscoveryMode) {
  const selected: Ranked[] = [];
  const pending = ranked.map((item) => ({ item, overlap: 0 }));
  const penalty = { gems: .73, affinities: .53, offbeat: .91 }[mode];
  const noveltyAllowance = .48; // Same score budget as the existing cross-mode novelty penalty.
  const rotationPriority = (tier: number) => tier === 0 ? 0 : discoveryHistorySize + 1 - tier;
  type Pending = typeof pending[number];
  const value = ({ item, overlap }: Pending) => item.score - noveltyAllowance * item.crossMode
    - penalty * overlap - .9 * item.preferenceTier;
  function compare(a: Pending, b: Pending) {
    return rotationPriority(a.item.tier) - rotationPriority(b.item.tier) ||
      (value(b) + b.item.jitter) - (value(a) + a.item.jitter) ||
      a.item.tie.localeCompare(b.item.tie, "en") || a.item.film.id - b.item.film.id;
  }
  const hasRecentCandidates = ranked.some(({ tier }) => tier > 0);
  while (selected.length < discoverySize && pending.length) {
    let bestTier = Infinity;
    let bestValue = -Infinity;
    for (const candidate of pending) {
      const { qualityTier } = candidate.item;
      if (qualityTier < bestTier) {
        bestTier = qualityTier;
        bestValue = value(candidate);
      } else if (qualityTier === bestTier) {
        bestValue = Math.max(bestValue, value(candidate));
      }
    }
    let best = -1;
    for (const [index, candidate] of pending.entries()) {
      if (candidate.item.qualityTier !== bestTier) continue;
      // Apply recent-history priority only among comparable candidates.
      if (hasRecentCandidates && value(candidate) < bestValue - noveltyAllowance) continue;
      if (best === -1 || compare(candidate, pending[best]) < 0) best = index;
    }
    const [{ item }] = pending.splice(best, 1);
    selected.push(item);
    for (const candidate of pending) candidate.overlap = Math.max(candidate.overlap, similarity(candidate.item.film, item.film));
  }
  return selected;
}

export function explore(catalogue: Film[], signals: Signal[], excluded: ReadonlySet<number>, mode: DiscoveryMode,
  rotation: Rotation, seed: string, referenceDate: string) {
  const pool = discoveryPool(catalogue, excluded, referenceDate);
  const selected = diversify(rankCandidates(pool, signals, mode, rotation, seed), mode);
  return {
    eligible: pool.length,
    renewed: rotation.previous.length ? selected.filter(({ film }) => !rotation.previous[0].includes(film.id)).length : null,
    selected,
  };
}

export function discoverySnapshot({ film, reason }: Ranked): DiscoverySnapshot {
  const { id, title, year, metadata } = film;
  const { minutes, genres, synopsis, poster } = metadata;
  return { id, title, year, minutes, genres: genres.slice(0, 3), synopsis, poster, reason };
}
