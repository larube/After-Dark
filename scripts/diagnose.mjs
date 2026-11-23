import { parseArgs } from "node:util";
import { createServer } from "vite";

try {
  const { values } = parseArgs({ options: {
    input: { type: "string" }, sqlite: { type: "string" }, output: { type: "string" }, baseline: { type: "string" },
    "reference-date": { type: "string" }, "compare-policy": { type: "boolean" },
  } });
  if (!values.output || Boolean(values.input) === Boolean(values.sqlite)) {
    throw new Error("Usage : npm run diagnose -- (--input fixture.json | --sqlite after-dark.sqlite) --output dossier [--reference-date AAAA-MM-JJ] [--baseline report.json | --compare-policy]");
  }
  const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } });
  try {
    const { diagnose } = await server.ssrLoadModule("/src/diagnostics/cli.ts");
    await diagnose({ ...values, referenceDate: values["reference-date"], comparePolicy: values["compare-policy"] });
  } finally {
    await server.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
