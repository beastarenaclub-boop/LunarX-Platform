import { defineConfig } from "@playwright/test";
import base from "./playwright.instant-collection.config";

export default defineConfig({
  ...base,
  grep: /pirate|Chicken Road Pirate Edition/,
  outputDir: "../../tmp/pirate-audio-tests",
  use: { ...base.use, baseURL: "http://127.0.0.1:5369" },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --config vite.pirate-audio.config.ts",
    cwd: import.meta.dirname,
    url: "http://127.0.0.1:5369",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
