import { test, expect } from "@playwright/test";

const base = process.env.HORSE_PREVIEW_URL ?? "http://localhost:5174/horse-riding";
for (const route of ["", "/race", "/ride"]) {
  test(`horse${route || "/derby"}: uses the shared responsive frame`, async ({ page }) => {
    await page.route("**/api/**", route => {
      const p = new URL(route.request().url()).pathname;
      return route.fulfill({ json: p === "/api/auth/me"
        ? { id: "viewport", displayName: "Viewport", email: "viewport@example.test", role: "player" }
        : { balance: "1000000", currency: "INR", scope: "lunar" } });
    });
    await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
    const frame = page.locator("[data-game-viewport]");
    await expect(frame.locator(".game-page")).toBeVisible();
    for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await expect.poll(async () => {
        const r = (await frame.boundingBox())!;
        return Math.abs(r.width - Math.min(width, 1440)) < 1 && Math.abs(r.height - height) < 1 &&
          Math.abs(r.x - (width - r.width) / 2) < 1;
      }).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
  });
}
