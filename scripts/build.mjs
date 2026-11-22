import { build } from "vite";

await build({ configFile: "vite.renderer.config.ts", base: "./", build: { outDir: ".vite/check/renderer" } });
for (const entry of ["main", "preload"]) {
  await build({
    configFile: `vite.${entry}.config.ts`,
    build: {
      outDir: `.vite/check/${entry}`,
      lib: { entry: `src/${entry}/${entry}.ts`, formats: ["cjs"], fileName: entry },
      rollupOptions: { external: ["electron", /^node:/] },
    },
    define: { MAIN_WINDOW_VITE_DEV_SERVER_URL: "undefined", MAIN_WINDOW_VITE_NAME: '"main_window"' },
  });
}
