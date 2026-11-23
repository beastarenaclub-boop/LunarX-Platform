import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "roulette-mini-reveal.spec.ts", workers: 1,
  timeout: 90000, expect: { timeout: 15000 }, reporter: "list",
  outputDir: "../../tmp/roulette-reveal/test-results",
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5195", headless: true,
    launchOptions: { executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--disable-gpu"] },
    screenshot: "only-on-failure" },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : { command: "node node_modules/vite/bin/vite.js --config vite.config.ts --host 127.0.0.1", env: { PORT: "5195" }, url: "http://127.0.0.1:5195", reuseExistingServer: false, timeout: 60000 },
});
