import { test, expect, type Page } from '@playwright/test';
import { mockResponsiveGame } from './fixtures/responsive-game-data';
import { INSTANT_COLLECTION } from '@workspace/api-zod/instant-collection';
import { quotesFor } from '../../api-server/src/services/pokerMath';
import type { PokerGame } from '@workspace/api-zod/poker';
import { setup as horse } from './horse-live-fixture';
import { setup as bike } from './bike-live-fixture';

async function setup(page: Page, route: string) {
  const cleanup = await mockResponsiveGame(page, route);
  await page.route('**/api/network/website', r => r.fulfill({ json: null }));
  await page.route('**/api/instant/**/state', r => r.fulfill({ json: { round: null, history: [] } }));
  await page.route('**/api/**/history', r => r.fulfill({ json: [] }));
  if (route === 'coin-flip') await page.route('**/api/instant/coin-flip/config', r => r.fulfill({ json: {
    enabled: true, rtp: .97, minStakePaise: '1000', maxStakePaise: '50000000', maxMultiplier: 1000,
  } }));
  if (route === 'plinko') {
    await page.route('**/api/plinko/config', r => r.fulfill({ json: {
      enabled: true, houseEdge: .05, maxStakePaise: '10000000', maxMultiplier: 1000,
      multipliers: Object.fromEntries(['low', 'medium', 'high'].map(risk => [risk,
        Object.fromEntries([8, 12, 16].map(rows => [rows, Array.from({ length: rows + 1 }, (_, i) => i === 0 || i === rows ? 15 : .5)]))])),
    } }));
    await page.route('**/api/plinko/seed', r => r.fulfill({ json: { serverSeedHash: 'a'.repeat(64), clientSeed: 'player', nextNonce: 0 } }));
  }
  if (route === 'andar-bahar-live') await page.route('**/api/andar-bahar/config', r => r.fulfill({ json: { enabled: true, maxBetsPerDeal: 10, maxMultiplier: 100, maxStakePaise: '50000000', payouts: { firstSide: 1.65, secondSide: 1.75, ranges: {} } } }));
  if (route === 'baccarat') {
    await page.route('**/api/baccarat/config', async r => {
      await r.fulfill({ json: { enabled: true, decks: 8, maxMultiplier: 12, minStakePaise: '100', maxStakePaise: '50000000', maxBetsPerDeal: 5, payouts: { player: 1.8, banker: 1.75, tie: 8.56, playerPair: 10.91, bankerPair: 10.91 } } });
    });
  }
  if (route.startsWith('poker-')) await page.route('**/api/poker/**', r => {
    const now = Date.now();
    const hands = route === 'poker-six-players' ? [[17,29],[0,39],[36,6],[44,19],[40,20],[24,14]] : [[26,20],[28,39]];
    return r.fulfill({ json: { enabled: true, serverNow: now, balancePaise: '1000000', quoteId: 'mobile:1', quotes: quotesFor(route as PokerGame, hands), slips: [], recent: [], history: [], round: { id: 1, game: route, phase: 'betting', phaseEndsAt: now + 120000, closesAt: now + 120000, revealsAt: now + 131000, endsAt: now + 138000, commitment: 'layout', hands: route === 'poker-six-players' ? hands : [[null,null],[null,null]], board: [null,null,null,null,null] } } });
  });
  return cleanup;
}

const routes = ['jetx', 'fury', 'mines', 'plinko', 'dice', 'roulette', 'baccarat', 'blackjack', 'teen-patti', 'teen-patti-live', 'andar-bahar', 'lucky-7', 'dragon-tiger', 'rummy', 'vegetable-bowl', 'chicken-road', 'crazy-time', 'dragon-tiger-one-day', 'forex-trading', 'wheel-2-live', 'lucky-7-live', 'andar-bahar-live', ...INSTANT_COLLECTION.map(game => game.code), 'wingo', 'lunar-colour-trading', 'poker-one-day', 'poker-20-20', 'poker-six-players', 'horse-racing', 'bike-racing'];
const controls = '[data-game-coin], [data-game-bet], .ic-play, .cf-play, .cr-play, .w20-bet, .w20-chips button, .l7-spot, .l7-chip, .ab-bet, .ab-chips button, .pk-market, .pk-chip-row button, [data-testid="poker-confirm"], [data-testid="collection-play"], [data-testid^="crazy-spot-"]';

for (const route of routes) test(`${route}: mobile controls remain reachable after rotation`, async ({ page, baseURL }, info) => {
  const cleanup = await setup(page, route);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const racing = route === 'horse-racing' || route === 'bike-racing';
    if (racing) {
      // Exercise the supported flat renderer without changing layout or controls.
      await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type: string, ...args: any[]) {
          return type.includes('webgl') ? null : getContext.call(this, type as any, ...args);
        } as typeof getContext;
      });
      process.env.HORSE_GAME_URL = `${baseURL}/horse-racing`;
      process.env.BIKE_GAME_URL = `${baseURL}/bike-racing`;
      await (route === 'horse-racing' ? horse : bike)(page, { holdBetting: true });
    } else await page.goto(`/${route}`, { waitUntil: 'domcontentloaded' });
    const frame = page.locator('[data-game-viewport]');
    await expect(frame.locator(controls).filter({ visible: true }).first()).toBeVisible({ timeout: 30000 });
    if (route === 'mines' || route === 'plinko') {
      const play = page.getByTestId(route === 'mines' ? 'btn-mines-place' : 'btn-plinko-drop');
      await expect(play).toBeEnabled();
      await expect(play).toBeInViewport({ ratio: 1 });
    }
    for (const [width, height] of [[390, 844], [320, 568], [844, 390], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      if (racing) await page.clock.runFor(300);
      if (!['wingo', 'lunar-colour-trading'].includes(route)) await expect.poll(() => frame.evaluate(el => Math.abs(el.getBoundingClientRect().bottom - innerHeight))).toBeLessThanOrEqual(1);
      expect(await frame.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      const available = frame.locator(controls).filter({ visible: true });
      for (const control of [available.first(), available.last()]) {
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport({ ratio: .99 });
        const box = (await control.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(32);
        if (await control.isEnabled()) {
          expect(await control.evaluate(el => {
            const r = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          }), `${route} control is covered at ${width}x${height}`).toBe(true);
          await control.click({ trial: true, timeout: 5000 });
        }
      }
      await frame.evaluate(el => { el.scrollTop = 0; });
      if (['wingo', 'lunar-colour-trading'].includes(route)) await page.evaluate(() => window.scrollTo(0, 0));
      if (width === 390) await page.screenshot({ path: info.outputPath('phone.png') });
    }
    expect(errors).toEqual([]);
  } finally { cleanup(); }
});

for (const route of ['jetx', 'mines', 'chicken-road', 'wheel-2-live']) test(`${route}: session banner and keyboard share the available screen`, async ({ page }) => {
  const cleanup = await setup(page, route);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${route}`);
  const frame = page.locator('[data-game-viewport]');
  await expect(frame.locator('button:visible').first()).toBeVisible();
  // Reproduce asynchronously inserted/resized session chrome without starting a demo account.
  await frame.evaluate(el => {
    const banner = document.createElement('div');
    banner.id = 'test-session-banner';
    banner.style.height = '64px';
    banner.textContent = 'Demo session';
    el.before(banner);
  });
  for (const height of [844, 350, 700]) {
    await page.setViewportSize({ width: 390, height });
    await expect.poll(() => frame.evaluate(el => Math.round(el.getBoundingClientRect().bottom))).toBe(height);
    await expect(frame).toHaveAttribute('data-fit-scale', '1.000');
  }
  await page.locator('#test-session-banner').evaluate(el => { el.style.height = '96px'; });
  await expect.poll(() => frame.evaluate(el => el.clientHeight)).toBe(604);
  await page.locator('#test-session-banner').evaluate(el => el.remove());
  await expect.poll(() => frame.evaluate(el => el.clientHeight)).toBe(700);
  cleanup();
});
