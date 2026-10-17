import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const chrome = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests", testMatch: "bike-live.spec.ts", timeout: 120_000,
  expect: { timeout: 15_000 }, workers: 1, retries: 0, reporter: "list",
  outputDir: "../../tmp/bike-betting-tests",
  use: { headless: true, viewport: { width: 1440, height: 900 }, screenshot: "only-on-failure",
    launchOptions: { ...(existsSync(chrome) ? { executablePath: chrome } : {}), args: ["--enable-webgl", "--ignore-gpu-blocklist"] },
  },
});
