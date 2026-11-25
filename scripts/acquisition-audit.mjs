import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createServer } from "vite";

try {
  const { values } = parseArgs({ options: {
    sqlite: { type: "string" }, output: { type: "string" }, date: { type: "string" },
    criteria: { type: "string" }, network: { type: "boolean" },
  } });
  if (!values.sqlite || !values.output || !values.date) {
    throw new Error("Usage : npm run diagnose:acquisition -- --sqlite <base> --output <dossier privé> --date <AAAA-MM-JJ> [--criteria <json>] [--network]");
  }
  const criteria = values.criteria ? JSON.parse(await readFile(values.criteria, "utf8")) : undefined;
  const server = await createServer({ configFile: false, logLevel: "error",
    server: { middlewareMode: true, watch: null, hmr: false, ws: false } });
  try {
    const { writeAcquisitionAudit } = await server.ssrLoadModule("/src/diagnostics/acquisition.ts");
    await writeAcquisitionAudit({ ...values, criteria });
    console.log("Rapports privés générés.");
  } finally {
    await server.close();
  }
} catch (error) {
  console.error(error.code ? "Le diagnostic n’a pas pu lire ou écrire un fichier local." : error.message);
  process.exitCode = 1;
}
