import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "andar-bahar-live.spec.ts",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 12000 },
  reporter: "list",
  outputDir: "../../tmp/andar-bahar-live/test-results",
  use: {
    baseURL: "http://127.0.0.1:5384",
    channel: process.platform === "win32" ? "chrome" : undefined,
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --config vite.andar-bahar-live.config.ts",
    url: "http://127.0.0.1:5384",
    // Own the fixture process: a previous run may still be shutting it down.
    reuseExistingServer: false,
  },
});
