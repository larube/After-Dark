import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { createServer } from "vite";

const { values } = parseArgs({ options: {
  sqlite: { type: "string" }, date: { type: "string" }, seed: { type: "string", multiple: true, default: ["calibration-1"] },
  blind: { type: "string" }, history: { type: "string" }, results: { type: "boolean" },
  "import-results": { type: "string", multiple: true },
  "no-less-indian-cinema": { type: "boolean" }, "no-prefer-fr-us-1960-1979": { type: "boolean" },
} });
const server = await createServer({ configFile: false, logLevel: "silent", server: { middlewareMode: true, watch: null, hmr: false, ws: false } });
try {
  const { readCalibrationHistory, withCalibrationHistory, presentedFilms, importCalibrationReport, summarizeCalibrationHistory, recordBlindSession } =
    await server.ssrLoadModule("/src/diagnostics/calibration-history.ts");
  const historyFile = values.history ?? join(homedir(), ".after-dark",
    values.blind && !values.sqlite ? "calibration-fixture-history.json" : "calibration-history.json");
  if (Number(!!values.results) + Number(!!values["import-results"]) + Number(!!values.blind) > 1) {
    throw new Error("Utilisez une seule action parmi --results, --import-results et --blind.");
  }
  if (values.results) {
    console.log(JSON.stringify(summarizeCalibrationHistory(await readCalibrationHistory(historyFile)), null, 2));
  } else if (values["import-results"]) {
    const reports = await Promise.all(values["import-results"].map(async (file) => JSON.parse(await readFile(file, "utf8"))));
    const imported = await withCalibrationHistory(historyFile, async (history, save) => {
      const count = reports.filter((report) => importCalibrationReport(history, report)).length;
      if (count) await save();
      return count;
    });
    console.log(JSON.stringify({ imported }));
  } else {
    const { calendarDate } = await server.ssrLoadModule("/src/domain/candidate-quality.ts");
    const { discoveryModes } = await server.ssrLoadModule("/src/shared/discovery.ts");
    const { planBlindCalibration, calibrationVotes, compareCalibration } = await server.ssrLoadModule("/src/diagnostics/calibration.ts");
    if (values.sqlite && !values.date) throw new Error("Indiquez --date AAAA-MM-JJ pour un catalogue SQLite.");
    if (values.date && calendarDate(values.date) !== values.date) throw new Error("Indiquez une date valide au format AAAA-MM-JJ.");
    if (values.blind && !discoveryModes.includes(values.blind)) throw new Error("Mode inconnu. Utilisez affinities, gems ou offbeat.");
    if (values.blind && values.seed.length !== 1) throw new Error("Indiquez une seule graine pour un vote à l’aveugle.");
    const dataset = values.sqlite ? await (async () => {
      const { withLocalSnapshot } = await server.ssrLoadModule("/src/diagnostics/cli.ts");
      const { readCatalogue } = await server.ssrLoadModule("/src/db/recommendations.ts");
      const { discoveryExclusions, discoveryRotation } = await server.ssrLoadModule("/src/db/discovery.ts");
      return withLocalSnapshot(values.sqlite, async (db) => ({
        ...await readCatalogue(db), excluded: await discoveryExclusions(db),
        rotations: Object.fromEntries(await Promise.all(discoveryModes.map(async (mode) => [mode, await discoveryRotation(db, mode)]))),
        date: values.date,
      }));
    })() : (await server.ssrLoadModule("/tests/fixtures/calibration.ts")).calibrationFixture;
    const input = { ...dataset, date: values.date ?? dataset.date, seed: values.seed[0], preferences: {
      lessIndianCinema: !values["no-less-indian-cinema"],
      preferFrUs1960To1979: !values["no-prefer-fr-us-1960-1979"],
    } };
    if (!values.blind) {
      const reports = values.seed.map((seed) => compareCalibration({ ...input, seed }));
      process.stdout.write(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2) + "\n");
    } else {
      if (!process.stdin.isTTY) throw new Error("Le vote à l’aveugle requiert un terminal interactif.");
      await withCalibrationHistory(historyFile, async (history, save) => {
        const plan = planBlindCalibration(input, values.blind, presentedFilms(history));
        if (plan.coveredArms !== plan.totalArms) {
          process.stderr.write(`Pool insuffisant : ${plan.coveredArms}/${plan.totalArms} bras, ${plan.collisions} collision(s). Aucun questionnaire lancé.\n`);
          return;
        }
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        const interruption = new globalThis.AbortController();
        const interrupt = () => interruption.abort();
        rl.on("close", interrupt);
        rl.on("SIGINT", interrupt);
        process.on("SIGINT", interrupt);
        process.on("SIGTERM", interrupt);
        try {
          const result = await recordBlindSession(history, save, plan, async ({ title, year, minutes, synopsis }, index, total) => {
            if (interruption.signal.aborted) return undefined;
            process.stderr.write(`\n${index}/${total} · ${title}${year ? ` (${year})` : ""}${minutes ? ` · ${minutes} min` : ""}\n${synopsis ?? ""}\n`);
            calibrationVotes.forEach((label, i) => process.stderr.write(`${i + 1}. ${label}\n`));
            while (true) {
              const answer = (await rl.question("Réponse (1–4), ou q pour quitter : ", { signal: interruption.signal })).trim().toLowerCase();
              if (answer === "q") return undefined;
              if (/^[1-4]$/.test(answer)) return calibrationVotes[Number(answer) - 1];
            }
          });
          if (result) console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          if (!interruption.signal.aborted ||
            (error.name !== "AbortError" && error.code !== "ERR_USE_AFTER_CLOSE")) throw error;
        } finally {
          rl.close();
          process.off("SIGINT", interrupt);
          process.off("SIGTERM", interrupt);
        }
      });
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await server.close();
}
