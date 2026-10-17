import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({ testDir: "./tests", testMatch: "prize-lotto.spec.ts", workers: 1, timeout: 120000,
  expect: { timeout: 30000 }, reporter: "list", outputDir: "../../tmp/prize-lotto-review/results",
  use: { baseURL: process.env.PRIZE_TEST_BASE_URL || "http://127.0.0.1:5215", headless: true,
    screenshot: "only-on-failure", trace: "retain-on-failure", launchOptions: { executablePath: existsSync(chrome) ? chrome : undefined } },
});
