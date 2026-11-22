import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".vite/**", "out/**", "coverage/**"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    ...js.configs.recommended,
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly", module: "readonly", require: "readonly" } },
  },
);
