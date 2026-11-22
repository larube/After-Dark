module.exports = {
  packagerConfig: {
    asar: true,
    appBundleId: "com.larube.afterdark",
    extraResource: ["drizzle"],
    // Forge Vite's default filter excludes the external SQLite driver.
    // Keep node_modules here and let Packager prune development packages.
    ignore: (file) => file !== "" && file !== "/package.json" && file !== "/.vite"
      && !/^\/\.vite\/(build|renderer)(\/|$)/.test(file)
      && !/^\/node_modules(\/|$)/.test(file),
  },
  plugins: [
    { name: "@electron-forge/plugin-auto-unpack-natives", config: {} },
    {
      name: "@electron-forge/plugin-vite",
      config: {
        build: [
          { entry: "src/main/main.ts", config: "vite.main.config.ts", target: "main" },
          { entry: "src/preload/preload.ts", config: "vite.preload.config.ts", target: "preload" },
        ],
        renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
      },
    },
  ],
};
