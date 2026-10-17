import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["mobile-website.spec.ts", "site-theme.spec.ts", "instant-collection.spec.ts"],
  outputDir: "../../tmp/mobile-website-tests",
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5328",
    headless: true,
    screenshot: "only-on-failure",
    browserName: process.env.MOBILE_BROWSER === "webkit" ? "webkit" : "chromium",
    launchOptions: process.env.MOBILE_BROWSER === "webkit" ? {} : { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" },
  },
});
