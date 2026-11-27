import type { Criteria } from "../shared/recommendation";
import type { Film } from "./recommendation";

const composition = {
  fromYear: 1980,
  oldTarget: 2,
  countryTarget: 2,
} as const;

const knownYear = (year: Film["year"]): year is number => year !== null && Number.isInteger(year) && year > 0;
const countries = (film: Film) => [...new Set(film.metadata.countries)];

export function compositionWinner<T extends { candidate: { film: Film }; score: number }>(
  ranking: readonly T[], selected: readonly { film: Film }[], criteria: Criteria, scoreTolerance: number,
) {
  const leader = ranking[0];
  if (!leader || selected.length === 0) return 0;
  const requested = new Set([...criteria.preferredCountries, ...criteria.requiredCountries]);
  const shares = new Map<string, number>();
  for (const { film } of selected) {
    const codes = countries(film);
    for (const code of codes) shares.set(code, (shares.get(code) ?? 0) + 1 / codes.length);
  }
  const lateEnough = (film: Film) => knownYear(film.year) && film.year >= composition.fromYear;
  const isOlder = (film: Film) => knownYear(film.year) && film.year < composition.fromYear;
  const oldTargetMet = selected.filter(({ film }) => isOlder(film)).length >= composition.oldTarget;
  const comparable = ranking.filter(({ score }) => score >= leader.score - scoreTolerance);
  const preferModern = oldTargetMet && isOlder(leader.candidate.film) &&
    comparable.some(({ candidate }) => lateEnough(candidate.film));
  const concentration = (film: Film) => {
    const codes = countries(film);
    return codes.reduce((total, code) => {
      if (requested.has(code)) return total;
      const current = shares.get(code) ?? 0;
      return total + Math.max(0, current + 1 / codes.length - composition.countryTarget) -
        Math.max(0, current - composition.countryTarget);
    }, 0);
  };
  // Unknown locations cannot provide evidence of geographic diversification.
  const countryKnown = countries(leader.candidate.film).length > 0;
  const excess = countryKnown ? concentration(leader.candidate.film) : 0;
  let best = 0;
  let bestExcess = excess;
  for (const [index, { candidate: { film } }] of comparable.entries()) {
    if (preferModern && !lateEnough(film)) continue;
    if (isOlder(film) && !isOlder(leader.candidate.film)) continue;
    const nextExcess = countries(film).length ? concentration(film) : excess;
    if ((preferModern && best === 0) || nextExcess < bestExcess - 1e-9) {
      best = index;
      bestExcess = nextExcess;
    }
  }
  return best;
}
