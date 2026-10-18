import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "account-security.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 40000,
  reporter: "list",
  outputDir: "./test-results-security",
  use: {
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
