import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["game-audio.spec.ts", "public-demo-audio.spec.ts", "audio-autostart.spec.ts"],
  workers: 1,
  retries: 0,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:5186",
    headless: true,
    launchOptions: { executablePath: existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined },
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1",
    cwd: import.meta.dirname,
    env: { PORT: "5186" },
    url: "http://127.0.0.1:5186/tests/fixtures/game-audio.html",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
