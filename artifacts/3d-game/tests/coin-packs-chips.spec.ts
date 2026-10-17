import { test as base, expect, type Page } from "@playwright/test";

/**
 * Coin catalog contract, end to end.
 *
 * Games share six betting presets starting at ₹100 and ₹500. The wallet retains
 * its separate ten-pack catalog. This suite pins both
 * halves: every game renders the same six chips, and the wallet sells the ten
 * matching packs for the shared wallet with the server's exact prices/SKUs.
 *
 * Same auth bootstrap as the other suites: a fresh throwaway account per test.
 */
const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const api = process.env.SHARED_WALLET_TEST_API ?? "";
    const unique = `${testInfo.testId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const headers: Record<string, string> = {};
    if (process.env.TEST_RATE_LIMIT_BYPASS) {
      headers["x-test-bypass"] = process.env.TEST_RATE_LIMIT_BYPASS;
    }
    const res = await page.request.post(`${api}/api/auth/signup`, {
      headers,
      data: {
        email: `playwright-${unique}@example.com`,
        password: "playwright-test-pw",
        displayName: "Playwright",
      },
    });
    if (!res.ok()) {
      throw new Error(
        `Failed to bootstrap auth: ${res.status()} ${await res.text()}`,
      );
    }
    if (api) {
      await page.routeWebSocket("**/ws", ws => ws.onMessage(() => {}));
      await page.route("**/api/**", async route => {
        try {
          const url = new URL(route.request().url());
          const response = await route.fetch({ url: `${api}${url.pathname}${url.search}`, maxRetries: 2 });
          await route.fulfill({ response });
        } catch (error) {
          if (!/closed|disposed|socket hang up|ECONNRESET/.test(String(error))) throw error;
          await route.abort().catch(() => {});
        }
      });
    }
    await use(page);
    await page.unrouteAll({ behavior: "wait" });
  },
});

/** Betting presets are separate from the wallet's artwork/deposit catalog. */
const CHIPS = [100, 500, 1000, 2000, 5000, 10000];
/** Pack coins = chip × 10. */
const PACK_COINS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].map((c) => c * 10);

const STORAGE_KEY = "aviator:v1";

async function seedOnboarded(page: Page) {
  await page.addInitScript((key) => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : {};
      const settings = { ...(parsed.settings ?? {}), onboarded: true };
      const panels =
        Array.isArray(parsed.panels) && parsed.panels.length === 2
          ? parsed.panels
          : [{}, {}];
      localStorage.setItem(key, JSON.stringify({ ...parsed, settings, panels }));
    } catch {
      localStorage.setItem(
        key,
        JSON.stringify({ settings: { onboarded: true }, panels: [{}, {}] }),
      );
    }
  }, STORAGE_KEY);
}

/* ──────────────────────────────────────────────────────────────────
 * 1. Every game exposes the same six betting coin denominations.
 * ────────────────────────────────────────────────────────────────── */

type GameSpec = {
  name: string;
  path: string;
  /** data-testid suffix used by that page's rack. */
  suffix: string;
  ready: string;
};

const GAMES: GameSpec[] = [
  { name: "Lunar", path: "/play", suffix: "-lunar-0", ready: '[data-testid="bet-panel-0"]' },
  { name: "Dice", path: "/dice", suffix: "-dice", ready: '[data-testid="btn-roll"]' },
  { name: "Plinko", path: "/plinko", suffix: "-plinko", ready: '[data-testid="btn-drop"]' },
  { name: "Mines", path: "/mines", suffix: "-mines", ready: '[data-testid="chip-rack-mines"]' },
  {
    name: "Blackjack",
    path: "/blackjack",
    suffix: "-blackjack",
    ready: '[data-testid="chip-rack-blackjack"]',
  },
  { name: "Roulette", path: "/roulette", suffix: "", ready: '[data-testid="chip-rack"]' },
  { name: "Baccarat", path: "/baccarat", suffix: "", ready: '[data-testid="chip-rack"]' },
  { name: "Teen Patti", path: "/teen-patti", suffix: "", ready: '[data-testid="chip-rack"]' },
  { name: "Andar Bahar", path: "/andar-bahar", suffix: "", ready: '[data-testid="chip-rack"]' },
  { name: "Lucky 7", path: "/lucky-7", suffix: "", ready: '[data-testid="chip-rack"]' },
];

for (const game of GAMES) {
  test(`${game.name} offers all six betting coin denominations`, async ({ page }) => {
    await seedOnboarded(page);
    await page.goto(game.path, { waitUntil: "domcontentloaded" });
    await page
      .locator(`${game.ready} >> visible=true`)
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });

    for (const value of CHIPS) {
      // Pages that duplicate controls (desktop panel + mobile bar) render the
      // rack twice, so assert on presence rather than an exact count.
      await expect(
        page.locator(`[data-testid="chip${game.suffix}-${value}"]`).first(),
        `${game.name} should offer a ₹${value} coin`,
      ).toHaveCount(1);
    }
    for (const value of [10, 20, 50, 200]) {
      await expect(page.locator(`[data-testid="chip${game.suffix}-${value}"]`)).toHaveCount(0);
    }
    // …and nothing off-ladder survives from the old quick-stake grids.
    await expect(page.locator('[data-testid^="btn-stake-"]')).toHaveCount(0);
  });
}

test("selecting a coin marks it as the active denomination", async ({ page }) => {
  await seedOnboarded(page);
  await page.goto("/baccarat", { waitUntil: "domcontentloaded" });
  const rack = page.locator('[data-testid="chip-rack"] >> visible=true').first();
  await rack.waitFor({ state: "visible", timeout: 20_000 });

  const target = rack.locator('[data-testid="chip-500"]');
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await expect(rack.locator('[data-testid="chip-100"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

/* ──────────────────────────────────────────────────────────────────
 * 2. The shared wallet sells ten server-priced packs.
 * ────────────────────────────────────────────────────────────────── */

async function openDeposit(page: Page) {
  await seedOnboarded(page);
  await page.goto("/wallet", { waitUntil: "domcontentloaded" });
  await page
    .locator('[data-testid="coin-pack-grid"]')
    .waitFor({ state: "visible", timeout: 20_000 });
}

test("wallet shows ten coin packs with exact prices and SKUs", async ({ page }) => {
  await openDeposit(page);
  const grid = page.locator('[data-testid="coin-pack-grid"]');
  await expect(grid.locator("button")).toHaveCount(10);

  for (const coins of PACK_COINS) {
    const pack = grid.locator(`[data-testid="btn-coin-pack-COINS-LUNAR-${coins}"]`);
    await expect(pack, `pack for ${coins} coins`).toHaveCount(1);
    // Coins are 1:1 with rupees, so the price is the coin count in ₹.
    await expect(pack).toContainText(`${coins.toLocaleString("en-IN")} coins`);
    await expect(pack).toContainText(`₹${coins.toLocaleString("en-IN")}`);
    await expect(pack).toContainText(`COINS-LUNAR-${coins}`);
  }
});

test("choosing a pack fills the amount and keeps the SKU", async ({ page }) => {
  await openDeposit(page);
  await page.locator('[data-testid="btn-coin-pack-COINS-LUNAR-2000"]').click();

  await expect(page.locator('[data-testid="input-deposit-amount"]')).toHaveValue(
    "2000",
  );
  await expect(page.locator('[data-testid="text-selected-pack"]')).toContainText(
    "COINS-LUNAR-2000",
  );

  // Typing an off-ladder amount drops the pack — the deposit becomes custom.
  await page.locator('[data-testid="input-deposit-amount"]').fill("1234");
  await expect(page.locator('[data-testid="text-selected-pack"]')).toContainText(
    "No pack selected",
  );

  // Typing an exact pack price re-selects it, so the purchase stays traceable.
  await page.locator('[data-testid="input-deposit-amount"]').fill("5000");
  await expect(page.locator('[data-testid="text-selected-pack"]')).toContainText(
    "COINS-LUNAR-5000",
  );
});

test("coin packs fund one shared wallet without choosing a game", async ({ page }) => {
  await openDeposit(page);
  await page.locator('[data-testid="btn-coin-pack-COINS-LUNAR-1000"]').click();
  await expect(page.getByTestId("deposit-game-selector")).toHaveCount(0);
  await expect(page.getByText("One wallet for every game")).toBeVisible();
  await expect(page.getByTestId("text-selected-pack")).toContainText("COINS-LUNAR-1000");
});

test("the pack grid fits a phone without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openDeposit(page);
  await expect(
    page.locator('[data-testid="coin-pack-grid"] button'),
  ).toHaveCount(10);

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(overflow.doc).toBeLessThanOrEqual(overflow.inner + 1);

  // Packs stay tappable at the smallest supported width.
  const box = await page
    .locator('[data-testid="btn-coin-pack-COINS-LUNAR-100"]')
    .boundingBox();
  expect(box, "first pack should be laid out").not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
});
