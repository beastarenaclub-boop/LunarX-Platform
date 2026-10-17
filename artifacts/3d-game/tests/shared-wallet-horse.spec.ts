import { test, expect, type Page, type Locator } from "@playwright/test";

const api = process.env.SHARED_WALLET_TEST_API ?? "http://localhost:5180";
const horse = process.env.HORSE_PREVIEW_URL ?? "http://localhost:5179/horse-riding";
const sizes = [[320, 568], [390, 844], [768, 1024], [932, 430], [960, 540], [1440, 900]] as const;

async function fit(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const box = (await control.boundingBox())!;
  const { width, height } = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function sharedControls(page: Page, width: number, height: number) {
  const coin = height <= 500 || width < 380 ? 44 : width >= 1024 ? 52 : 48;
  const betHeight = height <= 500 ? 48 : width >= 1024 ? 80 : height <= 650 ? 52 : 64;
  const betWidth = width >= 560 && (height <= 500 || width <= 1023 && width > height) ? Math.min(128, Math.max(72, (width - 160) / 6)) : Math.min(160, Math.max(72, (width - 80) / 3));
  const mismatches = await page.locator('[data-game-coin]:visible, [data-game-bet]:visible').evaluateAll((elements, sizes) => elements.flatMap(el => {
    const rect = el.getBoundingClientRect(), isCoin = el.hasAttribute('data-game-coin');
    return Math.abs(rect.width - (isCoin ? sizes.coin : sizes.betWidth)) < 2 && Math.abs(rect.height - (isCoin ? sizes.coin : sizes.betHeight)) < 2
      ? [] : [{ text: el.textContent, width: rect.width, height: rect.height }];
  }), { coin, betHeight, betWidth });
  expect(mismatches, `Horse Racing controls at ${width}x${height}`).toEqual([]);
}

test("Horse Racing uses the shared wallet and fits its bet controls and winner on five sizes", async ({ page }) => {
  test.setTimeout(120000);
  const response = await page.request.post(`${api}/api/auth/login`, {
    headers: { "x-test-bypass": "shared-wallet-layout" },
    data: { email: "wallet-test@example.test", password: "TestWallet12345" },
  });
  expect(response.ok()).toBe(true);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/horse-racing/round") return route.fulfill({ json: { roundId: "visual-qa" } });
    if (url.pathname === "/api/horse-racing/play") {
      const bet = route.request().postDataJSON();
      return route.fulfill({ json: { ...bet, betId: "visual-qa", roundId: "visual-qa", winnerId: bet.horseId,
        didWin: true, payoutAmount: "123456789", serverSeed: "visual-qa", clientSeed: "visual-qa" } });
    }
    try { await route.fulfill({ response: await route.fetch({ url: `${api}${url.pathname}${url.search}`, maxRetries: 2 }) }); }
    catch (error) {
      if (!/closed|disposed|socket hang up|ECONNRESET/.test(String(error))) throw error;
      await route.abort().catch(() => {});
    }
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${horse}/`);
  await expect(page.getByText("Balance:")).toContainText("123456.00");
  await page.locator('[data-testid^="back-"]').first().click();
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const value of [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000])
      await expect(page.getByRole("button", { name: `${value} rupee chip`, exact: true })).toBeVisible();
    await fit(page, page.getByTestId("place-bet"));
    await sharedControls(page, width, height);
  }
  await page.getByRole("button", { name: "Close bet slip" }).click();
  await page.goto(`${horse}/race`);
  const betButton = page.getByRole("button", { name: "Place Bet & Race", exact: true });
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await fit(page, betButton);
    await sharedControls(page, width, height);
    await expect(page.getByRole("button", { name: "10000 rupee chip", exact: true })).toBeVisible();
  }
  await page.goto(`${horse}/`);
  await page.locator('[data-testid^="back-"]').first().click();
  await page.getByTestId("place-bet").click();
  const dialog = page.getByTestId("horse-racing-result");
  await expect(dialog).toBeVisible({ timeout: 60000 });
  await expect(dialog).toContainText("Horse Racing");
  await expect(dialog).toContainText("Returned to your shared wallet");
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await fit(page, dialog);
    await fit(page, page.getByRole("button", { name: "Race Again", exact: true }));
  }
  await page.screenshot({ path: "test-results/shared-wallet-screens/horse-result.png" });
  expect(errors).toEqual([]);
  await page.unrouteAll({ behavior: "wait" });
});
