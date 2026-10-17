import { test, expect } from "@playwright/test";
import { studio } from "./fixtures/roulette";

test.setTimeout(60000);
for (const width of [1366, 390]) {
  test(`limits, coins, manual betting and round reset at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const game = await studio(page, { balance: "50000000" });
    await expect(page.getByTestId("roulette-wallet")).toContainText("5,00,000");
    await expect(page.getByTestId("roulette-paytable")).toContainText("Single36×");
    await page.getByRole("checkbox", { name: "Auto bet" }).uncheck();
    await page.getByTestId("chip-20000").click();
    await page.getByTestId("cell-17").click();
    await expect(page.getByTestId("text-total-staked")).toHaveText("₹20,000");
    await page.getByTestId("chip-10").click();
    await page.getByTestId("cell-17").click();
    await expect(page.getByTestId("text-total-staked")).toHaveText("₹20,000");
    await expect(page.getByText(/maximum ₹20,000 per round/).first()).toBeVisible();
    await page.getByTestId("roulette-submit").click();
    await expect.poll(() => game.requests.length).toBe(1);
    expect(game.requests[0].bets).toEqual([{ type: "straight", numbers: [17], amountPaise: "2000000" }]);
    await expect(page.getByTestId("text-total-staked")).toHaveText("₹0");
    await page.getByTestId("cell-17").click();
    await expect(page.getByTestId("text-total-staked")).toHaveText("₹0");
    await page.getByTestId("btn-rebet").click();
    await expect(page.getByTestId("text-total-staked")).toHaveText("₹0");
    await page.getByTestId("chip-100000").click();
    await page.getByTestId("cell-0").click();
    await expect(page.getByTestId("text-total-staked")).toHaveText("₹0");
    await page.getByTestId("outside-red").click();
    await expect(page.getByTestId("text-total-staked")).toHaveText("₹1,00,000");
    await page.getByTestId("chip-10").click();
    await page.getByTestId("outside-red").click();
    await expect(page.getByTestId("text-total-staked")).toHaveText("₹1,00,000");
    await page.getByTestId("roulette-submit").click();
    await expect.poll(() => game.requests.length).toBe(2);
    await expect(page.getByTestId("text-total-staked")).toHaveText("₹0");
    game.betting("next-round", 120000);
    await page.getByTestId("chip-20000").click();
    await page.getByTestId("cell-17").click();
    await expect(page.getByTestId("text-total-staked")).toHaveText("₹20,000");
    await page.getByTestId("btn-undo").click();
    await expect(page.getByTestId("text-total-staked")).toHaveText("₹0");
    await page.getByTestId("chip-custom").click();
    await page.getByTestId("chip-custom-input").fill("9");
    await expect(page.getByTestId("chip-custom-apply")).toBeDisabled();
    await page.getByTestId("chip-custom-input").fill("100001");
    await expect(page.getByTestId("chip-custom-apply")).toBeDisabled();
    await page.getByTestId("chip-custom-input").fill("10");
    await page.getByTestId("chip-custom-apply").click();
    await page.getByTestId("cell-0").click();
    await expect(page.getByTestId("text-total-staked")).toHaveText("₹10");
    await page.screenshot({ path: info.outputPath("betting-panel.png"), fullPage: true });
    expect(game.errors).toEqual([]);
  });
}

test("auto bet requires a selection, submits once, cancels and resets for a new round", async ({ page }) => {
  const game = await studio(page, { balance: "1000000" });
  await page.getByTestId("chip-10").click();
  expect(game.requests).toHaveLength(0);
  await page.getByTestId("cell-7").click();
  await expect(page.getByTestId("auto-bet-status")).toContainText("Auto bet at timer end");
  game.betting("studio-round-1", 2500);
  await expect.poll(() => game.requests.length).toBe(1);
  await expect(page.getByTestId("text-total-staked")).toHaveText("₹0");
  await page.waitForTimeout(1500);
  expect(game.requests).toHaveLength(1);
  game.betting("auto-2", 120000);
  await page.getByTestId("cell-8").click();
  await page.getByRole("button", { name: "Cancel selected bet" }).click();
  game.betting("auto-2", 1800);
  await page.waitForTimeout(2100);
  expect(game.requests).toHaveLength(1);
  game.betting("auto-3", 1800);
  await page.waitForTimeout(2100);
  expect(game.requests).toHaveLength(1);
  expect(game.errors).toEqual([]);
});

test("compact layouts contain the betting controls and a single betting clock", async ({ page }, info) => {
  await studio(page);
  for (const viewport of [{ width: 320, height: 740 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId("roulette-betting-seconds")).toHaveCount(1);
    await expect(page.getByTestId("chip-rack")).toHaveCount(1);
    await expect(page.locator(".roulette-bet-actions")).toBeVisible();
    const fits = await page.locator(".roulette-betting-panel").evaluate(el => {
      const box = el.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1;
    });
    expect(fits).toBe(true);
    await page.screenshot({ path: info.outputPath(`layout-${viewport.width}.png`), fullPage: true });
  }
});
