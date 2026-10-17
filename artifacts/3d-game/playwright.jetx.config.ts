import base from "./playwright.compact.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({ ...base, testMatch: /jetx-(fit|motion|panels)\.spec\.ts/, outputDir: "test-results-jetx-fit" });
