import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "baccarat-studio.spec.ts",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  reporter: "list",
  outputDir: "../../tmp/baccarat-reference/test-results",
  use: {
    baseURL: "http://127.0.0.1:5386",
    channel: process.platform === "win32" ? "chrome" : undefined,
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --config vite.baccarat-studio.config.ts",
    url: "http://127.0.0.1:5386",
    reuseExistingServer: true,
  },
});
