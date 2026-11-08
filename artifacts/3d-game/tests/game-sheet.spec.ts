import { test, expect, type Page } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";
import { LUDO } from "@workspace/api-zod/ludo";

const amounts = [100, 500, 1000, 10000, 25000, 50000];
const config = { enabled: true, houseEdge: .15, rtp: .85, maxMultiplier: 1000, minStakePaise: "100", maxStakePaise: "5000000", bettingWindowMs: 120000, revealDurationMs: 10000, settleDurationMs: 5000, coinPayoutVersion: 2, sevenPayoutVersion: 2, payoutVersion: 2 };
async function setup(page: Page) {
  await mockGames(page);
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname, now = Date.now();
    let json: unknown;
    if (path.startsWith('/api/crash/')) return route.fallback();
    if (path.includes("/wallet/")) json = { balance: "20000000", currency: "INR", scope: "lunar" };
    else if (path.includes("/wingo/")) json = { mode: "wallet", serverTime: now, player: { id: "viewport-test", balance: 20000000 }, round: { payoutVersion: 4, period: "30-100", duration: 30, start: now, ends: now + 120000, commitment: "test" }, history: [], bets: [], summary: { played: 0, won: 0, profit: 0 }, pending: 0, lockSeconds: 5, minStake: 100, maxStake: 5000000 };
    else if (path === "/api/ludo/state") json = { serverNow: now, balancePaise: "20000000", enabled: true, entries: LUDO.entries, match: null, recent: [] };
    else if (path === "/api/chicken-road/state") json = { round: null, history: [] };
    else if (path.includes("/poker/") && path.endsWith("/table")) json = { enabled: true, serverNow: now, balancePaise: "20000000", quoteId: "test", quotes: [], slips: [], recent: [], history: [], round: { id: 1, game: "poker-20-20", phase: "betting", phaseEndsAt: now + 120000, closesAt: now + 120000, revealsAt: now + 130000, endsAt: now + 140000, commitment: "test", hands: [[null,null],[null,null]], board: [null,null,null,null,null] } };
    else if (path.endsWith("/config")) json = { ...config, multipliers: Object.fromEntries(["low", "medium", "high"].map(r => [r, Object.fromEntries([8,12,16].map(n => [n, Array(n+1).fill(1.98)]))])) };
    else if (path.endsWith("/round")) json = { roundId: "sheet-round", gameCode: path.split('/')[2], phase: "betting", now, bettingEndsAt: now + 120000, revealEndsAt: now + 130000, settleEndsAt: now + 135000, config, serverSeedHash: "test", clientSeed: "test", nonce: 1, outcome: null, serverSeed: null, totalStake: "0", playerCount: 0, liveBets: [], myBets: [], recent: [] };
    else if (path.includes("/instant/") && path.endsWith("/state")) json = { round: null, history: [] };
    else if (path.includes("/plinko/seed")) json = { serverSeedHash: "test", clientSeed: "test", nextNonce: 0 };
    else if (path.endsWith("/history")) json = [];
    else return route.fallback();
    await route.fulfill({ json });
  });
}

const games = [
  ["lucky-7-live", ".l7-chip-rack"], ["wheel-2-live", ".w20-chips"],
  ["poker-20-20", ".pk-chip-row > div"], ["crazy-time", ".ct-chip-rack"],
  ["chicken-road", ".cr-coins"], ["7up7down", ".sud-chip-menu"],
  ["jetx", ".jetx-quick-stakes"], ["fury", "[data-testid^=chip-rack]"],
  ["mines", "[data-testid=chip-rack-mines]"], ["coin-flip", "[data-testid=chip-rack-coin-flip]"],
  ["plinko", "[data-testid=chip-rack-plinko]"], ["wingo", "[data-testid=chip-rack]"],
];
for (const [game, selector] of games) test(`${game}: six requested stake buttons fit mobile`, async ({ page }, info) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`/${game}`);
  if (game === "7up7down") await page.getByRole("button", { name: "Choose chip value", exact: true }).click();
  if (game === "poker-20-20") await page.getByRole("button", { name: /^Stake / }).click();
  const rack = page.locator(selector).filter({ visible: true }).first();
  await expect(rack).toBeVisible();
  for (const value of amounts) {
    // Check semantic amounts as well as abbreviated chip artwork (25k/50k).
    await expect.poll(async () => rack.locator("button").evaluateAll((buttons, n) => buttons.some(b => {
      const label = `${b.getAttribute('aria-label') ?? ''} ${b.getAttribute('data-testid') ?? ''} ${b.textContent ?? ''}`.replaceAll(',', '');
      return new RegExp(`(?:^|[^0-9])${n}(?:[^0-9]|$)`).test(label) || (n >= 1000 && new RegExp(`(?:^|[^0-9])${n/1000}k(?:[^0-9]|$)`, 'i').test(label));
    }), value)).toBe(true);
  }
  const box = await rack.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  if (game === "plinko") await expect(page.getByRole("button", { name: /^(Manual|Auto drops|Start auto drops)$/ })).toHaveCount(0);
  if (game === "coin-flip") await expect(page.getByText("Rate 0.98", { exact: false })).toBeVisible();
  if (game === "crazy-time") await expect(page.getByTestId("crazy-spot-1")).toContainText(/\d+\.\d+–\d+\.\d+×/);
  await page.screenshot({ path: info.outputPath(`${game}.png`) });
  expect(errors).toEqual([]);
});

test("Ludo offers 2, 3, 4 seats and the six entry fees", async ({ page }, info) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/ludo');
  await page.getByRole('button', { name: 'Play against Computer', exact: true }).click();
  for (const n of [2,3,4]) await expect(page.getByRole('button', { name: new RegExp(`^${n} players`) })).toBeVisible();
  await page.getByRole('button', { name: /^3 players/ }).click();
  await expect(page.getByRole('button', { name: /^3 players/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ld-entries button')).toHaveCount(6);
  await page.screenshot({ path: info.outputPath('ludo-three-seats.png') });
});

test("Fury's direct Bet action submits the chosen amount exactly once", async ({ page }) => {
  await setup(page);
  const posts: any[] = [];
  await page.route('**/api/bets/place', async route => {
    const body = route.request().postDataJSON(); posts.push(body);
    await route.fulfill({ json: { id: 'fury-accepted', panel: body.panel, stakeAmount: body.stakeAmount, status: 'placed', payoutAmount: '0' } });
  });
  await page.goto('/fury');
  const panel = page.getByTestId('bet-panel-0').filter({ visible: true }).first();
  await panel.locator('[data-testid$="-50000"]').click();
  const bet = panel.getByTestId('btn-bet-0');
  await expect(bet).toBeEnabled();
  await bet.evaluate((b: HTMLButtonElement) => { b.click(); b.click(); });
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].stakeAmount).toBe('5000000');
  await expect(panel.getByTestId('btn-cancel-0')).toBeVisible();
});

test("Plinko shows a bold WIN and a separate payout after a successful drop", async ({ page }, info) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/plinko/drop', route => route.fulfill({ json: {
    id: 'plinko-win', betId: 'plinko-bet', stakeAmount: '10000', rows: 12, risk: 'medium',
    path: Array(12).fill('L'), bucket: 0, multiplier: 1.98, payoutAmount: '19800',
    serverSeed: null, serverSeedHash: 'test', clientSeed: 'test', nonce: 0,
    houseEdge: .15, maxMultiplier: 1000, createdAt: new Date().toISOString(),
  } }));
  await page.goto('/plinko');
  await page.getByRole('button', { name: 'Drop ball', exact: true }).click();
  const label = page.locator('.plinko-win-label');
  await expect(label).toHaveText('WIN');
  expect(Number(await label.evaluate(el => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(700);
  await expect(page.getByTestId('plinko-last-payout')).toHaveText('₹198.00');
  await page.screenshot({ path: info.outputPath('plinko-win.png') });
});
