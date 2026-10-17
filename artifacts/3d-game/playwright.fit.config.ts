import base from "./playwright.vegetable.config";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  ...base,
  testMatch: [
    "game-viewport.spec.ts",
    "vegetable-bowl.spec.ts",
    "racing-fit.spec.ts",
  ],
  timeout: 120000,
});
