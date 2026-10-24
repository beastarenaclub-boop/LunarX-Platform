import { defineConfig } from '@playwright/test';
import base from './playwright.compact.config';

export default defineConfig({
  ...base,
  testMatch: ['mobile-game-fit.spec.ts', 'mobile-document-fit.spec.ts', 'mobile-tables.spec.ts'],
  outputDir: '../../tmp/mobile-game-fit-tests',
  timeout: 90000,
  fullyParallel: true,
  workers: 2,
  use: { ...base.use, isMobile: true, hasTouch: true },
  projects: base.projects?.filter(project => project.name === 'chromium'),
});
