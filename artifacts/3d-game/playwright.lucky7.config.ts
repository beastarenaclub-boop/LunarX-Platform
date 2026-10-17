import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Opt-in cross-browser checks; the ordinary workspace test command is unchanged.
export default defineConfig({
  ...base,
  testMatch: /lucky7-(dealer-video|dice-playback|responsive)\.spec\.ts$/,
  retries: 0,
  use: { ...base.use, launchOptions: {} },
  projects: [
    { name: "chrome", use: { browserName: "chromium", launchOptions: base.use?.launchOptions } },
    { name: "firefox", use: { browserName: "firefox", launchOptions: {} } },
    { name: "webkit", use: { browserName: "webkit", launchOptions: {} } },
  ],
});
