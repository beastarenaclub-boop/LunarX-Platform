import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests", testMatch: "coin-live.spec.ts", timeout: 60000,
  expect: { timeout: 12000 }, retries: 0, workers: 1, reporter: "list", outputDir: "../../tmp/coin-live-tests",
  use: { baseURL: "http://127.0.0.1:5327", headless: true, viewport: { width: 1440, height: 950 }, screenshot: "only-on-failure", launchOptions: existsSync(chrome) ? { executablePath: chrome } : {} },
});
