import { defineConfig } from "@playwright/test";
import base from "./playwright.instant-collection.config";
export default defineConfig({
  ...base,
  testMatch: "seven-up-down.spec.ts",
  outputDir: "../../tmp/seven-up-down-tests",
  use: { ...base.use, baseURL: process.env.SEVEN_BASE_URL ?? "http://127.0.0.1:5367" },
  webServer: process.env.SEVEN_BASE_URL ? undefined : {
    command: "node node_modules/vite/bin/vite.js --config vite.seven-up-down.config.ts",
    url: "http://127.0.0.1:5367", reuseExistingServer: true, timeout: 60000,
  },
});
