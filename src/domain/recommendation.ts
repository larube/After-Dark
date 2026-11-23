import type { Criteria, Metadata, Recommendation } from "../shared/recommendation";
import { classifyContent, todayUtc, type CandidatePolicy } from "./candidate-quality";
import { normalizeTitle } from "./ratings";

import { affinityDetails, buildAffinity, catalogueFrequency, features, type AffinityModel } from "./affinity";
export { affinityFor, buildAffinity, qualitativeWeights } from "./affinity";

export const engineVersion = "1.2.0";
export type Film = {
  id: number; title: string; year: number | null; metadata: Metadata;
  status?: "seen" | "unseen" | "unknown";
};
export type Signal = {
  film: Film;
  ratings: { numeric?: number; qualitative?: string }[];
  spontaneous: boolean; memorable: boolean; rewatch: boolean;
};

const moodGenres = {
  laugh: ["comedie", "comedy"],
  tension: ["thriller", "crime", "mystere", "mystery"],
  strange: ["horreur", "horror", "fantastique", "fantasy"],
  emotion: ["drame", "drama", "romance"],
  immersion: ["aventure", "adventure", "science fiction", "guerre", "war"],
};
const moodKeywords = {
  laugh: ["dark comedy", "satire", "absurd humor"],
  tension: ["suspense", "psychological thriller", "paranoia"],
  strange: ["surrealism", "body horror", "absurdism"],
  emotion: ["grief", "friendship", "family relationships"],
  immersion: ["survival", "epic", "space travel"],
};

function moodEvidence(metadata: Metadata, mood: keyof typeof moodGenres) {
  const genres = metadata.genres.filter((genre) => moodGenres[mood].includes(normalizeTitle(genre)));
  const keywords = metadata.keywords.filter((keyword) => moodKeywords[mood].includes(normalizeTitle(keyword)));
  return { weight: Math.min(4, genres.length * 2 + keywords.length * 3), labels: [...keywords, ...genres] };
}

function eligibility(film: Film, criteria: Criteria) {
  const { countries, language, minutes } = film.metadata;
  return {
    seen: film.status === "seen",
    country: !!criteria.requiredCountries.length && !countries.some((country) => criteria.requiredCountries.includes(country)),
    language: !!criteria.requiredLanguages.length && (language === undefined || !criteria.requiredLanguages.includes(language)),
    duration: criteria.maxMinutes !== undefined && (minutes === undefined || !(minutes <= criteria.maxMinutes)),
  };
}

function candidateEligibility(film: Film, criteria: Criteria, policy: CandidatePolicy) {
  const quality = classifyContent(film.metadata, policy.referenceDate);
  const content = policy.mode !== "legacy" && quality.exclusionReasons.length > 0;
  return { quality, causes: { ...eligibility(film, criteria), content } };
}

export function eligible(film: Film, criteria: Criteria, policy: CandidatePolicy = { referenceDate: todayUtc() }) {
  return !Object.values(candidateEligibility(film, criteria, policy).causes).some(Boolean);
}

function scoreFilm(film: Film, criteria: Criteria, traits: ReturnType<typeof buildAffinity>, model: AffinityModel, frequency?: ReturnType<typeof catalogueFrequency>) {
  const { metadata } = film;
  const affinity = affinityDetails(film, traits, model, frequency);
  const mood = criteria.mood === "surprise" ? undefined : moodEvidence(metadata, criteria.mood);
  const avoided = criteria.avoid ? moodEvidence(metadata, criteria.avoid) : undefined;
  const preferredCountry = metadata.countries.some((code) => criteria.preferredCountries.includes(code));
  const preferredLanguage = !!metadata.language && criteria.preferredLanguages.includes(metadata.language);
  const duration = metadata.minutes;
  const energy = criteria.energy === "low" && duration !== undefined ? duration <= 100 ? 0.7 : duration > 135 ? -0.7 : 0 : 0;
  const exploration = metadata.popularity === undefined ? 0 : 1 / (1 + metadata.popularity / 10);
  const reasons = [
    ...(criteria.mood === "surprise" && exploration >= 0.5 ? ["Popularité TMDB modérée, favorisée en mode Surprends-moi."] : []),
    ...(mood?.labels.length ? [`Indices pour ce mood dans les métadonnées : ${mood.labels.join(", ")}.`] : []),
    ...(affinity.positive.length ? [`Traits associés à vos appréciations positives : ${affinity.positive.join(", ")}.`] : []),
    ...(preferredCountry ? ["Pays de production parmi vos préférences."] : []),
    ...(preferredLanguage ? ["Langue originale parmi vos préférences."] : []),
    ...(energy > 0 ? ["Durée courte pour une soirée à faible énergie."] : []),
  ];
  const warnings = [
    ...(avoided?.weight ? [`Moins prioritaire : indices de l’ambiance que vous préférez éviter (${avoided.labels.join(", ")}).`] : []),
    ...(mood && !mood.weight ? ["Les métadonnées donnent peu d’indices sur le mood demandé."] : []),
    ...(energy < 0 ? ["Séance longue pour une soirée à faible énergie."] : []),
    ...(affinity.negative.length ? [`Traits associés aussi à des appréciations négatives : ${affinity.negative.join(", ")}.`] : []),
  ];
  const contributions = {
    affinity: affinity.score * 1.6, mood: (mood?.weight ?? 0) * 1.4,
    country: Number(preferredCountry) * 1.4, language: Number(preferredLanguage) * 1.2,
    energy, avoided: -(avoided?.weight ?? 0) * 1.5,
    exploration: exploration * (criteria.mood === "surprise" ? 1.5 : 0.5),
  };
  return {
    film, affinity: affinity.score, exploration, reasons, warnings,
    details: { affinity, contributions, mood, avoided },
    score: contributions.affinity + contributions.mood + contributions.country
      + contributions.language + energy + contributions.avoided + contributions.exploration,
    traits: new Set(features(metadata).map((feature) => feature.id)),
  };
}

type Ranked = ReturnType<typeof scoreFilm>;
function diversityPenalty(candidate: Ranked, selected: Ranked[]) {
  return Math.max(0, ...selected.map((film) => {
    const overlap = [...candidate.traits].filter((trait) => film.traits.has(trait)).length;
    const sameLanguage = !!candidate.film.metadata.language && candidate.film.metadata.language === film.film.metadata.language;
    return overlap / Math.max(1, Math.min(candidate.traits.size, film.traits.size)) * 3 + Number(sameLanguage) * 0.6;
  }));
}

type Category = Recommendation["films"][number]["category"];
type Step = {
  category: Category;
  ranking: { id: number; rank: number; bonus: number; penalty: number; score: number }[];
};

function runRecommendation(catalogue: Film[], signals: Signal[], criteria: Criteria, recent: ReadonlySet<number>,
  policy: CandidatePolicy,
  model: AffinityModel,
  trace?: { base: Ranked[]; steps: Step[]; candidates: ReturnType<typeof candidateEligibility>[] },
) {
  const traits = buildAffinity(signals, undefined, model !== "current");
  const frequency = model === "rarity" || model === "hybrid" ? catalogueFrequency(catalogue) : undefined;
  const candidates = catalogue.map((film) => candidateEligibility(film, criteria, policy));
  if (trace) trace.candidates = candidates;
  const eligibleFilms = catalogue.filter((_, index) => !Object.values(candidates[index].causes).some(Boolean));
  let ranked = eligibleFilms.filter((film) => !recent.has(film.id)).map((film) => scoreFilm(film, criteria, traits, model, frequency));
  if (trace) trace.base = [...ranked].sort((a, b) => b.score - a.score || a.film.id - b.film.id);
  const selected: Ranked[] = [];
  const films: Recommendation["films"] = [];
  const categories = ["safe", "gem", "wildcard", "safe", "gem"] as const;
  for (const category of categories) {
    const ranking = ranked.map((candidate) => {
      const penalty = diversityPenalty(candidate, selected);
      const bonus = category === "gem" ? candidate.exploration * 2
        : category === "wildcard" ? -Math.max(0, candidate.affinity) * 0.6 : candidate.affinity;
      return { candidate, penalty, bonus, score: candidate.score - penalty + bonus };
    }).sort((a, b) => b.score - a.score || a.candidate.film.id - b.candidate.film.id);
    if (trace && ranking.length) trace.steps.push({
      category, ranking: ranking.map(({ candidate, ...value }, index) => ({ id: candidate.film.id, rank: index + 1, ...value })),
    });
    const winner = ranking.shift();
    if (!winner) break;
    const { candidate } = winner;
    ranked = ranking.map((row) => row.candidate);
    selected.push(candidate);
    const { status: _status, ...film } = candidate.film;
    void _status;
    const reasons = [...candidate.reasons];
    if (category === "gem" && candidate.exploration >= 0.5) reasons.push("Popularité TMDB modérée, favorisée pour la découverte.");
    if (category === "wildcard" && selected.length > 1) reasons.push("Proposition choisie aussi pour varier la sélection.");
    if (!reasons.length) reasons.push("Film disponible dans le catalogue et compatible avec les filtres obligatoires.");
    films.push({ ...film, category, reasons, warnings: candidate.warnings });
  }
  const status = films.length ? "ready" : !catalogue.some((film) => film.status !== "seen")
    ? "empty" : eligibleFilms.length ? "exhausted" : "no-match";
  return { films, personalized: selected.some((candidate) => candidate.affinity !== 0), status } as const;
}

export function recommend(catalogue: Film[], signals: Signal[], criteria: Criteria, recent: ReadonlySet<number>,
  policy: CandidatePolicy = { referenceDate: todayUtc() }, model: AffinityModel = "current") {
  return runRecommendation(catalogue, signals, criteria, recent, policy, model);
}

export function diagnoseRecommendation(catalogue: Film[], signals: Signal[], criteria: Criteria, recent: ReadonlySet<number>,
  policy: CandidatePolicy = { referenceDate: todayUtc() }, model: AffinityModel = "current") {
  const trace: { base: Ranked[]; steps: Step[]; candidates: ReturnType<typeof candidateEligibility>[] } = { base: [], steps: [], candidates: [] };
  const result = runRecommendation(catalogue, signals, criteria, recent, policy, model, trace);
  return {
    result, steps: trace.steps,
    exclusions: catalogue.map((film, index) => {
      const { causes, quality } = trace.candidates[index];
      return { id: film.id, quality, causes: { ...causes, recent: recent.has(film.id) },
        excluded: Object.values(causes).some(Boolean) || recent.has(film.id) };
    }),
    base: trace.base.map(({ film, score, details, exploration, reasons, warnings }, index) => ({
      id: film.id, rank: index + 1, score, exploration, reasons, warnings, ...details,
      selectedRank: result.films.findIndex(({ id }) => id === film.id) + 1 || null,
    })),
  };
}

/** Descriptive holdout comparison. Held-out films become candidates only inside this evaluation. */
export function evaluateHoldout(catalogue: Film[], signals: Signal[], criteria: Criteria, heldOut: ReadonlySet<number>) {
  const { candidates, training } = holdoutInputs(catalogue, signals, heldOut);
  const result = recommend(candidates, training, criteria, new Set());
  const ranks = new Map(result.films.map(({ id }, index) => [id, index + 1]));
  return signals.filter(({ film }) => heldOut.has(film.id)).map(({ film, ratings }) => ({
    id: film.id, title: film.title, rank: ranks.get(film.id) ?? null, ratings,
  }));
}

export function holdoutInputs(catalogue: Film[], signals: Signal[], heldOut: ReadonlySet<number>) {
  const training = signals.filter(({ film }) => !heldOut.has(film.id));
  const candidates = catalogue.map((film) => heldOut.has(film.id) ? { ...film, status: "unknown" as const } : film);
  return { candidates, training };
}
