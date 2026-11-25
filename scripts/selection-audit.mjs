import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createServer } from "vite";

try {
  const { values } = parseArgs({ options: {
    sqlite: { type: "string" }, output: { type: "string" }, date: { type: "string" }, criteria: { type: "string" },
  } });
  if (!values.sqlite || !values.output || !values.date) {
    throw Error("Usage : npm run diagnose:selection -- --sqlite <base> --output <dossier privé> --date <AAAA-MM-JJ> [--criteria <json>]");
  }
  const server = await createServer({ configFile: false, logLevel: "error",
    server: { middlewareMode: true, watch: null, hmr: false, ws: false } });
  try {
    const { writeSelectionAudit } = await server.ssrLoadModule("/src/diagnostics/selection.ts");
    const criteria = values.criteria ? JSON.parse(await readFile(values.criteria, "utf8")) : undefined;
    await writeSelectionAudit({ ...values, criteria });
    console.log("Rapports Markdown et JSON générés dans le dossier privé.");
  } finally {
    await server.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
