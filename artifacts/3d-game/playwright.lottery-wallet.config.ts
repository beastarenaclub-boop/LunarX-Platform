import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests", testMatch: "shared-wallet-lottery.spec.ts", workers: 1, timeout: 120000,
  expect: { timeout: 30000 }, reporter: "list", outputDir: "../../tmp/lottery-review/browser-results",
  use: { baseURL: process.env.LOTTERY_TEST_BASE_URL || "http://127.0.0.1:5205", headless: true,
    viewport: { width: 1366, height: 768 }, screenshot: "only-on-failure", trace: "retain-on-failure",
    launchOptions: { executablePath: existsSync(chrome) ? chrome : undefined } },
});
