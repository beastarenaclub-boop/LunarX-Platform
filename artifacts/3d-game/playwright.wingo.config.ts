import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["wingo-integrated.spec.ts", "shared-wallet-wingo.spec.ts"],
  workers: 1,
  retries: 0,
  timeout: 100000,
  expect: { timeout: 15000 },
  reporter: [["list"]],
  outputDir: path.resolve(
    import.meta.dirname,
    "../../tmp/wingo-integrated/test-results",
  ),
  use: {
    // Explicit IPv4 avoids Docker Desktop's intermittent localhost IPv6 reset.
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5174",
    headless: true,
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
});
