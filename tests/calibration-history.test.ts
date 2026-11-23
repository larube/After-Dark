import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { calibrationVotes, planBlindCalibration } from "../src/diagnostics/calibration";
import { importCalibrationReport, presentedFilms, readCalibrationHistory, recordBlindSession,
  summarizeCalibrationHistory, withCalibrationHistory } from "../src/diagnostics/calibration-history";
import { calibrationFixture } from "./fixtures/calibration";

const input = { ...calibrationFixture, seed: "calibration-1",
  preferences: { lessIndianCinema: true, preferFrUs1960To1979: true } };
let directory: string;
let file: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "after-dark-calibration-"));
  file = join(directory, "history.json");
});
afterEach(async () => rm(directory, { recursive: true, force: true }));

it("persists completed votes and avoids repeats across seeds and arms after reopening", async () => {
  const proposal = planBlindCalibration(input, "affinities");
  const secondInput = { ...input, seed: "calibration-2" };
  const unchecked = planBlindCalibration(secondInput, "affinities");
  expect(unchecked.proposals.some(({ movieId, arm }) => proposal.proposals
    .some((earlier) => earlier.movieId === movieId && earlier.arm !== arm))).toBe(true);
  const first = await withCalibrationHistory(file, (history, save) =>
    recordBlindSession(history, save, proposal, async (card, index, total) => {
      expect(Object.keys(card).sort()).toEqual(["minutes", "synopsis", "title", "year"]);
      expect(total).toBe(4);
      return index === 1 ? calibrationVotes[3] : calibrationVotes[2];
    }));
  expect(first?.status).toBe("completed");
  const history = await readCalibrationHistory(file);
  expect(history.sessions).toEqual([first]);
  const second = planBlindCalibration(secondInput, "affinities", presentedFilms(history));
  expect(second.coveredArms).toBe(4);
  expect(second.proposals.every(({ movieId }) => !presentedFilms(history).has(movieId))).toBe(true);
  expect(planBlindCalibration(secondInput, "affinities", presentedFilms(await readCalibrationHistory(file)))).toEqual(second);
  const arms = summarizeCalibrationHistory(history).groups[0].arms;
  expect(arms.reduce((sum, row) => sum + row.responses["Déjà vu"], 0)).toBe(1);
  expect(arms.reduce((sum, row) => sum + row.responses["Pas intéressé"], 0)).toBe(3);
});

it("persists partial questionnaires without revealing a result or consuming films", async () => {
  const plan = planBlindCalibration(input, "affinities");
  const result = await withCalibrationHistory(file, (history, save) =>
    recordBlindSession(history, save, plan, async (_, index) => index === 1 ? calibrationVotes[1] : undefined));
  expect(result).toBeNull();
  const history = await readCalibrationHistory(file);
  expect(history.sessions[0].status).toBe("abandoned");
  expect(history.sessions[0].responses.map(({ response }) => response)).toEqual(["Pourquoi pas", undefined]);
  expect(presentedFilms(history).size).toBe(0);
  expect(summarizeCalibrationHistory(history)).toMatchObject({ completed: 0, abandoned: 1, groups: [] });
  expect(planBlindCalibration(input, "affinities", presentedFilms(history))).toEqual(plan);
});

it("reports exhaustion without voting or admitting excluded and seen films", async () => {
  const plan = planBlindCalibration(input, "affinities");
  const kept = plan.proposals[0].movieId;
  const historyIds = new Set(input.catalogue.map(({ id }) => id).filter((id) => id !== kept));
  const exhausted = planBlindCalibration(input, "affinities", historyIds);
  expect(exhausted).toMatchObject({ coveredArms: 1, totalArms: 4, poolLimit: 8, collisions: 1 });
  expect(await withCalibrationHistory(file, (history, save) =>
    recordBlindSession(history, save, exhausted, async () => { throw new Error("Vote inattendu"); }))).toBeNull();
  expect((await readCalibrationHistory(file)).sessions).toEqual([]);
  expect(plan.proposals.every(({ movieId }) => !input.excluded.has(movieId) &&
    input.catalogue.find(({ id }) => id === movieId)?.status !== "seen")).toBe(true);
});

it("imports legacy reports once and accounts for a film assigned to two arms in legacy sessions", async () => {
  const report = {
    protocol: "discovery-calibration-v1", engine: "1.3.0", fingerprint: "old-1", mode: "affinities",
    date: input.date, seed: "calibration-1", preferences: input.preferences, collisions: 1, coveredArms: 1, totalArms: 4,
    responses: [{ movieId: 19, title: "Film fictif", arm: "C", rank: 1, response: "Déjà vu" }],
  };
  const second = { ...report, fingerprint: "old-2", seed: "calibration-2",
    responses: [{ ...report.responses[0], arm: "D", response: "Pourquoi pas" }] };
  await withCalibrationHistory(file, async (history, save) => {
    expect(importCalibrationReport(history, report)).toBe(true);
    expect(importCalibrationReport(history, second)).toBe(true);
    expect(importCalibrationReport(history, report)).toBe(false);
    await save();
  });
  const history = await readCalibrationHistory(file);
  expect(history.sessions[0].catalogueFingerprint).toBeUndefined();
  expect([...presentedFilms(history)]).toEqual([19]);
  expect(summarizeCalibrationHistory(history)).toMatchObject({ completed: 2, distinctFilms: 1 });
  for (const mode of ["gems", "affinities", "offbeat"] as const) {
    expect(planBlindCalibration(input, mode, presentedFilms(history)).proposals.some(({ movieId }) => movieId === 19)).toBe(false);
  }
});

it("refuses a simultaneous writer while a questionnaire owns the history", async () => {
  await withCalibrationHistory(file, async () => {
    await expect(withCalibrationHistory(file, async () => {})).rejects.toThrow("verrouillé");
  });
  await expect(withCalibrationHistory(file, async () => true)).resolves.toBe(true);
});
