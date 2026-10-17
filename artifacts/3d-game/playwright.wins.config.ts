import { defineConfig } from "@playwright/test";
import browsers from "./playwright.compact.config";

export default defineConfig({
  ...browsers,
  testMatch: ["winning-popups.spec.ts", "game-popup-lifecycle.spec.ts"],
  outputDir: "../../tmp/winning-popups-results",
});
