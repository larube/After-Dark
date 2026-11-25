import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createServer } from "vite";

try {
  const { values } = parseArgs({ options: {
    report: { type: "string" }, output: { type: "string" }, reveal: { type: "boolean" }, seed: { type: "string" },
  } });
  if (!values.output || Boolean(values.report) === Boolean(values.reveal) || (values.reveal && values.seed !== undefined)) {
    throw new Error("Usage : npm run diagnose:acquisition-blind -- --output <dossier privé> (--report <audit.json> [--seed <graine privée>] | --reveal)");
  }
  const server = await createServer({ configFile: false, logLevel: "error",
    server: { middlewareMode: true, watch: null, hmr: false, ws: false } });
  try {
    const { writeBlindAcquisition, writeBlindAcquisitionResult } = await server.ssrLoadModule("/src/diagnostics/acquisition-blind.ts");
    if (values.reveal) {
      await writeBlindAcquisitionResult(values.output);
    } else {
      const report = JSON.parse(await readFile(values.report, "utf8"));
      if (report.format !== "after-dark-acquisition-v3") throw new Error("Le questionnaire requiert un rapport d’acquisition v3.");
      await writeBlindAcquisition(report, values.output, values.seed);
    }
    console.log("Fichiers privés générés.");
  } finally {
    await server.close();
  }
} catch (error) {
  console.error(error.code ? "Le questionnaire n’a pas pu lire ou écrire un fichier local." : error.message);
  process.exitCode = 1;
}
