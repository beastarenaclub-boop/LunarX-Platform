import { execSync } from "node:child_process";
import { defineConfig } from "@playwright/test";

function resolveChromium(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  // Only override on Replit (NixOS), where the binary playwright downloads is
  // not patchelf'd. Elsewhere, fall through to Playwright's bundled chromium.
  if (!process.env.REPLIT_DOMAINS) return undefined;
  try {
    return execSync("command -v chromium", { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

// Resolve baseURL from explicit override, else the Replit dev domain (which
// proxies both the artifact's web server and /api on the same origin), else
// localhost for plain `pnpm dev` setups.
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  (process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
    : "http://localhost:5173");

const startServer = process.env.PLAYWRIGHT_START_SERVER === "1";

const chromiumPath = resolveChromium();

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One retry absorbs transient browser-launch/navigation flakiness (EAGAIN,
  // slow first paint) when this suite runs concurrently with other Playwright
  // suites during validation.
  retries: 1,
  fullyParallel: false,
  // Constrained container: parallel chromium launches exhaust process/memory
  // limits during validation runs ("browserType.launch: Target ... closed").
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
  // Opt-in webServer for environments without an always-on workflow. On Replit
  // the artifact's dev workflow is already running, so leave this disabled by
  // default and just `reuseExistingServer`. The /api server is a sibling
  // workflow and must be running independently for auth bootstrap to succeed.
  webServer: startServer
    ? {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
