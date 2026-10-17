import { defineConfig } from "@playwright/test";
import base from "./playwright.compact.config";

export default defineConfig({
  ...base,
  testMatch: "game-performance.spec.ts",
  outputDir: "test-results-performance",
  projects: base.projects?.filter(project => project.name === "chromium"),
});
