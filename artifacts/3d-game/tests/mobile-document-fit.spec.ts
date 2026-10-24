import { test, expect } from '@playwright/test';
import { mockResponsiveGame } from './fixtures/responsive-game-data';
import { SPORTS } from '../../../lib/virtual-sports/catalog.mjs';
import { PRIZE_DEFAULTS } from '@workspace/api-zod/prize-lotto';

// These games use document scrolling instead of GameViewport.
for (const route of ['lottery', 'prize-lotto', ...SPORTS.map(sport => `virtual-sports/${sport.id}`)]) {
  test(`${route}: document layout keeps mobile controls reachable`, async ({ page }, info) => {
    const cleanup = await mockResponsiveGame(page, route);
    const now = Date.now();
    const settings = { brand: 'Irland Lotto', interval: 60, unitPrice: 10, maxTicket: 10000, payouts: { '2D': 90, '3D': 900, Titli: 9 }, salesEnabled: true, timezone: 'Asia/Kolkata' };
    await page.route('**/api/network/website', r => r.fulfill({ json: null }));
    await page.route('**/api/lottery/bootstrap', r => r.fulfill({ json: {
      account: { id: 'mobile', name: 'Mobile player', role: 'user', parent_id: null, balance: 100000, commission: 0, active: 1, created: now },
      mode: 'wallet', serverTime: Date.now(), settings,
      draws: [{ id: 'LOTTO-1', closes: now + 600000, ends: now + 610000, status: 'open', commitment: 'layout', results: null, config: settings }],
      tickets: [], accounts: [], ledger: [], complaints: [], audit: [],
      stats: { sales: 0, tickets: 0, prizes: 0, commission: 0, pendingClaims: 0, cancelled: 0 },
    } }));
    await page.route('**/api/prize-lotto/state?*', r => r.fulfill({ json: {
      serverTime: Date.now(), balance: 100000, salesEnabled: true, maxTicket: 10000,
      draws: [{ id: 'PRIZE-1', closes: now + 600000, ends: now + 610000, status: 'open', commitment: 'layout', result: null, config: PRIZE_DEFAULTS }],
      tickets: [], ticketCount: 0, page: 1, pages: 1,
    } }));
    await page.route('**/api/virtual-sports/state', r => r.fulfill({ json: {
      mode: 'wallet', currency: 'INR', accountId: 'mobile', serverTime: Date.now(), account: { balance: 100000, refillAt: now },
      rounds: SPORTS.map(sport => ({ id: `mobile-${sport.id}`, sport: sport.id, starts: now, closes: now + 600000, ends: now + 610000, next: now + 620000, phase: 'betting', odds: sport.selections.map(() => 2), events: [], score: [0, 0], winner: null, order: [0, 1, 2, 3] })),
      bets: [], results: [],
    } }));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${route}`, { waitUntil: 'domcontentloaded' });
      const controls = page.locator(route === 'lottery' ? '.player-buy, .lottery-coins [data-game-coin]' : route === 'prize-lotto' ? '.pl-primary, .pl-reward' : '.vs-odds-grid button, [data-testid="sports-place"]');
      await expect(controls.first()).toBeVisible({ timeout: 30000 });
      for (const [width, height] of [[390, 844], [320, 568], [844, 390], [1280, 800]]) {
        await page.setViewportSize({ width, height });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        for (const control of [controls.first(), controls.last()]) {
          await control.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
          await expect(control).toBeInViewport({ ratio: .99 });
          expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(32);
          if (await control.isEnabled()) await control.click({ trial: true });
        }
        await page.evaluate(() => scrollTo(0, 0));
        if (width === 390) await page.screenshot({ path: info.outputPath('phone.png') });
      }
      expect(errors).toEqual([]);
    } finally { cleanup(); }
  });
}
