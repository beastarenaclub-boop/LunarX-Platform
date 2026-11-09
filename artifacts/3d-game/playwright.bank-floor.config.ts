import {defineConfig} from "@playwright/test";
import base from "./playwright.game-sheet.config";
export default defineConfig({...base,testMatch:"bank-floor.spec.ts",outputDir:"../../test-results/bank-floor"});
