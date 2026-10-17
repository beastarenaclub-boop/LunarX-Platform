import { test, expect } from '@playwright/test';
import path from 'node:path';
const api = 'http://localhost:5180';
const games = ['lucky-7', 'dragon-tiger', 'rummy', 'teen-patti-live', 'baccarat', 'blackjack', 'teen-patti', 'andar-bahar', 'roulette', 'dice', 'mines', 'plinko',
  'play', 'aviator', 'jetx', 'fury'];
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'wait' }); });

for (const route of games) test(`${route}: consistent coins, bet size and browser-sized winner across resizing`, async ({ page }, info) => {
  const game = route === 'play' ? 'lunar' : route;
  const response = await page.request.post(`${api}/api/auth/login`, { headers: { 'x-test-bypass': 'shared-wallet-layout' },
    data: { email: 'wallet-test@example.test', password: 'TestWallet12345' } });
  expect(response.ok()).toBe(true);
  await page.addInitScript(() => localStorage.setItem('aviator:v1', JSON.stringify({ settings: { onboarded: true, sound: false } })));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.routeWebSocket('**/ws', ws => ws.onMessage(() => {}));
  await page.route('**/api/**', async route => {
    try {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `${api}${url.pathname}${url.search}`, maxRetries: 2 });
      if (url.pathname.endsWith('/round') && route.request().method() === 'GET') {
        const snapshot = await response.json();
        if (snapshot && snapshot.roundId) {
          const now = Date.now();
          return route.fulfill({ json: { ...snapshot, phase: 'betting', now, bettingEndsAt: now + 120000,
            revealEndsAt: now + 129000, settleEndsAt: now + 134000, outcome: null, myBets: [] } });
        }
      }
      await route.fulfill({ response });
    } catch (error) {
      if (!/closed|disposed|socket hang up|ECONNRESET/.test(String(error))) throw error;
      await route.abort().catch(() => {});
    }
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${route}`);
  const coin = page.locator('[data-game-coin]:visible').first();
  const bet = page.locator('[data-game-bet]:visible').first();
  await expect(coin).toBeVisible();
  await expect(bet).toBeVisible();
  await page.addScriptTag({ path: path.resolve('../../tmp/game-ui-harness.js') });
  for (const [width, height, coinSize, betHeight] of [[320,568,44,52], [390,844,48,64], [932,430,44,48], [960,540,48,52], [1024,768,52,80], [1440,900,52,80]]) {
    await page.setViewportSize({ width, height });
    await coin.scrollIntoViewIfNeeded();
    await expect.poll(async () => Math.round((await coin.boundingBox())!.width)).toBe(coinSize);
    expect(Math.round((await coin.boundingBox())!.height)).toBe(coinSize);
    await bet.scrollIntoViewIfNeeded();
    const box = (await bet.boundingBox())!;
    expect(Math.round(box.height)).toBe(betHeight);
    const betWidth = width >= 560 && (height <= 500 || width <= 1023 && width > height) ? Math.min(128, Math.max(72, (width - 160) / 6)) : Math.min(160, Math.max(72, (width - 80) / 3));
    expect(Math.abs(box.width - betWidth), `${route} bet width at ${width}x${height}: ${box.width}`).toBeLessThan(2);
    const mismatches = await page.locator('[data-game-coin]:visible, [data-game-bet]:visible').evaluateAll((elements, sizes) => elements.flatMap(el => {
      const rect = el.getBoundingClientRect(), coin = el.hasAttribute('data-game-coin');
      return Math.abs(rect.width - (coin ? sizes.coin : sizes.width)) < 2 && Math.abs(rect.height - (coin ? sizes.coin : sizes.height)) < 2
        ? [] : [{ id: el.getAttribute('data-testid'), width: rect.width, height: rect.height }];
    }), { coin: coinSize, width: betWidth, height: betHeight });
    expect(mismatches, `${route} controls at ${width}x${height}`).toEqual([]);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    // Resize an already open result, including switching between desktop/mobile surfaces.
    await page.evaluate(game => (window as any).showGameWin(game), game);
    const popup = page.getByTestId('round-win-dialog');
    await expect(popup).toBeVisible();
    await expect(popup).toHaveAttribute('data-game', game);
    await expect(page.getByTestId('round-win-profit')).toContainText('12,34,567.89');
    await page.setViewportSize({ width: width - 10, height: height - 20 });
    await expect.poll(async () => {
      const popupBox = await popup.boundingBox();
      const frame = await page.getByTestId('round-win-screen').boundingBox();
      return !!popupBox && !!frame && popupBox.x >= frame.x - 1 && popupBox.y >= frame.y - 1 &&
        popupBox.x + popupBox.width <= frame.x + frame.width + 1 && popupBox.y + popupBox.height <= frame.y + frame.height + 1 &&
        frame.x >= 0 && frame.y >= 0 && frame.x + frame.width <= width - 9 && frame.y + frame.height <= height - 19;
    }).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const frame = document.querySelector<HTMLElement>('[data-testid="round-win-screen"]')!.getBoundingClientRect();
      const viewport = window.visualViewport;
      return Math.abs(frame.x - (viewport?.offsetLeft ?? 0)) < 2 &&
        Math.abs(frame.y - (viewport?.offsetTop ?? 0)) < 2 &&
        Math.abs(frame.width - (viewport?.width ?? innerWidth)) < 2 &&
        Math.abs(frame.height - (viewport?.height ?? innerHeight)) < 2;
    })).toBe(true);
    await expect(page.getByTestId('round-win-ok')).toBeInViewport({ ratio: 1 });
    await page.getByTestId('round-win-ok').click();
    await expect(popup).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  await page.unrouteAll({ behavior: 'wait' });
});
