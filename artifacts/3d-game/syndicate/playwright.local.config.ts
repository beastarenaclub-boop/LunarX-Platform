import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Exercise the actual development server too: built Worker tests cannot catch
// an obsolete Vite index.html shadowing app/page.tsx in development.
// These anonymous entry tests do not create or modify any account data.
export default defineConfig({
  ...config,
  testMatch: [
    "entry-game.spec.ts",
    "entry-audio.spec.ts",
    "entry-access.spec.ts",
    "portal.spec.ts",
    "eye-gate.spec.ts",
  ],
  outputDir: "./test-results/local-entry",
  use: { ...config.use, baseURL: "http://127.0.0.1:5198" },
  webServer: {
    command:
      "node scripts/run-framework.mjs dev --port 5198 --hostname 127.0.0.1",
    url: "http://127.0.0.1:5198",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
