import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createServer } from "vite";

try {
  const { values } = parseArgs({ options: {
    sqlite: { type: "string" }, output: { type: "string" }, date: { type: "string" },
    criteria: { type: "string" }, sessions: { type: "string" }, network: { type: "boolean" }, pages: { type: "string" }, details: { type: "string" }, categories: { type: "string" },
  } });
  if (!values.sqlite || !values.output || !values.date) {
    throw new Error("Usage : npm run diagnose:acquisition -- --sqlite <base> --output <dossier privé> --date <AAAA-MM-JJ> [--criteria <json>] [--sessions <1-20>] [--pages <4,6>] [--details <1-18>] [--categories <gems,horror>] [--network]");
  }
  const criteria = values.criteria ? JSON.parse(await readFile(values.criteria, "utf8")) : undefined;
  const server = await createServer({ configFile: false, logLevel: "error",
    server: { middlewareMode: true, watch: null, hmr: false, ws: false } });
  try {
    const { writeAcquisitionAudit } = await server.ssrLoadModule("/src/diagnostics/acquisition.ts");
    if (values.details !== undefined && values.pages === undefined) throw new Error("--details requiert --pages.");
    await writeAcquisitionAudit({ ...values, criteria, sessions: values.sessions === undefined ? undefined : Number(values.sessions),
      pages: values.pages?.split(",").map(Number), details: values.details === undefined ? undefined : Number(values.details),
      categories: values.categories?.split(","),
    });
    console.log("Rapports privés générés.");
  } finally {
    await server.close();
  }
} catch (error) {
  console.error(error.code ? "Le diagnostic n’a pas pu lire ou écrire un fichier local." : error.message);
  process.exitCode = 1;
}
