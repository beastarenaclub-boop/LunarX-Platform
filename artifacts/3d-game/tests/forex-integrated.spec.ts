import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { createForexStore } from "../../../lib/forex/store.mjs";
import { quoteFixture } from "../../../lib/forex/tests/quote-fixture.mjs";

async function setup(page: Page) {
  let time = Math.floor(Date.now() / 60000) * 60000 + 5000;
  const store = createForexStore(":memory:", { now: () => time });
  const id = "forex-lobby-player";
  const errors: string[] = [];
  const quotes = quoteFixture();
  let quoteOffline = false;
  let rejectTrade = false;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({ settings: { onboarded: true, sound: false } }),
    ),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.routeWebSocket("**/*", (ws) => ws.onMessage(() => {}));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let json: unknown = {};
    if (url.pathname === "/api/auth/me")
      json = {
        id,
        email: "forex@example.test",
        displayName: "Trader",
        role: "player",
      };
    else if (url.pathname === "/api/forex/quotes") {
      if (quoteOffline) { await route.fulfill({ status: 503, json: { error: "offline" } }); return; }
      json = quotes;
    }
    else if (url.pathname.startsWith("/api/forex/")) {
      if (url.pathname.endsWith("/trades") && rejectTrade) {
        rejectTrade = false;
        await route.fulfill({ status: 503, json: { error: "Order server unavailable. Retry this bet." } });
        return;
      }
      try {
        json = {
          mode: "wallet",
          currency: "INR",
          ...(url.pathname.endsWith("/trades")
            ? store.place(id, route.request().postDataJSON())
            : url.pathname.endsWith("/refill")
              ? store.refill(id)
              : store.state(id)),
        };
      } catch (error) {
        await route.fulfill({
          status: 400,
          json: { error: (error as Error).message },
        });
        return;
      }
    } else if (url.pathname === "/api/wallet/balances")
      json = {
        currency: "INR",
        balances: { lunar: String(store.state(id).account!.balance * 100) },
      };
    else if (url.pathname.includes("/wallet/"))
      json = {
        balance: String(store.state(id).account!.balance * 100),
        currency: "INR",
        scope: "lunar",
      };
    else if (/recent|registry|banners/.test(url.pathname)) json = [];
    else if (url.pathname.endsWith("/active")) json = null;
    await route.fulfill({ json });
  });
  return {
    errors,
    quotes,
    setQuoteOffline: () => { quoteOffline = true; },
    rejectNextTrade: () => { rejectTrade = true; },
    store,
    advance: (ms = 60000) => {
      time += ms;
      store.tick();
    },
  };
}

test("idle game candles move in both directions while Google price and wallet stay unchanged", async ({ page }) => {
  const mock = await setup(page);
  try {
    await page.clock.install();
    await page.goto("/forex-trading", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("game-chart")).toContainText("SIMULATED GAME INDEX");
    await expect(page.getByTestId("game-candle")).toHaveCount(80);
    expect(await page.locator('[data-testid="game-candle"][data-side="up"]').count()).toBeGreaterThan(10);
    expect(await page.locator('[data-testid="game-candle"][data-side="down"]').count()).toBeGreaterThan(10);
    const before = await page.getByTestId("game-chart-index").textContent();
    mock.advance(1200);
    await page.clock.fastForward(1400);
    await expect(page.getByTestId("game-chart-index")).not.toHaveText(before!);
    await expect(page.getByTestId("game-chart")).toContainText("No bets · idle animation");
    await expect(page.getByTestId("market-price")).toHaveText("4,200.25");
    await expect(page.getByTestId("balance")).toHaveText("₹10,000");
    await page.getByRole("button", { name: "5s", exact: true }).click();
    await expect.poll(() => page.getByTestId("game-candle").count()).toBeLessThan(25);
    expect(mock.store.state("forex-lobby-player").trades).toHaveLength(0);
    expect(mock.errors).toEqual([]);
  } finally { mock.store.close(); }
});

test("failed bets show an inline response, unlock retry, and work without randomUUID", async ({ page }) => {
  const mock = await setup(page);
  await page.addInitScript(() => Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true }));
  mock.rejectNextTrade();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/forex-trading", { waitUntil: "domcontentloaded" });
    await page.getByTestId("chip-100").click();
    await page.getByTestId("forex-sell").click();
    await expect(page.getByTestId("bet-feedback")).toContainText("Order server unavailable");
    await expect(page.getByTestId("forex-sell")).toBeEnabled();
    await expect(page.getByTestId("balance")).toHaveText("₹10,000");
    await expect(page.getByTestId("game-bet-marker")).toHaveCount(0);
    await page.getByTestId("forex-sell").click();
    await expect(page.getByTestId("bet-feedback")).toContainText("Bet accepted");
    await expect(page.getByTestId("balance")).toHaveText("₹9,900");
    await expect(page.getByTestId("game-bet-marker")).toContainText("SELL 100");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: path.resolve(import.meta.dirname, "../../../tmp/forex-integrated/animated-bet-390.png"), fullPage: true });
    expect(mock.store.state("forex-lobby-player").trades).toHaveLength(1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("game-bet-marker")).toHaveCount(1);
    expect(mock.errors).toEqual([]);
  } finally { mock.store.close(); }
});

test("an order ID failure clears pending controls instead of leaving the bet stuck", async ({ page }) => {
  const mock = await setup(page);
  await page.addInitScript(() => Object.defineProperty(Crypto.prototype, "randomUUID", {
    configurable: true, value: () => { throw new Error("Order ID could not be created. Retry."); },
  }));
  try {
    await page.goto("/forex-trading", { waitUntil: "domcontentloaded" });
    await page.getByTestId("chip-100").click();
    await page.getByTestId("forex-buy").click();
    await expect(page.getByTestId("bet-feedback")).toContainText("Order ID could not be created");
    await expect(page.getByTestId("forex-buy")).toBeEnabled();
    expect(mock.store.state("forex-lobby-player").trades).toHaveLength(0);
    await page.evaluate(() => Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true }));
    await page.getByTestId("forex-buy").click();
    await expect(page.getByTestId("bet-feedback")).toContainText("Bet accepted");
    await expect(page.getByTestId("game-bet-marker")).toContainText("BUY 100");
    expect(mock.errors).toEqual([]);
  } finally { mock.store.close(); }
});

test("market quotes update independently from pool rounds and never credit the wallet", async ({
  page,
}) => {
  const mock = await setup(page);
  try {
    await page.clock.install();
    await page.goto("/forex-trading", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("direction")).toHaveText("UP");
    await page.getByRole("button", { name: /Google market/ }).click();
    await page.getByRole("button", { name: "Line chart", exact: true }).click();
    await expect(page.getByTestId("chart-market-gain")).toContainText(
      "MARKET CHANGE",
    );
    await expect(page.getByTestId("chart-price-zones")).toContainText(
      "ABOVE PREVIOUS CLOSE",
    );
    await expect(page.getByTestId("market-price")).toHaveText("4,200.25");
    await expect(page.getByRole("button", { name: "Select Gold Futures", exact: true })).toContainText("4,200.25");
    await expect(page.getByTestId("quote-source")).toContainText("Google Finance");
    const line = page.getByTestId("chart-price-line");
    const before = await line.getAttribute("d");
    mock.advance(30_000);
    await page.clock.fastForward(1100);
    await expect(line).toHaveAttribute("d", before!);
    await expect(page.getByTestId("market-price")).toHaveText("4,200.25");
    mock.quotes.quotes.gold.price = 4202.50;
    mock.quotes.quotes.gold.ticks.at(-1)!.price = 4202.50;
    await page.clock.fastForward(30_000);
    await expect(page.getByTestId("market-price")).toHaveText("4,202.50");
    await expect(page.getByRole("button", { name: "Select Gold Futures", exact: true })).toContainText("4,202.50");
    await expect(line).not.toHaveAttribute("d", before!);
    expect(
      ((await line.getAttribute("d"))!.match(/L/g) || []).length,
    ).toBeGreaterThan(30);
    await expect(page.getByTestId("chart-market-gain")).toContainText(
      /\+\d+\.\d{3}%/,
    );
    mock.advance(30_000);
    await page.clock.fastForward(1100);
    await expect(page.locator(".fa-result-strip .result-up")).toHaveCount(1);
    await expect(page.getByTestId("balance")).toHaveText("₹10,000");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page
      .getByRole("button", { name: "Candlestick chart", exact: true })
      .click();
    await expect(
      page.getByRole("img", { name: /Gold Futures candlestick chart/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "15m", exact: true }).click();
    await expect(page.locator(".fx-chart-note")).toContainText(
      "1m sampled candles",
    );
    await page.getByRole("button", { name: "Latest", exact: true }).click();
    await expect(page.locator(".fx-chart-note")).toContainText("GOOGLE FINANCE");
    mock.setQuoteOffline();
    await page.clock.fastForward(30_000);
    await expect(page.getByTestId("quote-source")).toContainText("Last available quote");
    await expect(page.getByTestId("market-price")).toHaveText("4,202.50");
    expect(mock.store.state("forex-lobby-player").account!.profit).toBe(0);
    expect(mock.errors).toEqual([]);
  } finally {
    mock.store.close();
  }
});

test("missing market feed shows unavailable while pool predictions still work", async ({ page }) => {
  const mock = await setup(page);
  mock.setQuoteOffline();
  try {
    await page.goto("/forex-trading", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("balance")).toHaveText("₹10,000");
    await expect(page.getByTestId("market-price")).toHaveText("—");
    await expect(page.getByTestId("quote-source")).toContainText("Quote unavailable");
    await expect(page.getByTestId("game-chart")).toBeVisible();
    await page.getByRole("button", { name: /Google market/ }).click();
    await expect(page.getByText("Market chart unavailable")).toBeVisible();
    await expect(page.getByTestId("chart-price-line")).toHaveCount(0);
    await page.getByTestId("chip-100").click();
    await page.getByTestId("forex-sell").click();
    await expect(page.getByTestId("direction")).toHaveText("DOWN");
    await expect(page.getByTestId("market-price")).toHaveText("—");
    expect(mock.errors).toEqual([]);
  } finally { mock.store.close(); }
});

test("lobby opens the integrated game, shared coin controls place orders, and settlement uses the common win receipt", async ({
  page,
}) => {
  const mock = await setup(page);
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("card-game-forex-trading").first();
    await expect(card).toContainText("Forex Trading");
    await card.click();
    await expect(page).toHaveURL(/\/forex-trading$/);
    await expect(page).toHaveTitle("Aurum Forex Trading");
    await expect(page.getByTestId("balance")).toContainText("10,000");
    await page.getByTestId("chip-100").click();
    await page.getByTestId("forex-sell").click();
    await expect(page.getByTestId("balance")).toHaveText("₹9,900");
    await expect(page.getByTestId("direction")).toHaveText("DOWN");
    await expect(page.getByTestId("market-price")).toHaveText("4,200.25");
    await expect(page.locator(".fa-quote small")).toContainText("+1.00%");
    await expect(page.getByTestId("bet-feedback")).toContainText("Bet accepted");
    await expect(page.getByTestId("game-bet-marker")).toHaveCount(1);
    await expect(page.getByTestId("game-bet-marker")).toContainText("SELL 100");
    await page.getByRole("button", { name: /1 open prediction/ }).click();
    await expect(
      page.getByRole("tabpanel", { name: "Positions" }),
    ).toContainText("₹100");
    await page.keyboard.press("Escape");
    mock.advance();
    await expect(page.getByTestId("balance")).toHaveText("₹10,090");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Prediction history" }).click();
    await expect(page.getByRole("tabpanel", { name: "History" })).toContainText(
      "WON",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Back to all games" }).click();
    await expect(card).toBeVisible();
    expect(mock.errors).toEqual([]);
  } finally {
    mock.store.close();
  }
});

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [844, 390],
]) {
  test(`integrated controls and information fit at ${width}x${height}`, async ({
    page,
  }) => {
    const mock = await setup(page);
    try {
      await page.setViewportSize({ width, height });
      await page.goto("/forex-trading", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("balance")).toContainText("10,000");
      await expect(
        page.getByRole("link", { name: "Open Wallet", exact: true }),
      ).toHaveAttribute("href", "/wallet");
      await expect(page.locator(".fa-game")).not.toContainText(
        /Practice|Refill/,
      );
      await expect(
        page.locator('[data-game-viewport="forex-trading"]'),
      ).toBeVisible();
      await expect
        .poll(async () =>
          page.evaluate(() =>
            [
              ...document.querySelectorAll<HTMLElement>(
                '[data-game-bet], [data-game-coin], [data-testid="btn-game-rules"], .fa-chart-board',
              ),
            ].flatMap((el) => {
              const r = el.getBoundingClientRect();
              // The shared viewport now keeps native-size controls and scrolls
              // vertically on short phones. Horizontal overflow is never allowed.
              return r.x < -1 || r.right > innerWidth + 1
                ? [el.dataset.testid || el.className]
                : [];
            }),
          ),
        )
        .toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const controls = document
              .querySelector(".fa-betting-panel")!
              .getBoundingClientRect();
            const results = document
              .querySelector(".fa-result-strip")!
              .getBoundingClientRect();
            return results.height === 0 || controls.bottom <= results.top + 1;
          }),
        )
        .toBe(true);
      for (const button of await page.locator("[data-game-bet]").all()) {
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport();
        expect(
          await button.evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
        ).toBe(true);
      }
      await page
        .getByRole("button", { name: "Select Silver Futures", exact: true })
        .click();
      await expect(page.locator(".fa-instrument h2")).toContainText("Silver");
      await page
        .getByRole("button", { name: "Line chart", exact: true })
        .click();
      await expect(
        page.getByRole("img", { name: /Silver Futures simulated game line chart/ }),
      ).toBeVisible();
      await page.screenshot({
        path: path.resolve(
          import.meta.dirname,
          `../../../tmp/forex-integrated/game-${width}.png`,
        ),
      });
      await page.getByTestId("btn-game-rules").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("tabpanel", { name: "Rules" })).toContainText(
        "independently with equal probability",
      );
      await page.getByRole("tab", { name: "History" }).click();
      await expect(
        page.getByRole("tabpanel", { name: "History" }),
      ).toContainText("completed predictions");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await page.getByTestId("coin-settings-button").click();
      await expect(page.getByTestId("coin-settings-dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      expect(mock.errors).toEqual([]);
    } finally {
      mock.store.close();
    }
  });
}
