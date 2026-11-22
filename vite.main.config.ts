import { defineConfig } from "vite";

export default defineConfig({
  build: { rollupOptions: { external: ["@libsql/client/sqlite3"] } },
});
