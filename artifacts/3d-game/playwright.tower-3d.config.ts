import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "tower-rush.spec.ts", workers: 1,
  timeout: 120000, expect: { timeout: 20000 }, reporter: "list",
  outputDir: "../../tmp/tower-reference/3d-tests",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5180", headless: true,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined), args: ["--enable-unsafe-swiftshader"] },
    screenshot: "only-on-failure", trace: "retain-on-failure",
  },
});
