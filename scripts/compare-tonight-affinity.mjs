import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createServer } from "vite";

try {
  const { values } = parseArgs({ options: { sqlite: { type: "string" }, capture: { type: "string" } } });
  if (!values.sqlite || !values.capture) {
    throw Error("Usage : npm run diagnose:tonight-affinity -- --sqlite <base> --capture <tonight.json>");
  }
  const capture = JSON.parse(await readFile(values.capture, "utf8"));
  const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true, watch: null, hmr: false, ws: false } });
  try {
    const { compareTonightAffinity } = await server.ssrLoadModule("/src/diagnostics/tonight-affinity.ts");
    console.log(JSON.stringify(await compareTonightAffinity(values.sqlite, capture), null, 2));
  } finally {
    await server.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
