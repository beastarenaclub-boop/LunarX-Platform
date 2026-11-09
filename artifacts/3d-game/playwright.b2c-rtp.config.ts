import {defineConfig} from "@playwright/test";
import base from "./playwright.game-sheet.config";
export default defineConfig({...base,testMatch:"b2c-rtp.spec.ts",outputDir:"../../test-results/b2c-rtp"});
