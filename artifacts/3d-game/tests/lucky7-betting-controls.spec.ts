import { expect, test, type Locator, type Page } from "@playwright/test";
import { table } from "./lucky7-table-fixture";

const action = (page: Page, name: string) => page.locator(`[data-testid^="btn-${name}"]`);
const dock = (page: Page) => page.getByTestId("lucky7-betting-dock");
const total = (page: Page) => page.locator('[data-testid^="text-total-staked"]');

async function entirelyOnscreen(locator: Locator, page: Page) {
  // The panel is in normal document flow, so every control can be reached
  // without a fixed overlay covering the dealer or another control.
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
}

test.beforeEach(async ({ page }) => {
  // All wagers use mocked accounts and wallets, never the live account.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

for (const [name, width, height] of [
  ["phone", 390, 844], ["small phone", 320, 568],
  ["landscape", 844, 390], ["desktop", 1366, 768],
] as const) {
  test(`${name}: a reachable spot immediately bets the selected coin`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const round = await table(page, false, 0, { bettingMs: 60000 });
    await expect(dock(page)).toHaveAttribute("data-betting-state", "open");
    await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "5");
    for (const spot of ["under", "exactly", "over"]) {
      const button = page.getByTestId(`spot-${spot}`);
      await expect(button).toBeEnabled();
      await expect(button).toHaveCSS("opacity", "1");
      await expect(button).not.toHaveAttribute("data-winner", "true");
      await entirelyOnscreen(button, page);
    }
    for (const removed of ["place-bets", "undo", "clear"]) await expect(action(page, removed)).toHaveCount(0);
    const rack = page.locator('[data-testid^="chip-rack"]:visible');
    for (const value of [100, 200, 500, 1000, 2000, 5000, 10000]) {
      const coin = rack.getByRole("button", { name: `₹${value.toLocaleString("en-IN")} coin`, exact: true });
      await entirelyOnscreen(coin, page);
    }
    await expect(rack.getByRole("button")).toHaveCount(8);
    const custom = rack.getByRole("button", { name: "Custom amount" });
    await entirelyOnscreen(custom, page);
    const customBounds = (await custom.boundingBox())!;
    expect(customBounds.width).toBeGreaterThanOrEqual(60);
    expect(customBounds.height).toBeGreaterThanOrEqual(48);
    const summary = page.locator('[data-testid^="text-placed-summary"]:visible');
    await expect(summary).toHaveCount(1);
    expect(await summary.evaluate(el => el.getBoundingClientRect().top + window.scrollY))
      .toBeGreaterThanOrEqual(await rack.evaluate(el => el.getBoundingClientRect().bottom + window.scrollY));
    await expect(page.getByTestId("lucky7-instant-hint")).toContainText("₹100 instantly");
    await page.getByTestId("spot-under").click();
    await expect(page.getByTestId("chipstack-under")).toHaveText("100.00");
    await expect(total(page)).toHaveText("₹100.00");
    await expect(page.getByTestId("text-lucky7-balance")).toContainText("900.00");
    expect(round.submissions).toEqual([{ bets: [{ type: "under", amountPaise: "10000" }] }]);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await entirelyOnscreen(page.getByTestId("spot-over"), page);
    await entirelyOnscreen(action(page, "rebet"), page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("coin selection never bets; all spots use the selected amount and confirmed totals accumulate", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const round = await table(page, false, 0, { bettingMs: 60000 });
  await page.getByTestId("chip-mobile-100").click();
  await expect(page.getByTestId("lucky7-instant-hint")).toContainText("₹100 instantly");
  expect(round.submissions).toEqual([]);
  for (const spot of ["under", "exactly", "over"]) {
    await page.getByTestId(`spot-${spot}`).click();
    await expect(page.getByTestId(`chipstack-${spot}`)).toHaveText("100.00");
  }
  await page.getByTestId("spot-under").click();
  await expect(page.getByTestId("chipstack-under")).toHaveText("200.00");
  await expect(total(page)).toHaveText("₹400.00");
  await expect(page.getByTestId("text-lucky7-balance")).toContainText("600.00");
  expect(round.submissions).toEqual(["under", "exactly", "over", "under"].map(type => ({ bets: [{ type, amountPaise: "10000" }] })));
});

test("closing betting locks controls and the next round never bets automatically", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const round = await table(page, false, 0, { bettingMs: 60000 });
  await page.getByTestId("spot-over").click();
  await expect(page.getByTestId("chipstack-over")).toHaveText("100.00");
  await page.getByTestId("chip-mobile-custom").click();
  await page.getByTestId("chip-mobile-custom-input").fill("75");
  round.reveal();
  await expect(dock(page)).toHaveAttribute("data-betting-state", "closed");
  for (const control of await dock(page).locator('button:not([data-testid="coin-settings-button"]), input').all()) await expect(control).toBeDisabled();
  await expect(page.getByTestId("lucky7-instant-hint")).toHaveText("Betting closed");
  await expect(page.getByTestId("chipstack-over")).toHaveText("100.00");
  await expect(page.getByTestId("spot-exactly")).toHaveAttribute("data-winner", "true");
  round.settle("0");
  await expect(action(page, "rebet")).toBeDisabled();
  round.nextBetting();
  await expect(dock(page)).toHaveAttribute("data-betting-state", "open");
  await expect(page.getByTestId("spot-exactly")).not.toHaveAttribute("data-winner", "true");
  await expect(total(page)).toHaveText("₹0.00");
  await expect(page.getByTestId("chipstack-over")).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(round.submissions).toHaveLength(1);
  // Closing betting dismisses the custom-amount dialog. Open it again only
  // after the next betting window; entering an amount still cannot place a bet.
  await page.getByTestId("chip-mobile-custom").click();
  await page.getByTestId("chip-mobile-custom-input").fill("75");
  await page.getByTestId("chip-mobile-custom-apply").click();
  expect(round.submissions).toHaveLength(1);
  await page.getByTestId("spot-under").click();
  await expect(page.getByTestId("chipstack-under")).toHaveText("75.00");
  expect(round.submissions[1]).toEqual({ bets: [{ type: "under", amountPaise: "7500" }] });
});

test("the local deadline blocks clicks even without the next server phase event", async ({ page }) => {
  const round = await table(page, false, 0, { bettingMs: 60000 });
  await expect(dock(page)).toHaveAttribute("data-betting-state", "open");
  round.nextBetting("short-window", 1500);
  await expect(dock(page)).toHaveAttribute("data-betting-state", "closed");
  await expect(page.getByTestId("spot-exactly")).toBeDisabled();
  await page.getByTestId("spot-exactly").evaluate(element => (element as HTMLButtonElement).click());
  round.nextBetting("fresh-window");
  await expect(page.getByTestId("spot-exactly")).toBeEnabled();
  await page.waitForTimeout(800);
  expect(round.submissions).toEqual([]);
});

test("rapid taps send one pending request; repeat last bet submits only when tapped", async ({ page }) => {
  const round = await table(page, false, 0, { bettingMs: 60000 });
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/lucky-7/bet", async route => {
    requests++;
    await pending;
    await route.fallback();
  });
  await page.getByTestId("spot-under").evaluate(element => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
    (document.querySelector('[data-testid="spot-over"]') as HTMLButtonElement).click();
  });
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByTestId("spot-under")).toBeDisabled();
  await expect(page.getByTestId("chipstack-under")).toHaveCount(0);
  await expect(page.getByTestId("lucky7-instant-hint")).toHaveText(/placing/i);
  release();
  await expect(action(page, "rebet")).toBeEnabled();
  await expect(total(page)).toHaveText("₹100.00");
  round.reveal();
  await expect(action(page, "rebet")).toBeDisabled();
  round.nextBetting();
  await expect(total(page)).toHaveText("₹0.00");
  await action(page, "rebet").click();
  await expect(page.getByTestId("chipstack-under")).toHaveText("100.00");
  expect(requests).toBe(2);
  expect(round.submissions).toHaveLength(2);
});

for (const detail of ["Betting is closed for this round.", "Insufficient balance"]) {
  test(`server rejection (${detail}) shows no accepted stake and never retries`, async ({ page }) => {
    const round = await table(page, false, 0, { bettingMs: 60000 });
    let requests = 0;
    await page.route("**/api/lucky-7/bet", async route => {
      requests++;
      await route.fulfill({ status: 400, json: { title: "Bet rejected", detail } });
    });
    await page.getByTestId("spot-under").click();
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByTestId("spot-under")).toBeEnabled();
    await expect(page.getByTestId("chipstack-under")).toHaveCount(0);
    await expect(total(page)).toHaveText("₹0.00");
    await expect(action(page, "rebet")).toBeDisabled();
    await expect(page.getByTestId("text-lucky7-balance")).toContainText("1,000.00");
    round.nextBetting();
    await expect(page.getByTestId("spot-under")).toBeEnabled();
    await page.waitForTimeout(800);
    expect(requests).toBe(1);
  });
}

test("a late success from the previous round cannot appear in the new round's totals", async ({ page }) => {
  const round = await table(page, false, 0, { bettingMs: 60000 });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/lucky-7/bet", async route => {
    const accepted = round.acceptBet(route.request().postDataJSON().bets);
    await pending;
    await route.fulfill({ json: accepted });
  });
  await page.getByTestId("spot-under").click();
  await expect.poll(() => round.submissions.length).toBe(1);
  round.nextBetting();
  await expect(dock(page)).toHaveAttribute("data-betting-state", "open");
  release();
  await expect(page.getByTestId("spot-under")).toBeEnabled();
  await expect(total(page)).toHaveText("₹0.00");
  await expect(page.getByTestId("chipstack-under")).toHaveCount(0);
  expect(round.submissions).toHaveLength(1);
});

test("a paused table shows its status and keeps wagers disabled", async ({ page }) => {
  await table(page, false, 0, { bettingMs: 60000, enabled: false });
  await expect(dock(page)).toHaveAttribute("data-betting-state", "paused");
  await expect(page.getByTestId("lucky7-instant-hint")).toHaveText("Table paused");
  await expect(page.getByTestId("spot-under")).toBeDisabled();
});
