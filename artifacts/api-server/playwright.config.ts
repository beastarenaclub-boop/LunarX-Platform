import { execSync } from "node:child_process";
import { defineConfig } from "@playwright/test";

function resolveChromium(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (!process.env.REPLIT_DOMAINS) return undefined;
  try {
    return execSync("command -v chromium", { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  (process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
    : "http://localhost:3000");

const chromiumPath = resolveChromium();

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : undefined,
  },
});
