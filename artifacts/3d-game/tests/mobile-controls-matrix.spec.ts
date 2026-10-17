import { expect, test, type Page } from "@playwright/test";

const config = { enabled: true, houseEdge: 0.03, maxMultiplier: 1000, minStakePaise: "1000", maxStakePaise: "10000000", maxBetsPerRound: 30, maxBetsPerDeal: 30, bettingWindowMs: 120000, revealDurationMs: 9000, settleDurationMs: 5000, decks: 6,
  payouts: { player: 2, banker: 1.95, playerPair: 12, bankerPair: 12, playerA: 1.95, playerB: 1.95, tie: 9, andar: 1.95, bahar: 1.95, pairPlus: { pair: 2, color: 5, sequence: 7, pureSequence: 31, trail: 36 } } };
async function mock(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("aviator:v1", JSON.stringify({ settings: { onboarded: true, sound: false }, balance: 100000 })));
  await page.routeWebSocket("**/ws", ws => ws.onMessage(() => {}));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const now = Date.now();
    let data: unknown = [];
    if (route.request().method() === "POST") return route.fulfill({ status: 400, json: { detail: "Layout test: wagers blocked" } });
    if (path === "/api/auth/me") data = { id: "mobile-layout", displayName: "Layout tester", email: "layout@example.test", role: "player" };
    else if (path === "/api/horse-racing/config") data = { enabled: true, states: [{ id: "test", name: "Test", racecourse: "Test course", theme: "grass", horses: [{ id: 1, name: "Test horse", color: "#c99a55", multiplier: 2 }] }] };
    else if (path.includes("/wallet/")) data = { balance: "10000000", currency: "INR" };
    else if (path.endsWith("/active")) data = null;
    else if (path.endsWith("/round")) data = { roundId: "layout-round", gameCode: path.split("/")[2], phase: "betting", now, bettingEndsAt: now + 120000, revealEndsAt: now + 129000, settleEndsAt: now + 134000, config, outcome: null, liveBets: [], myBets: [], recent: [], totalStake: "0", playerCount: 0, serverSeedHash: "test", clientSeed: "test", nonce: 1 };
    else if (path.includes("/config")) data = config;
    else if (path.includes("free-bets")) data = { count: 0, totalStake: "0", grants: [] };
    else if (path.includes("rain")) data = null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`horse racing: stake and submit stay inside the phone at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await mock(page);
    await page.goto("/horse-riding/");
    const pick = page.getByTestId("back-test-1");
    await expect(pick).toBeInViewport({ ratio: 1 });
    const pickBounds = (await pick.boundingBox())!;
    expect(pickBounds.width).toBeGreaterThanOrEqual(44);
    expect(pickBounds.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("button", { name: "Log out", exact: true })).toBeInViewport({ ratio: 1 });
    await pick.click();
    await page.getByTestId("stake-input").fill("100");
    const action = page.getByTestId("place-bet");
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport({ ratio: 1 });
    expect(await action.evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    await page.screenshot({ path: info.outputPath("horse-bet.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

const pages = [
  { route: "dice", action: "btn-roll", coin: "chip-dice-1000" },
  { route: "plinko", action: "btn-drop", coin: "chip-plinko-1000" },
  { route: "mines", action: "btn-place-mines", coin: "chip-mines-1000" },
  { route: "blackjack", action: "btn-deal", coin: "chip-blackjack-1000" },
  { route: "baccarat", action: "btn-place-bets", spot: "spot-player" },
  { route: "teen-patti", action: "btn-place-bets", spot: "spot-playerA" },
  { route: "andar-bahar", action: "btn-place-bets", spot: "spot-andar" },
  { route: "roulette", action: "btn-place-bets", spot: "cell-1" },
  ...["play", "aviator", "jetx", "fury"].map(route => ({ route, action: "btn-bet-0", coin: "chip-lunar-0-1000" })),
];

for (const { width, height } of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  for (const spec of pages) test(`${spec.route}: selecting an amount leaves betting reachable at ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await mock(page);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/${spec.route}`);
    const action = page.locator(`[data-testid^="${spec.action}"]:visible`).first();
    await expect(action).toBeVisible();
    if ("coin" in spec) {
      await page.locator(`[data-testid="${spec.coin}"]:visible`).first().click();
    } else if ("spot" in spec) {
      const rack = page.locator('[data-testid^="chip-rack"]:visible');
      await rack.getByRole("button", { name: "₹100 coin", exact: true }).click();
      await page.getByTestId(spec.spot).click();
    }
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeEnabled();
    await expect(action).toBeInViewport({ ratio: 1 });
    expect(await action.evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    if (width === 320) await page.screenshot({ path: info.outputPath("small-phone.png") });
  });
}
