import { test, expect, type Page } from "@playwright/test";

const api = process.env.SHARED_WALLET_TEST_API ?? "http://localhost:5180";
const viewports = [[320, 568], [390, 844], [768, 1024], [932, 430], [1440, 900]] as const;
const games = [
  ["play", "btn-bet-0"], ["aviator", "btn-bet-0"], ["jetx", "btn-bet-0"],
  ["fury", "btn-bet-0"],

  ["dice", "btn-roll"], ["mines", "btn-place-mines"], ["plinko", "btn-drop"],
  ["roulette", "btn-back"], ["baccarat", "btn-back"], ["blackjack", "btn-deal"],
  ["teen-patti", "btn-back"], ["teen-patti-live", "btn-back"], ["andar-bahar", "btn-back"],
  ["lucky-7", "btn-back"], ["dragon-tiger", "dt-confirm"], ["rummy", "rummy-start"],
] as const;

async function setup(page: Page) {
  const response = await page.request.post(`${api}/api/auth/login`, { headers: { "x-test-bypass": "shared-wallet-layout" },
    data: { email: "wallet-test@example.test", password: "TestWallet12345" } });
  expect(response.ok()).toBe(true);
  await page.addInitScript(() => localStorage.setItem("aviator:v1", JSON.stringify({ settings: { onboarded: true, sound: false } })));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.routeWebSocket("**/ws", ws => ws.onMessage(() => {}));
  await page.route("**/api/**", async route => {
    try {
      const url = new URL(route.request().url());
      const result = await route.fetch({ url: `${api}${url.pathname}${url.search}`, maxRetries: 2 });
      await route.fulfill({ response: result });
    } catch (error) {
      // Navigation may cancel a poll while the intercepted response is in flight.
      if (!/closed|disposed|socket hang up|ECONNRESET/.test(String(error))) throw error;
      await route.abort().catch(() => {});
    }
  });
}

test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "wait" }); });

for (const [game, action] of games) test(`${game}: shared balance and usable controls at five screen sizes`, async ({ page }) => {
  test.setTimeout(60000);
  await setup(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`/${game}`);
  const control = page.locator(`[data-testid="${action}"]:visible`).first();
  await expect(control).toBeVisible();
  await expect(page.locator("body")).toContainText(/1,23,456|123,456/);
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await control.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const box = await control.boundingBox();
    expect(box, `${game} ${width}x${height}`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(box!.y).toBeGreaterThanOrEqual(-1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
    expect(await control.evaluate(el => {
      const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return (el as HTMLButtonElement).disabled || (!!top && (el === top || el.contains(top)));
    })).toBe(true);
    if (width === 320) await page.screenshot({ path: `test-results/shared-wallet-screens/${game}-320.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("wallet uses one balance and no game deposit selector", async ({ page }) => {
  await setup(page);
  await page.goto("/wallet");
  await expect(page.getByText("One wallet for every game")).toBeVisible();
  await expect(page.getByTestId("text-wallet-balance")).toContainText(/1,23,456|123,456/);
  await expect(page.getByTestId("deposit-game-selector")).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator("body")).toContainText(/1,23,456|123,456/);
  const responses = await Promise.all(["lunar", "dice", "mines", "dragon-tiger", "rummy", "horse-racing"].map(async game =>
    (await page.request.get(`${api}/api/wallet/balance?game=${game}`)).json()));
  expect(new Set(responses.map(r => r.walletId)).size).toBe(1);
  expect(new Set(responses.map(r => r.balance)).size).toBe(1);
});
