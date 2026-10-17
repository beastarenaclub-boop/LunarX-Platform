import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "lucky7-live.spec.ts",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 12000 },
  reporter: "list",
  outputDir: "../../tmp/lucky7-live/test-results",
  use: {
    baseURL: "http://127.0.0.1:5378",
    channel: process.platform === "win32" ? "chrome" : undefined,
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --config vite.lucky7-live.config.ts",
    url: "http://127.0.0.1:5378",
    reuseExistingServer: true,
  },
});
