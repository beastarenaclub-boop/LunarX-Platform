import { defineConfig } from "@playwright/test";
import base from "./playwright.compact.config";
export default defineConfig({
  ...base,
  testMatch: "game-sheet.spec.ts",
  outputDir: "../../test-results/game-sheet",
  projects: [base.projects![0]],
  use: { ...base.use, baseURL: "http://127.0.0.1:5387" },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --config vite.config.ts",
    env: { PORT: "5387", BASE_PATH: "/" },
    url: "http://127.0.0.1:5387", reuseExistingServer: true, timeout: 120000,
  },
});
