import { defineConfig } from '@playwright/test';
import base from './playwright.game-ui.config';

export default defineConfig({ ...base, testMatch: 'dragon-tiger-payout.spec.ts' });
