import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../../../..");
export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.ts",
  timeout: 65000,
  expect: { timeout: 12000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: path.join(root, "tmp/wingo-review/test-results"),
  use: {
    baseURL: "http://127.0.0.1:5298",
    headless: true,
    viewport: { width: 1440, height: 1100 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: existsSync(
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      )
        ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
        : undefined,
    },
  },
  webServer: {
    command: "node artifacts/3d-game/wingo-server/server.mjs",
    cwd: root,
    url: "http://127.0.0.1:5298/api/wingo/health",
    reuseExistingServer: false,
    timeout: 20000,
    env: {
      WINGO_PORT: "5298",
      WINGO_DB: path.join(root, `tmp/wingo-review/e2e-${process.pid}.sqlite`),
    },
  },
});
