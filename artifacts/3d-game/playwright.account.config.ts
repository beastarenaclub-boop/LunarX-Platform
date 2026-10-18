import { defineConfig } from "@playwright/test";
import base from "./playwright.b2c.config";
export default defineConfig({
  ...base,
  testMatch: ["account-options.spec.ts", "b2c-storefront.spec.ts"],
  outputDir: "./test-results-account",
});
