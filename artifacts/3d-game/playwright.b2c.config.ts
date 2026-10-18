import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "b2c-storefront.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  outputDir: "./test-results-b2c",
  use: {
    baseURL: "http://127.0.0.1:5180",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --config vite.b2c.config.ts",
    url: "http://127.0.0.1:5180",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
