import { createHash } from "node:crypto";
import { affinityModels, type AffinityModel } from "./affinity";
import { recommend, type Film, type Signal } from "./recommendation";
import type { Criteria } from "../shared/recommendation";

export const labProtocol = "blind-v1";
export const labRecentLimit = 3;
type Pick = { movieId: number; rank: number };
export type LabSelections = Record<AffinityModel, Pick[]>;
type Assignment<Model> = Pick & { model: Model };
export const labHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const seeded = (seed: string, purpose: string, value: unknown) => labHash([seed, purpose, value]);

export function rankLabModels(catalogue: Film[], signals: Signal[], criteria: Criteria, recent: ReadonlySet<number>, referenceDate: string,
  excludedIds?: ReadonlySet<number>) {
  const policy = { mode: "classic", referenceDate, excludedIds } as const;
  return Object.fromEntries(affinityModels.map((model) => [
    model, recommend(catalogue, signals, criteria, recent, policy, model, "legacy").films.map(({ id }, index) => ({ movieId: id, rank: index + 1 })),
  ])) as LabSelections;
}

export function assignLabFilms(selections: LabSelections, recent: ReadonlySet<number>, seed: string) {
  return assignBlindFilms(affinityModels, selections, recent, seed);
}

export function assignBlindFilms<Model extends string>(models: readonly Model[], selections: Record<Model, Pick[]>,
  recent: ReadonlySet<number>, seed: string) {
  let best: { entries: Assignment<Model>[]; repeats: number; sum: number; key: string } | undefined;
  const used = new Set<number>();
  const entries: Assignment<Model>[] = [];
  // Exhaustive matching finds maximum coverage before minimizing repeats and rank.
  function visit(index: number, repeats: number, sum: number) {
    const model = models[index];
    if (model === undefined) {
      if (best && (entries.length < best.entries.length ||
        (entries.length === best.entries.length && (repeats > best.repeats || (repeats === best.repeats && sum > best.sum))))) return;
      const key = seeded(seed, "assignment", entries.map(({ model, movieId }) => [model, movieId]));
      if (!best || entries.length > best.entries.length || repeats < best.repeats || sum < best.sum || key < best.key) {
        best = { entries: [...entries], repeats, sum, key };
      }
      return;
    }
    for (const pick of selections[model]) {
      if (used.has(pick.movieId)) continue;
      used.add(pick.movieId);
      entries.push({ ...pick, model });
      visit(index + 1, repeats + Number(recent.has(pick.movieId)), sum + pick.rank);
      entries.pop();
      used.delete(pick.movieId);
    }
    visit(index + 1, repeats, sum);
  }
  visit(0, 0, 0);
  const counts = new Map<number, number>();
  for (const model of models) {
    for (const pick of selections[model]) counts.set(pick.movieId, (counts.get(pick.movieId) ?? 0) + 1);
  }
  const assignment = best?.entries ?? [];
  return {
    entries: assignment.sort((a, b) => seeded(seed, "display", a.movieId).localeCompare(seeded(seed, "display", b.movieId), "en")),
    repeated: best?.repeats ?? 0,
    collisions: [...counts.values()].filter((count) => count > 1).length,
  };
}
