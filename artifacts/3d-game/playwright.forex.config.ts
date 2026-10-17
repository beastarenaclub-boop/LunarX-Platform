import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests",
  testMatch: process.env.FOREX_TEST_API ? "shared-wallet-forex.spec.ts" : "forex-integrated.spec.ts",
  workers: 1,
  timeout: process.env.FOREX_TEST_API ? 150000 : 60000,
  expect: { timeout: 15000 },
  reporter: "list",
  outputDir: "../../tmp/forex-integrated/results",
  use: {
    baseURL: process.env.FOREX_TEST_BASE_URL || "http://127.0.0.1:5198",
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { executablePath: existsSync(chrome) ? chrome : undefined },
  },
  webServer: process.env.FOREX_TEST_BASE_URL ? undefined : {
    command: `node node_modules/vite/bin/vite.js --config ${process.env.FOREX_TEST_API ? "vite.forex-wallet-test.config.ts" : "vite.config.ts"} --host 127.0.0.1`,
    cwd: path.resolve(import.meta.dirname),
    env: { PORT: "5198" },
    url: "http://127.0.0.1:5198",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
