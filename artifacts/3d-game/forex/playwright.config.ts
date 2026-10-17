import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../../..");
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 95000,
  expect: { timeout: 10000 },
  reporter: "list",
  outputDir: path.join(root, "tmp/forex-review/results"),
  use: {
    baseURL: "http://127.0.0.1:5296",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1100 },
    launchOptions: { executablePath: existsSync(chrome) ? chrome : undefined },
  },
  webServer: {
    command: "node artifacts/3d-game/forex-server/server.mjs",
    cwd: root,
    url: "http://127.0.0.1:5296/api/forex/health",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      FOREX_PORT: "5296",
      FOREX_DB: path.join(
        root,
        `tmp/forex-review/browser-${Date.now()}.sqlite`,
      ),
    },
  },
});
