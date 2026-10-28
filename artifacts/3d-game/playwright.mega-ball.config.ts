import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["mega-ball.spec.ts", "mega-ball-machine.spec.ts"],
  timeout: 100000,
  expect: { timeout: 12000 },
  workers: 1,
  reporter: "list",
  outputDir: "../../test-results/mega-ball",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5340",
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_PATH ??
        (existsSync(chrome) ? chrome : undefined),
    },
  },
});
