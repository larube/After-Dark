import { uniqueFeatures, type buildAffinity, type catalogueFrequency } from "./affinity";
import type { Film } from "./recommendation";

export const calibrationProtocol = "discovery-calibration-v1";
export type DiscoveryOptions = { calibrated?: boolean; lessIndianCinema?: boolean; preferFrUs1960To1979?: boolean };

export function calibratedContributions(film: Film, traits: ReturnType<typeof buildAffinity>,
  frequency: ReturnType<typeof catalogueFrequency>) {
  const available = uniqueFeatures(film.metadata);
  const counts = new Map<string, number>();
  for (const { key } of available) counts.set(key, (counts.get(key) ?? 0) + 1);
  return available.flatMap(({ key, id, label, weight }) => {
    const trait = traits.get(id);
    if (!trait) return [];
    const documentCount = frequency.counts.get(id) ?? 0;
    const specificity = 1 - documentCount / Math.max(1, frequency.total);
    // Each family has a fixed budget. The denominator counts unmatched metadata too.
    const familySize = counts.get(key) ?? 1;
    const contribution = weight * trait.sum / (trait.count + 2) * specificity / familySize;
    return [{ key, id, label, contribution }];
  });
}

export function productionPreferences(film: Film) {
  const countries = film.metadata.countries.map((country) => country.trim().toUpperCase())
    .filter((country) => /^[A-Z]{2}$/.test(country));
  return {
    indian: countries.includes("IN"),
    other1960To1979: film.year !== null && film.year >= 1960 && film.year <= 1979
      && countries.length > 0 && !countries.some((country) => country === "FR" || country === "US"),
  };
}
