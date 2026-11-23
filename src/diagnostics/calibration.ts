import { calibrationProtocol, type DiscoveryOptions } from "../domain/discovery-calibration";
import { discoveryHash, discoverySize, inspectDiscoveryRanking, type Rotation } from "../domain/discovery";
import { assignBlindFilms } from "../domain/lab";
import { legacyEngineVersion as engineVersion, holdoutInputs, type Film, type Signal } from "../domain/recommendation";
import { discoveryModes, type DiscoveryMode } from "../shared/discovery";

const arms = ["A", "B", "C", "D"] as const;
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const ids = (result: ReturnType<typeof inspectDiscoveryRanking>) => result.selected.map(({ film }) => film.id);
type Dataset = {
  catalogue: Film[]; signals: Signal[]; excluded: ReadonlySet<number>;
  rotations: Record<DiscoveryMode, Rotation>;
};
export type Experiment = Dataset & { date: string; seed: string; preferences: DiscoveryOptions };
export function armOptions(arm: typeof arms[number], preferences: DiscoveryOptions): DiscoveryOptions {
  return {
    calibrated: arm === "C" || arm === "D",
    lessIndianCinema: (arm === "B" || arm === "D") && preferences.lessIndianCinema,
    preferFrUs1960To1979: (arm === "B" || arm === "D") && preferences.preferFrUs1960To1979,
  };
}

function run(input: Experiment, mode: DiscoveryMode, options: DiscoveryOptions, rotation = input.rotations[mode], seed = input.seed) {
  return inspectDiscoveryRanking(input.catalogue, input.signals, input.excluded, mode, rotation, seed, input.date, options);
}

function dispersion(values: number[]) {
  const average = mean(values);
  return { average, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null,
    stddev: average === null ? null : Math.sqrt(mean(values.map((value) => (value - average) ** 2))!),
    distinct: new Set(values).size };
}

function metrics(rows: ReturnType<typeof run>["ranked"]) {
  const absolute = (values: number[]) => values.reduce((total, value) => total + Math.abs(value), 0);
  const families = ["director", "genre", "country", "keyword"];
  const totals = families.map((key) => absolute(rows.flatMap(({ contributions }) => contributions
    .filter((item) => item.key === key).map(({ contribution }) => contribution))));
  const total = absolute(totals);
  return {
    size: rows.length, raw: dispersion(rows.map(({ raw }) => raw)),
    fit: dispersion(rows.map(({ fit }) => fit)), score: dispersion(rows.map(({ score }) => score)),
    saturatedFit: rows.filter(({ fit }) => Math.abs(fit) === 4).length,
    saturatedEvidence: rows.filter(({ factors }) => factors.evidence === 2).length,
    saturatedFitShare: mean(rows.map(({ fit }) => Number(Math.abs(fit) === 4))),
    familyShares: Object.fromEntries(families.map((key, i) => [key, total === 0 ? null : totals[i] / total])),
    omittedNegativeKeywords: rows.reduce((sum, row) => sum + row.omittedNegative, 0),
    negativeFit: rows.filter(({ fit }) => fit < 0).length,
    indian: rows.filter(({ preferences }) => preferences.indian).length,
    other1960To1979: rows.filter(({ preferences }) => preferences.other1960To1979).length,
  };
}

function diversity(rows: ReturnType<typeof run>["selected"]) {
  return Object.fromEntries([
    ...(["genres", "directors", "countries"] as const)
      .map((key) => [key, new Set(rows.flatMap(({ film }) => film.metadata[key])).size]),
    ["decades", new Set(rows.flatMap(({ film }) => film.year === null ? [] : [Math.floor(film.year / 10) * 10])).size],
  ]);
}

function evaluation(input: Experiment, options: DiscoveryOptions) {
  const targets = input.signals.filter(({ ratings }) => {
    const average = mean(ratings.flatMap(({ numeric }) => numeric ?? []));
    return average !== null && average >= 8;
  }).map(({ film }) => film.id).sort((a, b) => discoveryHash(["calibration-holdout", a])
    .localeCompare(discoveryHash(["calibration-holdout", b]), "en"));
  if (targets.length < 10) return { targets: targets.length, minimumTargets: 10, recallAt8: null, ndcgAt8: null };
  let eligible = 0;
  let hits = 0;
  const ndcg: number[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const held = new Set(targets.filter((_, i) => i % 5 === fold));
    const { candidates, training } = holdoutInputs(input.catalogue, input.signals, held);
    const result = run({ ...input, catalogue: candidates, signals: training }, "affinities", options);
    const eligibleHere = result.ranked.filter(({ film }) => held.has(film.id)).length;
    const ranked = ids(result);
    const gain = (index: number) => 1 / Math.log2(index + 2);
    const dcg = ranked.reduce((sum, id, i) => sum + (held.has(id) ? gain(i) : 0), 0);
    const ideal = Array.from({ length: Math.min(eligibleHere, 8) }, (_, i) => gain(i)).reduce((sum, value) => sum + value, 0);
    eligible += eligibleHere;
    hits += ranked.filter((id) => held.has(id)).length;
    if (ideal) ndcg.push(dcg / ideal);
  }
  return { targets: targets.length, minimumTargets: 10, eligible, hits, recallAt8: eligible ? hits / eligible : null, ndcgAt8: mean(ndcg) };
}

export function experimentFingerprint(input: Experiment) {
  return discoveryHash([input.catalogue, input.signals, [...input.excluded].sort((a, b) => a - b),
    input.rotations, input.date, input.seed, input.preferences]);
}

export function compareCalibration(input: Experiment) {
  const renewalRotation = (mode: DiscoveryMode, previousIds: number[]) => {
    const rotation = input.rotations[mode];
    return { ...rotation, previous: [previousIds, ...rotation.previous].slice(0, 3) };
  };
  const baselines = Object.fromEntries(discoveryModes.map((mode) => [mode, run(input, mode, {})]));
  const comparison = arms.map((arm) => {
    const options = armOptions(arm, input.preferences);
    const modes = discoveryModes.map((mode) => {
      const first = arm === "A" ? baselines[mode] : run(input, mode, options);
      const nextSeed = input.seed + ":next";
      const next = run(input, mode, options, renewalRotation(mode, ids(baselines[mode])), nextSeed);
      const self = arm === "A" ? next : run(input, mode, options, renewalRotation(mode, ids(first)), nextSeed);
      return {
        mode, ids: ids(first), renewedAgainstCommonBaseline: next.renewed, next: ids(next),
        renewedAgainstOwnSelection: self.renewed,
        repeatedFromHistory: first.selected.filter(({ tier }) => tier > 0).length,
        candidates: metrics(first.ranked), selection: metrics(first.selected), diversity: diversity(first.selected),
        picks: first.selected.map(({ film, reason, decision }) => ({ id: film.id, title: film.title, reason, decision })),
      };
    });
    const modeOverlap = modes.flatMap((left, i) => modes.slice(i + 1).map((right) => ({
      modes: [left.mode, right.mode], shared: left.ids.filter((id) => right.ids.includes(id)).length,
    })));
    return { arm, options, modes, modeOverlap, holdout: evaluation(input, options) };
  });
  const baseline = comparison[0];
  return { protocol: calibrationProtocol, engine: engineVersion, date: input.date, seed: input.seed,
    fingerprint: experimentFingerprint(input), catalogue: input.catalogue.length, signals: input.signals.length,
    comparison: comparison.map((row) => ({ ...row, overlapWithA: row.modes.map(({ ids: selected }, i) =>
      selected.filter((id) => baseline.modes[i].ids.includes(id)).length) })) };
}

export const calibrationVotes = ["Très envie de voir", "Pourquoi pas", "Pas intéressé", "Déjà vu", "Pas assez d’informations pour me décider"] as const;


export const blindCalibrationProtocol = "discovery-calibration-blind-v3";
export type CalibrationVote = typeof calibrationVotes[number];

export function planBlindCalibration(input: Experiment, mode: DiscoveryMode, presented: ReadonlySet<number> = new Set()) {
  const history = [...presented].sort((a, b) => a - b);
  const recent = new Set(input.rotations[mode].previous.flat());
  const selections = Object.fromEntries(arms.map((arm) => {
    const ranking = inspectDiscoveryRanking(input.catalogue, input.signals, input.excluded, mode,
      input.rotations[mode], input.seed, input.date, armOptions(arm, input.preferences),
      ({ film, qualityTier }) => !presented.has(film.id) && qualityTier === 0);
    return [arm, ranking.selected.map(({ film }, index) => ({ movieId: film.id, rank: index + 1 }))];
  })) as Record<typeof arms[number], { movieId: number; rank: number }[]>;
  const assignment = assignBlindFilms(arms, selections, recent, input.seed);
  const films = new Map(input.catalogue.map((film) => [film.id, film]));
  const proposals = assignment.entries.map(({ movieId, model: arm, rank }) => {
    const { title, year, metadata: { minutes, synopsis, fullSynopsis, directors, countries, genres } } = films.get(movieId)!;
    return { movieId, title, arm, rank, card: { title, year, minutes, synopsis, fullSynopsis, directors, countries, genres } };
  });
  return {
    protocol: blindCalibrationProtocol, engine: engineVersion,
    catalogueFingerprint: discoveryHash(input.catalogue),
    fingerprint: discoveryHash([experimentFingerprint(input), history, mode, blindCalibrationProtocol]),
    mode, date: input.date, seed: input.seed, preferences: {
      lessIndianCinema: !!input.preferences.lessIndianCinema, preferFrUs1960To1979: !!input.preferences.preferFrUs1960To1979,
    },
    collisions: assignment.collisions, coveredArms: proposals.length, totalArms: arms.length,
    poolLimit: discoverySize, poolSizes: { A: selections.A.length, B: selections.B.length, C: selections.C.length, D: selections.D.length }, proposals,
  } as const;
}
