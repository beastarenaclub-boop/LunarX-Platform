import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests",
  testMatch: "poker.spec.ts",
  timeout: 60000,
  expect: { timeout: 12000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../test-results/poker",
  use: {
    baseURL: "http://127.0.0.1:5298",
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_PATH ??
        (existsSync(chrome) ? chrome : undefined),
    },
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --config vite.poker.config.ts",
    cwd: import.meta.dirname,
    url: "http://127.0.0.1:5298",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
