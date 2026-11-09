import { defineConfig } from "@playwright/test";
import base from "./playwright.game-sheet.config";
export default defineConfig({ ...base, testMatch: "master-rtp.spec.ts", outputDir: "../../test-results/master-rtp" });
