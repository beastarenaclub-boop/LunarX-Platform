import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir: "./tests",
  testMatch: "lunar-colour-responsive.spec.ts",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: "list",
  outputDir: "../../tmp/lunar-colour-review/test-results",
  use: {
    baseURL: externalBaseURL || "http://127.0.0.1:5194",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { executablePath: existsSync(chrome) ? chrome : undefined },
  },
  webServer: externalBaseURL ? undefined : {
    command: "node node_modules/vite/bin/vite.js --config vite.config.ts --host 127.0.0.1",
    cwd: path.resolve(import.meta.dirname),
    env: { PORT: "5194" },
    url: "http://127.0.0.1:5194",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
