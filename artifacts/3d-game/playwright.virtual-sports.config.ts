import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests",
  testMatch: "virtual-sports.spec.ts",
  timeout: 180000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../tmp/virtual-sports-tests",
  use: {
    baseURL: process.env.SPORTS_TEST_URL ?? "http://127.0.0.1:5198",
    headless: true,
    viewport: { width: 1440, height: 1050 },
    screenshot: "only-on-failure",
    launchOptions: existsSync(chrome)
      ? {
          executablePath: chrome,
          args: [
            "--enable-webgl",
            "--ignore-gpu-blocklist",
            "--enable-unsafe-swiftshader",
          ],
        }
      : {},
  },
  webServer: {
    command: "node virtual-sports-server/server.mjs",
    url: "http://127.0.0.1:5198",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
