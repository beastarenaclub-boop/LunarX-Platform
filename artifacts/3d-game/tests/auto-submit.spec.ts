import { test, expect, type Page } from '@playwright/test';
import { table } from './lucky7-table-fixture';

const api = 'http://localhost:5180';
const horse = process.env.HORSE_PREVIEW_URL ?? 'http://localhost:5183/horse-riding';
type Submission = { path: string; body: any };

async function setup(page: Page, game: string) {
  const login = await page.request.post(`${api}/api/auth/login`, { headers: { 'x-test-bypass': 'shared-wallet-layout' }, data: { email: 'wallet-test@example.test', password: 'TestWallet12345' } });
  expect(login.ok()).toBe(true);
  await page.addInitScript(() => localStorage.setItem('aviator:v1', JSON.stringify({ settings: { onboarded: true, sound: false } })));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.routeWebSocket('**/ws', ws => ws.onMessage(() => {}));
  const now = Date.now();
  await page.clock.install({ time: now });
  const posts: Submission[] = [], errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); console.log('Page error:', game, error.stack); });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    // All financial writes are intercepted. A rejection also exercises the
    // once-only rule: an unsuccessful request must not retry or repeat.
    if (url.pathname === '/api/horse-racing/round') return route.fulfill({ json: { roundId: 'test-horse-round' } });
    if (route.request().method() === 'POST') {
      posts.push({ path: url.pathname, body: route.request().postDataJSON() });
      return route.fulfill({ status: 400, json: { detail: 'Test rejection; no wallet was debited', error: { message: 'Test rejection' } } });
    }
    try {
      if (url.pathname.endsWith('/recent')) return route.fulfill({ json: [] });
      if (url.pathname === '/api/mines/active' || url.pathname === '/api/blackjack/active') return route.fulfill({ contentType: 'application/json', body: 'null' });
      const response = await route.fetch({ url: `${api}${url.pathname}${url.search}`, headers: { ...route.request().headers(), 'x-test-bypass': 'shared-wallet-layout' } });
      if (url.pathname === `/api/${game}/round`) {
        const snapshot = await response.json();
        return route.fulfill({ json: { config: { bettingWindowMs: 60000, revealDurationMs: 9000, settleDurationMs: 5000, minStakePaise: '100', maxStakePaise: '50000000' }, liveBets: [], recent: [], playerCount: 0, totalStake: '0', serverSeedHash: 'test', clientSeed: 'test', nonce: 1, ...snapshot, roundId: 'auto-submit-round', phase: 'betting', now: await page.evaluate(() => Date.now()),
          bettingEndsAt: now + 60000, revealEndsAt: now + 69000, settleEndsAt: now + 74000, outcome: null, myBets: [] } });
      }
      if (url.pathname === '/api/dragon-tiger/table') {
        const snapshot = await response.json();
        return route.fulfill({ json: { ...snapshot, serverNow: await page.evaluate(() => Date.now()), round: { id: 123, phase: 'betting', closesAt: now + 60000, revealsAt: now + 63000, endsAt: now + 69000 }, myBet: null } });
      }
      return route.fulfill({ response });
    } catch { await route.abort().catch(() => {}); }
  });
  return { posts, errors, now };
}

test.afterEach(async ({ page }) => { await page.close(); });

const timed = [
  ['baccarat', 'spot-player', '/api/baccarat/deal'],
  ['teen-patti', 'spot-playerA', '/api/teen-patti/deal'],
  ['andar-bahar', 'spot-andar', '/api/andar-bahar/deal'],
  ['roulette', '', '/api/roulette/spin'],
  ['lucky-7', 'spot-under', '/api/lucky-7/bet'],
  ['teen-patti-live', 'spot-playerA', '/api/teen-patti-live/bet'],
  ['blackjack', '', '/api/blackjack/deal'],
  ['dragon-tiger', 'dt-bet-dragon', '/api/dragon-tiger/bet'],
] as const;

for (const [game, spot, endpoint] of timed) test(`${game}: selects chips, submits once at countdown end, never retries`, async ({ page }) => {
  const { posts, errors, now } = await setup(page, game);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${game}`);
  const coin = page.locator('[data-game-coin]:visible').first();
  await expect(coin).toBeVisible();
  expect(posts).toEqual([]);
  if (game === 'roulette') await expect(page.getByTestId('round-timer-seconds')).toHaveText(/[1-9]/);
  await coin.click();
  if (spot) {
    await page.getByTestId(spot).click();
    if (game !== 'dragon-tiger') await page.getByTestId(spot).click();
  } else if (game === 'roulette') await page.getByTestId('cell-1').click();
  await expect(page.getByTestId('auto-bet-status').filter({ visible: true }).first()).toContainText('Auto bet');
  expect(posts).toEqual([]);
  // Move to the displayed clock's end, within the transport allowance.
  const elapsed = await page.evaluate(() => Date.now());
  await page.clock.fastForward(Math.max(1, now + 59000 - elapsed));
  await expect.poll(() => posts.filter(p => p.path === endpoint).length).toBe(1);
  const submitted = posts.find(p => p.path === endpoint)!;
  expect(submitted.body.roundId).toBe(game === 'dragon-tiger' ? 123 : 'auto-submit-round');
  if (spot && game !== 'dragon-tiger') expect(BigInt(submitted.body.bets[0].amountPaise)).toBeGreaterThan(0n);
  await page.clock.fastForward(80000);
  expect(posts.filter(p => p.path === endpoint)).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const [game, spot] of timed.filter(([game]) => ['baccarat','lucky-7','teen-patti-live','blackjack','dragon-tiger'].includes(game))) test(`${game}: cleared selection never spends`, async ({ page }) => {
  const { posts, now } = await setup(page, game);
  await page.goto(`/${game}`);
  await page.locator('[data-game-coin]:visible').first().click();
  if (spot) await page.getByTestId(spot).click();
  if (game === 'baccarat') await page.getByTestId('btn-clear').click();
  else if (game === 'dragon-tiger') await page.getByRole('button', { name: /clear/i }).click();
  else await page.getByRole('button', { name: 'Cancel selected bet' }).filter({ visible: true }).first().click();
  const elapsed = await page.evaluate(() => Date.now());
  await page.clock.fastForward(Math.max(1, now + 59000 - elapsed));
  await page.waitForTimeout(200);
  expect(posts).toEqual([]);
});

for (const game of ['dice','plinko','mines','rummy']) test(`${game}: coin starts a cancellable three-second single bet`, async ({ page }) => {
  const { posts, errors } = await setup(page, game);
  await page.goto(`/${game}`);
  const coin = page.locator('[data-game-coin]:visible').first();
  await expect(coin).toBeVisible();
  expect(posts).toEqual([]);
  await coin.click();
  await expect(page.getByTestId('auto-bet-status')).toContainText('Auto bet');
  await page.getByRole('button', { name: 'Cancel selected bet' }).click();
  await page.clock.fastForward(4000);
  expect(posts).toEqual([]);
  await coin.click();
  expect(posts).toEqual([]);
  await page.clock.fastForward(3100);
  await expect.poll(() => posts.length).toBe(1);
  await page.clock.fastForward(15000);
  expect(posts).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const game of ['play','aviator','jetx','fury']) test(`${game}: selecting one panel submits only that panel`, async ({ page }) => {
  const { posts, errors } = await setup(page, game);
  await page.goto(`/${game}`);
  const panel = page.getByTestId('bet-panel-0').filter({ visible: true }).first();
  const coin = panel.locator('[data-game-coin]').first();
  await expect(coin).toBeVisible();
  expect(posts).toEqual([]);
  await coin.click();
  await expect(panel.getByTestId('auto-bet-status')).toContainText('Auto bet');
  expect(posts).toEqual([]);
  // Run the local round clock normally to include its per-frame updates.
  await page.clock.runFor(15000);
  await expect.poll(() => posts.filter(p => p.path.includes('/bets/place')).length).toBe(1);
  expect(errors).toEqual([]);
});

for (const route of ['/', '/race']) test(`horse ${route}: selected coin submits after three seconds`, async ({ page }) => {
  const { posts, errors } = await setup(page, 'horse-racing');
  await page.goto(`${horse}${route}`);
  if (route === '/') await page.locator('[data-testid^="back-"]').first().click();
  else await page.getByRole('button').filter({ hasText: /\d+\.\d+x/ }).first().click();
  const coin = page.locator('[data-game-coin]:visible').first();
  await expect(coin).toBeVisible();
  expect(posts).toEqual([]);
  await coin.click();
  await expect(page.getByTestId('auto-bet-status')).toContainText('Auto bet');
  expect(posts).toEqual([]);
  await page.clock.fastForward(3100);
  await expect.poll(() => posts.length).toBeGreaterThan(0);
  await page.clock.fastForward(15000);
  expect(posts.filter(p => p.path === '/api/horse-racing/play')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('accepted chips aggregate into one slip and a new round does not repeat it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const round = await table(page, false, 0, { bettingMs: 15000 });
  const coin = page.getByRole('button', { name: '₹100 coin', exact: true }).filter({ visible: true }).first();
  await coin.click();
  await page.getByTestId('spot-under').click();
  await page.getByTestId('spot-under').click();
  expect(round.submissions).toEqual([]);
  await expect(page.getByTestId('chipstack-under')).toHaveText('200.00');
  await expect.poll(() => round.submissions.length, { timeout: 16000 }).toBe(1);
  expect(round.submissions).toEqual([{ bets: [{ type: 'under', amountPaise: '20000' }] }]);
  await expect(page.getByTestId('text-lucky7-balance')).toContainText('800.00');
  round.nextBetting('next-auto-round', 4000);
  await expect(page.getByTestId('auto-bet-status').filter({ visible: true }).first()).toContainText('Select coins');
  await page.waitForTimeout(4500);
  expect(round.submissions).toHaveLength(1);
});

test('crash selection survives a phone resize and cancels across every layout', async ({ page }) => {
  const { posts, errors } = await setup(page, 'play');
  await page.goto('/play');
  const panel = page.getByTestId('bet-panel-0').filter({ visible: true }).first();
  await expect(panel.locator('[data-game-coin]').first()).toBeVisible();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
  await panel.locator('[data-game-coin]').first().click();
  await expect(panel.getByTestId('auto-bet-status')).toContainText('Auto bet');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByTestId('auto-bet-status')).toContainText('Auto bet');
  await panel.getByRole('button', { name: 'Cancel selected bet' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(panel.getByTestId('auto-bet-status')).toContainText('Select coins');
  await page.clock.runFor(10000);
  expect(posts.filter(p => p.path.includes('/bets/place'))).toEqual([]);
  expect(errors).toEqual([]);
});
