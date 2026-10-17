import base from "./playwright.compact.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...base,
  testMatch: "all-games-responsive.spec.ts",
  timeout: 180000,
  expect: { timeout: 30000 },
  outputDir: "test-results-responsive",
});
