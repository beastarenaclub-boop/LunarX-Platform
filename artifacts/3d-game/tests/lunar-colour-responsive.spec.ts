import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

async function setup(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("aviator:v1", JSON.stringify({ settings: { onboarded: true, sound: false } })));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.routeWebSocket("**/*", ws => ws.onMessage(() => {}));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const now = Date.now();
    let json: unknown = {};
    if (url.pathname === "/api/auth/me") json = { id: "lunar-layout-player", email: "layout@example.test", displayName: "Player", role: "player" };
    else if (url.pathname.startsWith("/api/wingo/")) {
      const duration = Number(url.searchParams.get("duration") || 30);
      json = {
        serverTime: now, player: { id: "lunar-layout-player", balance: 1000000 },
        round: { payoutVersion: 3, period: `${duration}-1791020400000`, duration, start: now, ends: now + duration * 1000, commitment: "test" },
        history: [7, 0, 5, 2, 9].map((number, index) => ({ number, period: `${duration}-${1791020400000 - (index + 1) * duration * 1000}`, ends: now - index * 30000, commitment: "test", secret: "test" })),
        bets: [], summary: { played: 0, won: 0, profit: 0 }, pending: 0, lockSeconds: 5, minStake: 100, maxStake: 1000000,
      };
    } else if (url.pathname === "/api/wallet/balances") json = { balances: { lunar: "1000000" }, currency: "INR" };
    else if (url.pathname.includes("/wallet/")) json = { balance: "1000000", currency: "INR", scope: "lunar" };
    else if (/recent|registry|banners/.test(url.pathname)) json = [];
    else if (url.pathname.endsWith("/active")) json = null;
    await route.fulfill({ json });
  });
  return errors;
}

async function fitsWidth(page: Page) {
  const overflow = await page.evaluate(() => {
    // The ticket intentionally clips decorative orbit rings outside its border.
    const selectors = [".topbar-inner", ".prediction-panel", ".mode-picker", ".coin-rack-options"];
    return {
      page: document.documentElement.scrollWidth - innerWidth,
      panels: selectors.flatMap(selector => Array.from(document.querySelectorAll<HTMLElement>(selector)).map(el => ({ selector, overflow: el.scrollWidth - el.clientWidth }))),
      ticketContent: Array.from(document.querySelectorAll(".ticket-left, .ticket-right")).map(el => {
        const child = el.getBoundingClientRect();
        const parent = el.parentElement!.getBoundingClientRect();
        return child.left >= parent.left && child.right <= parent.right + 1;
      }),
    };
  });
  expect(overflow.page).toBeLessThanOrEqual(1);
  for (const panel of overflow.panels) expect(panel.overflow, panel.selector).toBeLessThanOrEqual(1);
  expect(overflow.ticketContent.every(Boolean)).toBe(true);
}

for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1024, 768], [1440, 900], [1920, 1080], [740, 360]]) {
  test(`Colour Trading controls reflow at ${width}x${height} without shrinking`, async ({ page }) => {
    const errors = await setup(page);
    await page.setViewportSize({ width, height });
    await page.goto("/lunar-colour-trading");
    await expect(page).toHaveTitle("Colour Trading");
    await expect(page.getByTestId("balance")).toContainText("10,000");
    await fitsWidth(page);
    await expect(page.locator('.mode-picker, .round-progress')).toHaveCount(0);
    await expect(page.getByTestId('countdown')).toHaveText(/^00:[0-3][0-9]$/);
    await expect(page.locator('.option-divider')).toContainText('1.98× return');
    for (const selector of [".number-options > button", ".color-option", ".mode-picker button", "[data-game-coin]"]) {
      for (const button of await page.locator(selector).all()) {
        const box = await button.boundingBox();
        expect(box!.height, selector).toBeGreaterThanOrEqual(44);
        expect(box!.width, selector).toBeGreaterThanOrEqual(44);
      }
    }
    await page.getByRole("button", { name: "Pick number 7", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pick number 7", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId('auto-bet-status')).not.toContainText(/\d+s/);
    await page.getByRole("button", { name: "Cancel selected bet" }).click();
    await expect(page.getByRole("button", { name: "Pick number 7", exact: true })).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("btn-game-rules").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
    await page.getByRole("tab", { name: "Game history", exact: true }).click();
    await expect(page.locator(".history-section .period-cell").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page.evaluate(() => scrollTo(0, 0));
    if (width === 390 || width === 1440) await page.screenshot({ path: path.resolve(import.meta.dirname, `../../../tmp/lunar-colour-review/${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("lobby branding, old link, 30-second countdown and 200% zoom", async ({ page }) => {
  const errors = await setup(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const card = page.getByTestId("card-game-wingo").first();
  await expect(card).toContainText("Colour Trading");
  await card.click();
  await expect(page).toHaveURL(/\/lunar-colour-trading$/);
  await expect(page.getByTestId("balance")).toBeVisible();
  await expect(page.locator('.mode-picker, .round-progress')).toHaveCount(0);
  await expect(page.getByTestId('countdown')).toHaveText(/^00:[0-3][0-9]$/);
  await expect(page.getByTestId("period")).toContainText("#30-");
  await expect(page.locator('.option-divider')).toContainText('1.98× return');
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await fitsWidth(page);
  await page.getByRole("button", { name: "Pick number 5", exact: true }).click();
  await page.getByRole("button", { name: "Cancel selected bet" }).click();
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  await page.getByRole("button", { name: "Back to all games" }).click();
  await expect(card).toBeVisible();
  await page.goto("/wingo");
  await expect(page).toHaveTitle("Colour Trading");
  await expect(page.getByTestId("balance")).toContainText("10,000");
  expect(errors).toEqual([]);
});

test("countdown ticks and submits one selected bet before betting closes", async ({ page }) => {
  const errors = await setup(page);
  const submitted: { duration: number; pick: string; period: string }[] = [];
  let ends = 0;
  await page.route("**/api/wingo/**", async route => {
    const now = Date.now();
    ends ||= now + 12000;
    if (route.request().url().endsWith("/bets")) submitted.push(route.request().postDataJSON());
    await route.fulfill({ json: {
      serverTime: now, player: { id: "clock-player", balance: 1000000 },
      round: { payoutVersion: 3, period: "30-1234", duration: 30, start: ends - 30000, ends, commitment: "test" },
      history: [], bets: [], summary: { played: 0, won: 0, profit: 0 }, pending: 0, lockSeconds: 5, minStake: 100, maxStake: 1000000,
    } });
  });
  await page.goto("/lunar-colour-trading");
  const pick = page.getByRole("button", { name: "Pick number 7", exact: true });
  await pick.click();
  await expect(page.getByTestId("auto-bet-status")).toContainText("Bet selected");
  await expect(page.locator('.mode-picker, .round-progress')).toHaveCount(0);
  await expect(page.getByTestId('countdown')).toHaveText(/^00:[0-3][0-9]$/);
  const initialSeconds = Number((await page.getByTestId('countdown').innerText()).replace(/\s/g,'').split(':')[1]);
  await expect.poll(async () => Number((await page.getByTestId('countdown').innerText()).replace(/\s/g,'').split(':')[1])).toBeLessThan(initialSeconds);
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0]).toMatchObject({ duration: 30, pick: "7", period: "30-1234", payoutVersion: 3 });
  await expect(pick).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".round-live")).toContainText("BETTING CLOSED");
  expect(submitted).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("storefront displays the new Colour Trading banner", async ({ page }) => {
  const errors = await setup(page);
  await page.goto("/b2c");
  const card = page.locator('[data-game-id="wingo"]').first();
  await expect(card).toHaveAttribute('aria-label', 'Play Colour Trading');
  const art = card.locator('svg.b2c-game-art');
  await expect(art).toHaveAttribute('viewBox', '0 0 1200 675');
  const banner = await art.locator('image').evaluate(async image => (await fetch(image.getAttribute('href')!)).text());
  expect(banner).toContain('>COLOUR</text>');
  expect(banner).toContain('1.98× TOTAL RETURN');
  await card.screenshot({path: path.resolve(import.meta.dirname, '../../../tmp/colour-trading-update/banner.png')});
  expect(errors).toEqual([]);
});
