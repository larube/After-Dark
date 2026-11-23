import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { createServer } from "vite";

const { values } = parseArgs({ options: {
  sqlite: { type: "string" }, date: { type: "string" }, seed: { type: "string", multiple: true, default: ["calibration-1"] },
  blind: { type: "string" },
  "no-less-indian-cinema": { type: "boolean" }, "no-prefer-fr-us-1960-1979": { type: "boolean" },
} });
const server = await createServer({ configFile: false, logLevel: "silent", server: { middlewareMode: true, watch: null, hmr: false, ws: false } });
try {
  const { calendarDate } = await server.ssrLoadModule("/src/domain/candidate-quality.ts");
  const { discoveryModes } = await server.ssrLoadModule("/src/shared/discovery.ts");
  const { blindCalibration, calibrationVotes, compareCalibration } = await server.ssrLoadModule("/src/diagnostics/calibration.ts");
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
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const result = await blindCalibration(input, values.blind, async ({ title, year, minutes, synopsis }, index, total) => {
        process.stderr.write(`\n${index}/${total} · ${title}${year ? ` (${year})` : ""}${minutes ? ` · ${minutes} min` : ""}\n${synopsis ?? ""}\n`);
        calibrationVotes.forEach((label, i) => process.stderr.write(`${i + 1}. ${label}\n`));
        while (true) {
          const answer = (await rl.question("Réponse (1–4), ou q pour quitter : ")).trim().toLowerCase();
          if (answer === "q") return undefined;
          if (/^[1-4]$/.test(answer)) return calibrationVotes[Number(answer) - 1];
        }
      });
      if (result?.responses.length) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      else process.stderr.write("Aucun bilan de vote à afficher.\n");
    } finally {
      rl.close();
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await server.close();
}
