import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: "list",
  outputDir: "./test-results",
  use: {
    baseURL: "http://127.0.0.1:5201",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1050 },
    geolocation: { latitude: 26.9124, longitude: 75.7873, accuracy: 80 },
    permissions: ["geolocation"],
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to .wrangler/qa-state --ip 127.0.0.1 --port 5201 --inspector-port 0",
    url: "http://127.0.0.1:5201",
    reuseExistingServer: true,
    timeout: 45000,
  },
});
