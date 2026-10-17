import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../../../..");
export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.ts",
  timeout: 45000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  outputDir: path.join(root, "tmp/lottery-review/test-results"),
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5182",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chrome",
      use: {
        browserName: "chromium",
        launchOptions: {
          executablePath: existsSync(
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
          )
            ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
            : undefined,
        },
      },
    },
  ],
  webServer: {
    command: "node artifacts/3d-game/lottery-server/server.mjs",
    cwd: root,
    url: "http://127.0.0.1:5182/api/lottery/health",
    reuseExistingServer: false,
    env: {
      LOTTERY_PORT: "5182",
      LOTTERY_DB: path.join(
        root,
        `tmp/lottery-review/e2e-${process.pid}.sqlite`,
      ),
    },
    timeout: 20000,
  },
});
