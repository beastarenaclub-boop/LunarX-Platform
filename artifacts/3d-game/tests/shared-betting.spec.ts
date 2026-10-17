import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.clock.install();
  const now = await page.evaluate(() => Date.now());
  const posts: { path: string; body: any }[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("aviator:v1", JSON.stringify({ settings: { onboarded: true, sound: false } })));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.routeWebSocket("**/*", ws => ws.onMessage(() => {}));
  let round = 1, start = now, clockStarted = false;
  await page.route("**/api/**", async route => {
    const p = new URL(route.request().url()).pathname;
    // A request can outlive its document when this test changes games.
    let time = start;
    try { time = await page.evaluate(() => Date.now()); }
    catch (error) { if (!/Execution context was destroyed/.test(String(error))) throw error; }
    if (!clockStarted && (p.endsWith("/round") || p === "/api/wingo/session")) {
      start = time;
      clockStarted = true;
    }
    const config = { enabled: true, houseEdge: 0.03, maxMultiplier: 1000,
      minStakePaise: "100", maxStakePaise: "1000000", bettingWindowMs: 40000,
      revealDurationMs: 18000, settleDurationMs: 5000, minTarget: 2, maxTarget: 98,
      rowsOptions: [8, 12, 16], riskOptions: ["low", "medium", "high"],
      multipliers: Object.fromEntries(["low", "medium", "high"].map(risk => [risk, Object.fromEntries([8, 12, 16].map(n => [n, Array(n + 1).fill(1.5)]))])),
      payouts: { under: 1.98, exactly: 20, over: 1.98 } };
    let json: unknown = {};
    if (p === "/api/auth/me") json = { id: "shared-bet-user", email: "bet@example.test", displayName: "Player", role: "player" };
    else if (p.startsWith("/api/wingo/") && !p.endsWith("/bets")) json = {
      serverTime: time, player: { id: "practice-player", balance: 1000000 },
      round: { period: `period-${round}`, duration: 30, start, ends: start + 40000, commitment: "test" },
      history: [], bets: [], summary: { played: 0, won: 0, profit: 0 }, pending: 0, lockSeconds: 5, minStake: 100, maxStake: 1000000,
    };
    else if (route.request().method() === "POST") {
      posts.push({ path: p, body: route.request().postDataJSON() });
      return route.fulfill({ status: 400, json: { detail: "Test rejection", error: { message: "Test rejection" } } });
    }
    else if (p.includes("/config")) json = p.includes("/game/") ? { ...config, bettingWindowMs: 10000 } : config;
    else if (p.endsWith("/round")) json = { roundId: `round-${round}`, gameCode: p.split("/")[2], phase: "betting", now: time,
      bettingEndsAt: start + 40000, revealEndsAt: start + 58000, settleEndsAt: start + 63000, config,
      serverSeedHash: "test", clientSeed: "test", nonce: 1, outcome: null, serverSeed: null, totalStake: "0", playerCount: 0, liveBets: [], myBets: [], recent: [] };
    else if (p.includes("/wallet/")) json = { balance: "1000000", currency: "INR", scope: "lunar" };
    else if (/recent|registry|banners/.test(p)) json = [];
    else if (/active$/.test(p)) json = null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(json) });
  });
  return { get now() { return start; }, posts, errors, async nextRound() { round++; start = await page.evaluate(() => Date.now()); } };
}

for (const game of ["mines", "dice", "plinko"]) test(`${game}: shared coins keep cancellable single auto bet`, async ({ page }) => {
  const app = await setup(page);
  await page.goto(`/${game}`);
  const coin = page.locator("[data-game-coin]:visible").first();
  await expect(coin).toBeEnabled();
  expect(app.posts).toEqual([]);
  await coin.click();
  await expect(page.getByTestId("auto-bet-status")).toContainText("Auto bet");
  await page.getByRole("button", { name: "Cancel selected bet" }).click();
  await page.clock.fastForward(4000);
  expect(app.posts).toEqual([]);
  await coin.click();
  await page.clock.fastForward(3100);
  await expect.poll(() => app.posts.length).toBe(1);
  await page.clock.fastForward(12000);
  expect(app.posts).toHaveLength(1);
  expect(app.errors).toEqual([]);
});

test("coin settings persist across all newly connected game families without arming bets", async ({ page }) => {
  test.setTimeout(180000);
  const app = await setup(page);
  await page.addInitScript(() => localStorage.setItem("table-coins:v2:shared-bet-user", JSON.stringify({ values: [10, 20, 50, 200], showCustom: true })));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/vegetable-bowl");
  await expect(page.getByTestId("chip-100")).toBeVisible();
  await expect(page.getByTestId("chip-500")).toBeVisible();
  await page.getByTestId("coin-settings-button").click();
  await page.getByRole("checkbox", { name: "₹2,000 coin", exact: true }).click();
  await page.getByTestId("coin-settings-save").click();
  for (const game of ["vegetable-bowl", "mines", "dice", "plinko", "play", "aviator", "lucky-7", "wingo"]) {
    await page.goto(`/${game}`);
    await expect(page.locator("[data-game-coin]:visible").first()).toBeVisible();
    const rack = page.locator(".coin-rack-fit:visible").first();
    await expect(rack.locator('[data-testid$="-2000"]')).toHaveCount(0);
    await expect(rack.locator('[data-testid$="-10"]')).toHaveCount(0);
    await expect(rack.locator('[data-testid$="-100"]')).toBeVisible();
    await expect(page.getByTestId("coin-settings-button").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByTestId("auto-bet-status").filter({ visible: true }).first()).toContainText("Select coins");
    if (game !== "wingo") for (const coin of await rack.locator("[data-game-coin]").all()) await expect(coin).toBeInViewport({ ratio: .999 });
  }
  expect(app.posts).toEqual([]);
  expect(app.errors).toEqual([]);
});

test("vegetable cancel, expired drafts and rejected slips never repeat", async ({ page }) => {
  const app = await setup(page);
  await page.goto("/vegetable-bowl");
  await page.getByTestId("chip-100").click();
  await page.locator('[data-mode="normal"]').click();
  await page.locator('[data-mode="normal"]').click();
  await page.locator('[data-mode="risk"]').click();
  await expect(page.getByTestId("vegetable-selected-total")).toHaveText("₹300.00");
  await page.getByTestId("chip-10000").click();
  await page.locator('[data-mode="normal"]').click();
  await expect(page.getByTestId("vegetable-selected-total")).toHaveText("₹300.00");
  await page.getByRole("button", { name: "Cancel selected bet" }).click();
  await page.clock.fastForward(5000);
  expect(app.posts).toEqual([]);
  await page.getByTestId("chip-100").click();
  await page.locator('[data-mode="hard"]').click();
  await page.locator('[data-mode="hard"]').click();
  await page.locator('[data-mode="risk"]').click();
  await page.clock.fastForward(Math.max(1, app.now + 38850 - await page.evaluate(() => Date.now())));
  await expect.poll(() => app.posts.length).toBe(1);
  expect(app.posts[0].body.bets).toEqual([{ type: "hard", amountPaise: "20000" }, { type: "risk", amountPaise: "10000" }]);
  await app.nextRound();
  await page.clock.fastForward(3100);
  await expect(page.getByTestId("auto-bet-status")).toContainText("Select coins");
  await page.locator('[data-mode="risk"]').click();
  await page.clock.fastForward(60000);
  expect(app.posts).toHaveLength(1);
  expect(app.errors).toEqual([]);
});

test("crash shared coins submit only the selected panel after a phone resize", async ({ page }) => {
  const app = await setup(page);
  await page.goto("/play");
  const panel = page.getByTestId("bet-panel-0").filter({ visible: true }).first();
  await expect(panel.locator("[data-game-coin]").first()).toBeEnabled();
  await panel.locator("[data-game-coin]").first().click();
  await expect(panel.getByTestId("auto-bet-status")).toContainText("Auto bet");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByTestId("auto-bet-status")).toContainText("Auto bet");
  await page.clock.runFor(11000);
  await expect.poll(() => app.posts.filter(post => post.path.includes("/bets/place")).length).toBe(1);
  expect(app.errors).toEqual([]);
});

test("WinGo shares coins, cancellation and once-only timed betting", async ({ page }) => {
  const app = await setup(page);
  await page.goto("/wingo");
  await expect(page.getByTestId("chip-100")).toBeEnabled();
  expect(app.posts).toEqual([]);
  await page.getByRole("button", { name: "Big", exact: false }).filter({ has: page.locator("strong") }).click();
  await expect(page.getByTestId("auto-bet-status")).toContainText("Auto bet");
  await page.getByRole("button", { name: "Cancel selected bet" }).click();
  await expect(page.getByTestId("auto-bet-status")).toContainText("Select coins");
  await page.getByTestId("chip-500").click();
  await page.getByRole("button", { name: "Pick number 7", exact: true }).click();
  await page.clock.fastForward(Math.max(1, app.now + 33850 - await page.evaluate(() => Date.now())));
  await expect.poll(() => app.posts.length).toBe(1);
  expect(app.posts[0]).toMatchObject({ path: "/api/wingo/bets", body: { pick: "7", stake: 50000, period: "period-1" } });
  await app.nextRound();
  await page.clock.fastForward(4000);
  await expect(page.getByTestId("auto-bet-status")).toContainText("Select coins");
  await page.clock.fastForward(50000);
  expect(app.posts).toHaveLength(1);
  expect(app.errors).toEqual([]);
});
