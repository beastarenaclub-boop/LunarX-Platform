import { test, expect } from '@playwright/test';
const api = 'http://localhost:5180';
const games = ['dragon-tiger','lucky-7','teen-patti-live','baccarat','blackjack','teen-patti','andar-bahar','roulette','dice','mines','plinko','rummy','play','aviator','jetx','fury'];

test('automatic betting status and coins fit phone, landscape and desktop screens', async ({ page }) => {
  test.setTimeout(240000);
  const login = await page.request.post(`${api}/api/auth/login`, { headers: { 'x-test-bypass': 'shared-wallet-layout' }, data: { email: 'wallet-test@example.test', password: 'TestWallet12345' } });
  expect(login.ok()).toBe(true);
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('aviator:v1', JSON.stringify({ settings: { onboarded: true, sound: false } })));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.routeWebSocket('**/ws', ws => ws.onMessage(() => {}));
  await page.route('**/api/**', async route => {
    try {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
    if (url.pathname.endsWith('/active')) return route.fulfill({ contentType: 'application/json', body: 'null' });
    if (url.pathname.endsWith('/recent')) return route.fulfill({ json: [] });
    const response = await route.fetch({ url: `${api}${url.pathname}${url.search}`, maxRetries: 2, headers: { ...route.request().headers(), 'x-test-bypass': 'shared-wallet-layout' } });
    if (url.pathname.endsWith('/round')) {
      const data = await response.json(); const now = Date.now();
      return route.fulfill({ json: { config: { bettingWindowMs: 120000 }, liveBets: [], recent: [], playerCount: 0, totalStake: '0', ...data, roundId: 'layout-round', phase: 'betting', now, bettingEndsAt: now + 120000, revealEndsAt: now + 125000, settleEndsAt: now + 130000, myBets: [], outcome: null } });
    }
    return route.fulfill({ response });
    } catch (error) {
      if (!/closed|disposed|socket hang up|ECONNRESET/.test(String(error))) throw error;
      await route.abort().catch(() => {});
    }
  });
  for (const game of games) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${game}`);
    await expect(page.locator('[data-game-coin]:visible').first(), game).toBeVisible();
    for (const [width,height] of [[320,568],[390,844],[932,430],[1440,900]]) {
      await page.setViewportSize({ width,height });
      const status = page.getByTestId('auto-bet-status').filter({ visible: true }).first();
      await status.scrollIntoViewIfNeeded();
      const box = (await status.boundingBox())!;
      expect(box.x, `${game}: ${width}px left edge`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${game}: ${width}px right edge`).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height, `${game}: ${height}px bottom edge`).toBeLessThanOrEqual(height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), game).toBe(true);
    }
    expect(errors, game).toEqual([]);
    expect(writes, game).toEqual([]);
  }
  await page.close();
});
