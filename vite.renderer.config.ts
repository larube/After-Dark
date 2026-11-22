import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => {
  const development = command === "serve";
  const policy = [
    "default-src 'none'",
    `script-src 'self'${development ? " 'unsafe-inline'" : ""}`,
    `style-src 'self'${development ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data:",
    "font-src 'self'",
    development ? "connect-src 'self' ws://127.0.0.1:*" : "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "after-dark-csp",
        transformIndexHtml: (html) => html.replace("__AFTER_DARK_CSP__", policy),
      },
    ],
    server: { host: "127.0.0.1" },
  };
});
