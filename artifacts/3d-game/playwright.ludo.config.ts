import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "ludo.spec.ts",
    "ludo-modes.spec.ts",
    "ludo-features.spec.ts",
    "ludo-snakes.spec.ts",
  ],
  workers: 1,
  retries: 0,
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: "list",
  outputDir: "../../test-results/ludo",
  use: {
    baseURL: "http://127.0.0.1:5398",
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: { executablePath: existsSync(chrome) ? chrome : undefined },
  },
  webServer: [
    {
      command: "node ../api-server/scripts/test-ludo.mjs --serve",
      url: "http://127.0.0.1:5214/api/healthz",
      timeout: 120000,
      reuseExistingServer: false,
    },
    {
      command:
        "node node_modules/vite/bin/vite.js --config vite.ludo.config.ts",
      url: "http://127.0.0.1:5398",
      timeout: 120000,
      reuseExistingServer: false,
    },
  ],
});
