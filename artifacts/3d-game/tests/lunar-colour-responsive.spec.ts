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
        round: { period: `${duration}-1791020400000`, duration, start: now, ends: now + duration * 1000, commitment: "test" },
        history: [7, 0, 5, 2, 9].map((number, index) => ({ number, period: `${duration}-${1791020400000 - (index + 1) * duration * 1000}`, ends: now - index * 30000, commitment: "test", secret: "test" })),
        bets: [], summary: { played: 0, won: 0, profit: 0 }, pending: 0, lockSeconds: 5, minStake: 100, maxStake: 1000000,
      };
    } else if (url.pathname.includes("/wallet/")) json = { balance: "1000000", currency: "INR", scope: "lunar" };
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
  test(`Lunar controls reflow at ${width}x${height} without shrinking`, async ({ page }) => {
    const errors = await setup(page);
    await page.setViewportSize({ width, height });
    await page.goto("/lunar-colour-trading");
    await expect(page).toHaveTitle("Lunar Colour Trading");
    await expect(page.getByTestId("balance")).toContainText("10,000");
    await fitsWidth(page);
    for (const selector of [".number-options > button", ".color-option", ".mode-picker button", "[data-game-coin]"]) {
      for (const button of await page.locator(selector).all()) {
        const box = await button.boundingBox();
        expect(box!.height, selector).toBeGreaterThanOrEqual(44);
        expect(box!.width, selector).toBeGreaterThanOrEqual(44);
      }
    }
    await page.getByRole("button", { name: "Pick number 7", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pick number 7", exact: true })).toHaveAttribute("aria-pressed", "true");
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

test("lobby branding, old link, timers and 200% zoom", async ({ page }) => {
  const errors = await setup(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const card = page.getByTestId("card-game-wingo").first();
  await expect(card).toContainText("Lunar Colour Trading");
  await card.click();
  await expect(page).toHaveURL(/\/lunar-colour-trading$/);
  await expect(page.getByTestId("balance")).toBeVisible();
  for (const [name, duration] of [["1 minute", 60], ["3 minutes", 180], ["5 minutes", 300], ["30 seconds", 30]] as const) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await expect(page.getByTestId("period")).toContainText(`#${duration}-`);
  }
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await fitsWidth(page);
  await page.getByRole("button", { name: "Pick number 5", exact: true }).click();
  await page.getByRole("button", { name: "Cancel selected bet" }).click();
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  await page.getByRole("button", { name: "Back to all games" }).click();
  await expect(card).toBeVisible();
  await page.goto("/wingo");
  await expect(page).toHaveTitle("Lunar Colour Trading");
  await expect(page.getByTestId("balance")).toContainText("10,000");
  expect(errors).toEqual([]);
});
