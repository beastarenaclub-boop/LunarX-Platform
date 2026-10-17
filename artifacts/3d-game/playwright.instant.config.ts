import { defineConfig } from "@playwright/test";
import base from "./playwright.compact.config";
export default defineConfig({ ...base, testMatch: "instant-games.spec.ts", outputDir: "test-results-instant", timeout: 45000, projects: [base.projects![0]] });
