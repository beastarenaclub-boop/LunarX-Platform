import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { mockGames } from "./fixtures/compact-game-data";
import { setup as horse } from "./horse-live-fixture";
import { setup as bike } from "./bike-live-fixture";
import type { GameState } from "../wingo/src/types";

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

async function fitsBrowser(page: Page, width: number, height: number) {
  await expect.poll(() => page.getByTestId("round-win-dialog").evaluate(el => {
    const box = el.getBoundingClientRect();
    const viewport = window.visualViewport!;
    const ok = el.querySelector('[data-testid="round-win-ok"]')!.getBoundingClientRect();
    const close = el.querySelector('[aria-label="Close winning result"]')!.getBoundingClientRect();
    return box.left >= viewport.offsetLeft && box.top >= viewport.offsetTop &&
      box.right <= viewport.offsetLeft + viewport.width + 1 && box.bottom <= viewport.offsetTop + viewport.height + 1 &&
      ok.top >= box.top && ok.bottom <= box.bottom && ok.height >= 44 &&
      close.top >= box.top && close.bottom <= box.bottom && close.width >= 44 &&
      el.scrollWidth <= el.clientWidth + 1;
  }), { message: `Popup and actions fit ${width} x ${height}` }).toBe(true);
  await expect(page.getByTestId("round-win-profit")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("round-win-payout")).toBeInViewport({ ratio: 1 });
}

const routes = ["play", "aviator", "jetx", "fury",
  "mines", "plinko", "dice", "roulette", "baccarat", "blackjack", "teen-patti", "teen-patti-live", "andar-bahar",
  "lucky-7", "dragon-tiger", "rummy", "vegetable-bowl", "horse-racing", "bike-racing", "wingo", "lunar-colour-trading"];

for (const route of routes) test(`${route}: readable browser-sized win on phone, tablet and desktop`, async ({ page, baseURL }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  if (route === "horse-racing" || route === "bike-racing") {
    await page.routeWebSocket("**/*", ws => ws.onMessage(() => {}));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type: string, ...args: any[]) {
        return type.includes("webgl") ? null : original.call(this, type as any, ...args);
      } as typeof original;
    });
    process.env.HORSE_GAME_URL = `${baseURL}/horse-racing`;
    process.env.BIKE_GAME_URL = `${baseURL}/bike-racing`;
    await (route === "horse-racing" ? horse : bike)(page, { holdBetting: true });
  } else {
    await mockGames(page);
    await page.goto(`/${route}`);
  }
  await expect(page.locator("[data-game-viewport]")).toBeVisible();
  await page.addScriptTag({ content: harness });
  const game = route === "play" ? "lunar" : route === "lunar-colour-trading" ? "wingo" : route;
  await page.evaluate(game => (window as any).showViewportReceipt(game), game);
  const popup = page.getByTestId("round-win-dialog");
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute("data-game", game);
  // A new betting round must not hide an unread result.
  await page.evaluate(game => (window as any).showViewportReceipt(game, "next-round"), game);
  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [844, 390], [568, 280], [1280, 600], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await fitsBrowser(page, width, height);
    await expect(page.getByTestId("round-win-profit")).toContainText("12,34,567.89");
    if (route === "vegetable-bowl" && width === 390) await page.screenshot({ path: info.outputPath("winning-popup-phone.png") });
  }
  await page.keyboard.press("Tab");
  expect(await popup.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await page.evaluate(game => (window as any).showViewportReceipt(game), game);
  await expect(popup).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Unread wins queue in order; refunds and losing rounds do not celebrate", async ({ page }) => {
  await mockGames(page);
  await page.goto("/dice");
  await page.addScriptTag({ content: harness });
  await page.evaluate(() => (window as any).showViewportReceipt("dice", "winning-round-1", "20000"));
  await expect(page.getByTestId("round-win-profit")).toHaveText("+₹100.00");
  await page.evaluate(() => (window as any).showViewportReceipt("dice", "winning-round-2", "40000"));
  await expect(page.getByTestId("round-win-profit")).toHaveText("+₹100.00");
  await page.getByTestId("round-win-ok").click();
  await expect(page.getByTestId("round-win-profit")).toHaveText("+₹300.00");
  await page.getByTestId("round-win-ok").click();
  for (const [round, payout] of [["winning-round-refund", "10000"], ["winning-round-loss", "0"], ["winning-round-2", "40000"]]) {
    await page.evaluate(([round, payout]) => (window as any).showViewportReceipt("dice", round, payout), [round, payout]);
    await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
  }
});

test("Popup follows the visible viewport when browser chrome or a keyboard reduces it", async ({ page }) => {
  await mockGames(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dice");
  await page.addScriptTag({ content: harness });
  await page.evaluate(() => (window as any).showViewportReceipt("dice"));
  await expect(page.getByTestId("round-win-dialog")).toBeVisible();
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperties(viewport, {
      width: { configurable: true, value: 330 }, height: { configurable: true, value: 260 },
      offsetLeft: { configurable: true, value: 20 }, offsetTop: { configurable: true, value: 80 },
    });
    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
  });
  await fitsBrowser(page, 330, 260);
  await expect(page.getByTestId("round-win-screen")).toHaveAttribute("data-size", "small");
  await page.getByTestId("round-win-ok").click();
  await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
});

test("Vegetable Bowl shows a settled win once, with accurate net and returned stake", async ({ page }) => {
  await mockGames(page);
  const now = Date.now();
  await page.route("**/api/vegetable-bowl/round", route => route.fulfill({ json: {
    roundId: "harvest-win", gameCode: "vegetable-bowl", phase: "settling", now: Date.now(),
    bettingEndsAt: now - 20000, revealEndsAt: now - 1000, settleEndsAt: now + 120000,
    config: { enabled: true, bettingWindowMs: 20000, revealDurationMs: 18000, settleDurationMs: 120000, minStakePaise: "100", maxStakePaise: "1000000" },
    outcome: { total: 1, winner: "normal", vegetables: ["carrot"] }, serverSeedHash: "test", clientSeed: "test", nonce: 1, serverSeed: "test",
    totalStake: "10000", playerCount: 1, liveBets: [], recent: [],
    myBets: [{ slipId: "harvest-slip", totalStake: "10000", payoutAmount: "19800", status: "settled", bets: [{ type: "normal", amountPaise: "10000" }] }],
  } }));
  await page.goto("/vegetable-bowl");
  await expect(page.getByTestId("round-win-dialog")).toBeVisible();
  await expect(page.getByTestId("round-win-profit")).toHaveText("+₹98.00");
  await expect(page.getByTestId("round-win-payout")).toHaveText("₹198.00");
  await page.getByRole("button", { name: "Close winning result" }).click();
  await page.reload();
  await expect(page.locator(".vb-page")).toBeVisible();
  await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
});

test("Colour Trading queues settled rounds, aggregates losing picks and ignores refunds", async ({ page }) => {
  await mockGames(page);
  const now = Date.now();
  let state: GameState = {
    serverTime: now, player: { id: "colour-player", balance: 1000000 },
    round: { period: "colour-next", duration: 30, start: now, ends: now + 120000, commitment: "test" },
    history: [], bets: [
      { id: "colour-win", period: "colour-round", duration: 30, created: now, pick: "red", stake: 10000, payout: null, number: null },
      { id: "colour-loss", period: "colour-round", duration: 30, created: now, pick: "green", stake: 15000, payout: null, number: null },
      { id: "colour-win-2", period: "colour-round-2", duration: 30, created: now, pick: "big", stake: 10000, payout: null, number: null },
      { id: "colour-refund", period: "colour-refund", duration: 30, created: now, pick: "red", stake: 10000, payout: null, number: null },
    ], summary: { played: 0, won: 0, profit: 0 }, pending: 4, lockSeconds: 5, minStake: 100, maxStake: 1000000,
  };
  await page.route("**/api/wingo/**", route => route.fulfill({ json: { ...state, serverTime: Date.now() } }));
  await page.goto("/lunar-colour-trading");
  // Wait until pending bets have been accepted, not just the loading shell.
  await expect(page.getByText("#colour-next", { exact: true })).toBeVisible();
  await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
  state = { ...state, bets: state.bets.map((bet, index) => ({ ...bet, payout: [20000, 0, 20000, 10000][index], number: 8 })) };
  await expect(page.getByTestId("round-win-profit")).toHaveText("−₹50.00");
  await expect(page.getByTestId("round-win-payout")).toHaveText("₹200.00");
  await expect(page.getByRole("heading", { name: "Winning bet!" })).toBeVisible();
  await page.getByTestId("round-win-ok").click();
  await expect(page.getByTestId("round-win-profit")).toHaveText("+₹100.00");
  await page.getByTestId("round-win-ok").click();
  await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".wingo-integrated")).toBeVisible();
  await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
});
