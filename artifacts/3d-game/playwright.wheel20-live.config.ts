import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "wheel20-live.spec.ts",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 12000 },
  reporter: "list",
  outputDir: "../../tmp/wheel20-live/test-results",
  use: {
    baseURL: "http://127.0.0.1:5382",
    channel: process.platform === "win32" ? "chrome" : undefined,
    headless: true,
    launchOptions: {
      args: ["--autoplay-policy=document-user-activation-required"],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --config vite.wheel20-live.config.ts",
    url: "http://127.0.0.1:5382",
    reuseExistingServer: true,
  },
});
