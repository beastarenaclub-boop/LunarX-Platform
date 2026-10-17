import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
export default defineConfig({
  testDir: './tests', testMatch: 'game-ui-sizing.spec.ts', timeout: 90000,
  expect: { timeout: 15000 }, retries: 0, workers: 1, reporter: [['list']],
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5178',
    headless: true, screenshot: 'only-on-failure', trace: 'off' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { executablePath: chrome } } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
