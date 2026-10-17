import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { initialTable } from "../src/game/rummy/engine";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild") as typeof import("esbuild");
let harness: string;
test.beforeAll(async () => {
  const result = await build({
    entryPoints: [path.resolve("tests/fixtures/viewport-receipt.tsx")], bundle: true, write: false,
    outfile: "receipt.js", platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "silent-audio", setup(build) {
      build.onResolve({ filter: /^@\/game\/audio$/ }, () => ({ path: "audio", namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const sfx = { winCelebration() {} };" }));
    } }],
  });
  harness = result.outputFiles!.find(file => file.path.endsWith(".js"))!.text;
});

const routes = ["play", "aviator", "jetx", "fury",
  "mines", "plinko", "dice", "roulette", "baccarat", "blackjack", "teen-patti", "teen-patti-live", "andar-bahar", "lucky-7", "dragon-tiger", "rummy"];

async function mockGames(page: Page) {
  await page.addInitScript(() => localStorage.setItem("aviator:v1", JSON.stringify({ settings: { onboarded: true, sound: false } })));
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Isolate layout assertions from both live rounds and Vite hot reloads.
  await page.routeWebSocket("**/*", ws => ws.onMessage(() => {}));
  await page.route("**/api/**", async route => {
    const p = new URL(route.request().url()).pathname;
    const now = Date.now();
    const config = { enabled: true, houseEdge: 0.03, maxMultiplier: 1000, minStakePaise: "1000", maxStakePaise: "50000000",
      bettingWindowMs: 120000, revealDurationMs: 5000, settleDurationMs: 5000, maxBetsPerRound: 10, minTarget: 2, maxTarget: 98,
      payouts: { under: 2, exactly: 12, over: 2, playerA: 1.95, playerB: 1.95, tie: 8,
        pairPlus: { pair: 2, color: 5, sequence: 7, pureSequence: 31, trail: 36 } } };
    let json: unknown = {};
    if (p === "/api/auth/me") json = { id: "viewport-test", email: "viewport@example.test", displayName: "Viewport", role: "player" };
    else if (p.startsWith("/api/dragon-tiger/")) json = { serverNow: now, mode: "wallet", online: 1,
      round: { id: 1, phase: "betting", closesAt: now + 120000, revealsAt: now + 125000, endsAt: now + 130000 },
      player: { balance: 10000, net: 0, wins: 0, played: 0, rank: null }, myBet: null, lastResult: null, leaderboard: [], history: [] };
    else if (p.startsWith("/api/rummy/")) json = { table: { ...initialTable(), balance: 10000 }, auto: null, autoPlay: false, notice: "", version: 0, deadline: 0, serverNow: now };
    else if (p.includes("/config")) json = config;
    else if (p.endsWith("/round")) json = { roundId: "viewport-round", gameCode: p.split("/")[2], phase: "betting", now,
      bettingEndsAt: now + 120000, revealEndsAt: now + 125000, settleEndsAt: now + 130000, config,
      serverSeedHash: "test", clientSeed: "test", nonce: 1, outcome: null, serverSeed: null, totalStake: "0", playerCount: 0, liveBets: [], myBets: [], recent: [] };
    else if (p.includes("/wallet/")) json = { balance: "1000000", currency: "INR", scope: "lunar" };
    else if (/recent|registry|banners/.test(p)) json = [];
    else if (/active$/.test(p)) json = null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(json) });
  });
}

for (const route of routes) test(`${route}: shared frame and unread popup survive resizing`, async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await mockGames(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${route}`, { waitUntil: "domcontentloaded" });
  const frame = page.locator("[data-game-viewport]");
  await expect(frame.locator(".game-page")).toBeVisible();
  await expect(page.locator("[data-game-coin]:visible").first()).toBeVisible();
  await page.addScriptTag({ content: harness });
  const game = route === "play" ? "lunar" : route;
  const maximumWidth = ({ dice: 1120, mines: 1240, plinko: 1240, "lucky-7": 1600, "teen-patti-live": 1600, rummy: 1520 } as Record<string, number>)[game] ?? 1440;
  await page.evaluate(game => (window as any).showViewportReceipt(game), game);
  const popup = page.getByTestId("round-win-dialog");
  await expect(popup).toBeVisible();
  await page.evaluate(game => (window as any).showViewportReceipt(game, "next-round"), game);
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [960, 540], [1024, 768], [1440, 900], [1920, 1080], [1280, 600], [568, 280]]) {
    await page.setViewportSize({ width, height });
    for (const control of await page.locator("[data-game-bet]:visible, [data-game-coin]:visible").all()) {
      const box = (await control.boundingBox())!;
      expect(box.x, `${route} control at ${width}x${height}`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    await expect.poll(async () => {
      if (errors.length) return { errors };
      const f = (await frame.boundingBox())!, p = await popup.boundingBox();
      const fits = Math.abs(f.width - Math.min(width, maximumWidth)) < 1 && Math.abs(f.height - height) < 1 &&
        Math.abs(f.x - (width - f.width) / 2) < 1 && !!p && p.x >= f.x && p.y >= 0 && p.x + p.width <= f.x + f.width + 1 && p.y + p.height <= height;
      return fits ? true : { width, height, frame: f, popup: p, errors };
    }).toBe(true);
    await expect(page.getByTestId("round-win-ok")).toBeInViewport({ ratio: 0.999 });
    await expect(page.getByTestId("round-win-profit")).toContainText("12,34,567.89");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
  await page.getByTestId("round-win-ok").click();
  await expect(popup).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: info.outputPath("desktop.png") });
  // Short screens scroll to controls while preserving their native size.
  await page.setViewportSize({ width: 390, height: 844 });
  const control = page.locator("[data-game-bet]:visible, [data-game-coin]:visible").first();
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport({ ratio: 0.999 });
  await page.screenshot({ path: info.outputPath("phone.png") });
  await page.evaluate(() => (window as any).showViewportSettings());
  const settings = page.getByRole("dialog", { name: "Game settings test" });
  await expect(settings).toBeVisible();
  for (const [width, height] of [[320, 568], [844, 390], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await expect(settings).toBeInViewport({ ratio: 0.999 });
    await settings.getByText("Save settings").scrollIntoViewIfNeeded();
    await expect(settings.getByText("Save settings")).toBeInViewport({ ratio: 0.999 });
  }
  await settings.getByText("Save settings").click();
  await expect(settings).toHaveCount(0);
  expect(errors).toEqual([]);
});
