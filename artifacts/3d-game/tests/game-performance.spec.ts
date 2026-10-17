import { test, expect } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";

test("other games do not run or download inactive crash and 3D games", async ({ page }) => {
  await mockGames(page);
  const crashRequests: string[] = [];
  const gameModules: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/crash/")) crashRequests.push(path);
    if (/\/src\/pages\/(Lunar|HorseRacing|BikeRacing|Roulette)\.tsx/.test(path)) gameModules.push(path);
  });
  await page.goto("/dice");
  await expect(page.locator('[data-game-viewport="dice"]')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(crashRequests).toEqual([]);
  expect(gameModules).toEqual([]);
});

test("crash polling stops on route exit and restarts for the selected flight", async ({ page }) => {
  await mockGames(page);
  let crashRequests = 0;
  const games: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/crash/")) { crashRequests++; games.push(path.split("/")[3]); }
  });
  await page.goto("/jetx");
  await expect(page.getByTestId("jetx-countdown")).toBeVisible();
  await expect.poll(() => crashRequests).toBeGreaterThan(2);
  await page.evaluate(() => history.pushState({}, "", "/dice"));
  await expect(page.locator('[data-game-viewport="dice"]')).toBeVisible();
  await page.waitForTimeout(350);
  const stoppedAt = crashRequests;
  await page.waitForTimeout(1200);
  expect(crashRequests).toBe(stoppedAt);
  await page.evaluate(() => history.pushState({}, "", "/fury"));
  await expect(page.getByTestId("fury-countdown")).toBeVisible();
  await expect.poll(() => games.at(-1)).toBe("fury");
  expect(games.slice(stoppedAt).every(game => game === "fury")).toBe(true);
});

test("a signed-out flight does not start the game engine", async ({ page }) => {
  await mockGames(page);
  await page.route("**/api/auth/me", route => route.fulfill({ status: 401, json: { message: "Sign in" } }));
  const crashRequests: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/crash/")) crashRequests.push(request.url());
  });
  await page.goto("/jetx");
  await expect(page).toHaveURL(/\/login$/);
  await page.waitForTimeout(1200);
  expect(crashRequests).toEqual([]);
});

test("flight frames leave idle betting controls alone while balance and deadlines still update", async ({ page }) => {
  await page.goto("/tests/fixtures/game-performance/index.html");
  await expect(page.getByTestId("btn-jetx-place-all")).toBeVisible();
  const commits = () => page.evaluate(() => (window as any).performanceHarness.commits());
  const before = await commits();
  await page.evaluate(() => (window as any).performanceHarness.tick());
  expect(await commits()).toBe(before);
  await page.evaluate(() => (window as any).performanceHarness.update({ phase: "betting", countdownMs: 10000 }));
  await expect(page.getByTestId("btn-jetx-place-all")).toBeEnabled();
  const betting = await commits();
  await page.evaluate(() => (window as any).performanceHarness.tick());
  expect(await commits()).toBe(betting);
  await page.evaluate(() => (window as any).performanceHarness.update({ balance: 0 }));
  await expect(page.getByTestId("btn-jetx-place-all")).toBeDisabled();
  await page.evaluate(() => (window as any).performanceHarness.update({ balance: 10000 }));
  await expect(page.getByTestId("btn-jetx-place-all")).toBeEnabled();
  await page.evaluate(() => (window as any).performanceHarness.update({ countdownMs: 0 }));
  await expect(page.getByTestId("btn-jetx-place-all")).toBeDisabled();
});
