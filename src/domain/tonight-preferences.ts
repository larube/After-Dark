/** Soft selection defaults for Ce soir. Callers can supply a different policy or disable a preference. */
export type TonightPreferences = {
  period: {
    fromYear: number;
    penalty: number;
    maxExceptions: number;
    minimumAffinity: number;
    minimumReputationWithMood: number;
  } | null;
  composition?: "balanced";
  animationPenalty: number;
  repeatedDecadePenalty: number;
};

export const tonightDefaults: Readonly<TonightPreferences> = {
  period: { fromYear: 1970, penalty: 0.8, maxExceptions: 1, minimumAffinity: 2, minimumReputationWithMood: 2.5 },
  animationPenalty: 0.45,
  repeatedDecadePenalty: 0.35,
};

export const selectionPreferences: TonightPreferences = { ...tonightDefaults, composition: "balanced" };

export function decadeOf(year: number | null) {
  return year !== null && Number.isInteger(year) && year > 0 ? Math.floor(year / 10) * 10 : null;
}
