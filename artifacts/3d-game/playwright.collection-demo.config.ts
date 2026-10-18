import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "collection-demo.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: "list",
  outputDir: "./test-results-collection-demo",
  use: {
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
