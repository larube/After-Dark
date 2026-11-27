import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createServer } from "vite";

try {
  const { values } = parseArgs({ options: {
    sqlite: { type: "string" }, output: { type: "string" }, date: { type: "string" }, criteria: { type: "string" }, composition: { type: "boolean" }, "acquisition-report": { type: "string" }, editorial: { type: "boolean" }, "editorial-production": { type: "boolean" }, "genre-editorial": { type: "boolean" },
  } });
  if (!values.sqlite || !values.output || !values.date) {
    throw Error("Usage : npm run diagnose:selection -- --sqlite <base> --output <dossier privé> --date <AAAA-MM-JJ> [--criteria <json>] [--editorial | --editorial-production | --genre-editorial | --composition [--acquisition-report <json>]]");
  }
  if ([values.composition, values.editorial, values["editorial-production"], values["genre-editorial"]].filter(Boolean).length > 1) throw Error("Choisissez un seul mode éditorial.");
  const server = await createServer({ configFile: false, logLevel: "error",
    server: { middlewareMode: true, watch: null, hmr: false, ws: false } });
  try {

    const criteria = values.criteria ? JSON.parse(await readFile(values.criteria, "utf8")) : undefined;
    if (values.composition) {
      const { writeCompositionAudit } = await server.ssrLoadModule("/src/diagnostics/composition.ts");
      const acquisition = values["acquisition-report"] ? JSON.parse(await readFile(values["acquisition-report"], "utf8")) : undefined;
      await writeCompositionAudit({ ...values, criteria, acquisition });
    } else if (values["genre-editorial"]) {
      const { writeGenreEditorialAudit } = await server.ssrLoadModule("/src/diagnostics/genre-editorial.ts");
      await writeGenreEditorialAudit({ ...values, criteria });
    } else if (values.editorial || values["editorial-production"]) {
      const { writeEditorialAudit } = await server.ssrLoadModule("/src/diagnostics/editorial.ts");
      await writeEditorialAudit({ ...values, criteria, production: values["editorial-production"] });
    } else {
      const { writeSelectionAudit } = await server.ssrLoadModule("/src/diagnostics/selection.ts");
      await writeSelectionAudit({ ...values, criteria });
    }
    console.log("Rapports Markdown et JSON générés dans le dossier privé.");
  } finally {
    await server.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
