import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests", testMatch: "chicken-road.spec.ts", timeout: 60000, expect: { timeout: 12000 },
  retries: 0, workers: 1, reporter: "list", outputDir: "../../tmp/chicken-road-tests",
  use: { baseURL: process.env.CHICKEN_GAME_URL ?? "http://127.0.0.1:5319", headless: true, viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure", launchOptions: existsSync(chrome) ? { executablePath: chrome } : {} },
});
