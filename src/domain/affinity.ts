import type { Metadata } from "../shared/recommendation";
import type { Film, Signal } from "./recommendation";
import { normalizeTitle } from "./ratings";

export function features(metadata: Metadata) {
  return [
    ...metadata.directors.map((label) => ({ key: "director", label, weight: 2.5 })),
    ...metadata.genres.map((label) => ({ key: "genre", label, weight: 1 })),
    ...metadata.countries.map((label) => ({ key: "country", label, weight: 0.7 })),
    ...metadata.keywords.map((label) => ({ key: "keyword", label, weight: 1.4 })),
  ].map((item) => ({ ...item, id: item.key + ":" + normalizeTitle(item.label) }));
}

// Ordered affinity weights, separate from the numerical rating scale.
export const qualitativeWeights: Readonly<Record<string, number>> = {
  deteste: -1, bof: -0.65, bien: 0.25, "beaucoup aime": 0.7, adore: 1,
};

export const affinityModels = ["current", "normalized", "rarity", "hybrid"] as const;
export type AffinityModel = typeof affinityModels[number];
type Trait = { sum: number; count: number; negativeCount?: number };

export function buildAffinity(signals: Signal[], qualitative = qualitativeWeights, trackNegative = false) {
  const traits = new Map<string, Trait>();
  for (const signal of signals) {
    const votes = signal.ratings.flatMap(({ numeric, qualitative: label }) => {
      if (numeric !== undefined) return [(numeric - 6) / (numeric >= 6 ? 4 : 6)];
      const weight = label && qualitative[normalizeTitle(label)];
      return typeof weight === "number" ? [weight] : [];
    });
    const favorites = Number(signal.spontaneous) * 0.45 + Number(signal.memorable) * 0.25 + Number(signal.rewatch) * 0.2;
    if (!votes.length && !favorites) continue;
    const value = (votes.length ? votes.reduce((sum, vote) => sum + vote, 0) / votes.length : 0) + favorites;
    for (const id of new Set(features(signal.film.metadata).map((feature) => feature.id))) {
      const previous = traits.get(id) ?? { sum: 0, count: 0 };
      traits.set(id, {
        sum: previous.sum + value, count: previous.count + 1,
        ...(trackNegative ? { negativeCount: (previous.negativeCount ?? 0) + Number(value < 0) } : {}),
      });
    }
  }
  return traits;
}

function uniqueFeatures(metadata: Metadata) {
  return [...new Map(features(metadata).map((feature) => [feature.id, feature])).values()];
}

export function catalogueFrequency(catalogue: Film[]) {
  const counts = new Map<string, number>();
  for (const { metadata } of catalogue) {
    for (const { id } of uniqueFeatures(metadata)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return { total: catalogue.length, counts };
}

export function rarityWeight(total: number, count: number) {
  return Math.log((total + 2) / (count + 1)) / Math.log(total + 2) * count / (count + 2);
}

export function affinityDetails(film: Film, traits: ReturnType<typeof buildAffinity>,
  model: AffinityModel = "current", frequency?: ReturnType<typeof catalogueFrequency>) {
  const available = uniqueFeatures(film.metadata);
  const familySizes = new Map<string, number>();
  if (model === "normalized" || model === "hybrid") {
    for (const { key } of available) familySizes.set(key, (familySizes.get(key) ?? 0) + 1);
  }
  const matches = available.flatMap((feature) => {
    const trait = traits.get(feature.id);
    if (!trait) return [];
    const baseContribution = trait.sum / (trait.count + 1) * feature.weight;
    const budget = feature.key === "keyword" ? 3 : 1;
    const normalization = 1 / Math.sqrt(Math.max(1, (familySizes.get(feature.key) ?? 0) / budget));
    const documentCount = frequency?.counts.get(feature.id) ?? 0;
    const rarity = frequency ? rarityWeight(frequency.total, documentCount) : 1;
    const negativeCount = trait.negativeCount ?? 0;
    const negativeConfidence = model !== "current" && baseContribution < 0 ? negativeCount / (negativeCount + 2) : 1;
    return [{
      ...feature, signalCount: trait.count, signalSum: trait.sum,
      contribution: baseContribution * normalization * rarity * negativeConfidence,
      ...(model === "current" ? {} : { baseContribution, normalization, rarity, documentCount, negativeCount, negativeConfidence }),
    }];
  }).sort((a, b) => b.contribution - a.contribution);
  const raw = matches.reduce((sum, feature) => sum + feature.contribution, 0);
  return {
    raw, matches, score: Math.max(-4, Math.min(4, raw)),
    positive: matches.filter((feature) => feature.contribution > 0.08).slice(0, 3).map((feature) => feature.label),
    negative: matches.filter((feature) => feature.contribution < -0.15).slice(-2).map((feature) => feature.label),
  };
}

export function affinityFor(film: Film, traits: ReturnType<typeof buildAffinity>) {
  const { score, positive, negative } = affinityDetails(film, traits);
  return { score, positive, negative };
}
