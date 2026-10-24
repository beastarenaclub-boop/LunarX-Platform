import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "teenpatti-joker.spec.ts",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 12000 },
  reporter: "list",
  outputDir: "../../tmp/teenpatti-joker/test-results",
  use: {
    baseURL: "http://127.0.0.1:5384",
    channel: process.platform === "win32" ? "chrome" : undefined,
    headless: true,
    launchOptions: {
      args: ["--autoplay-policy=document-user-activation-required"],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --config vite.teenpatti-joker.config.ts",
    url: "http://127.0.0.1:5384",
    reuseExistingServer: true,
  },
});
