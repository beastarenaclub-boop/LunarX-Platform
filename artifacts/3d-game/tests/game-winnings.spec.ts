import { test, expect } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";
import path from "node:path";

const bet = (id: string, gameCode: string, status = "won", stakeAmount = "10000", payoutAmount = "19800") => ({
  id, userId: "viewport-test", gameCode, status, stakeAmount, payoutAmount, roundId: `round-${id}`,
  placedAt: "2026-11-17T12:00:00Z", settledAt: status === "placed" ? null : "2026-11-17T12:00:30Z",
});
const report = (entries: ReturnType<typeof bet>[], nextCursor: string | null = null) => ({ items: entries.map(b => ({ id: b.id, at: b.placedAt, game: b.gameCode, reference: b.roundId, stake: b.stakeAmount, payout: b.payoutAmount, status: b.status })), nextCursor });

for (const [route, game] of [["dice", "dice"], ["lunar-colour-trading", "wingo"], ["mines", "mines"]]) {
  test(`${game}: persistent personal winnings fit phone, landscape and desktop`, async ({ page }) => {
    await mockGames(page);
    let entries = [bet("new", game, "placed", "5000", "0"), bet("won", game), bet("lost", game, "lost", "5000", "0"), bet("push", game, "won", "10000", "10000"), bet("refund", game, "voided", "10000", "10000"),
      bet("other-game", "baccarat")];
    await page.route("**/api/reports/gameresults?**", route => {
      expect(new URL(route.request().url()).searchParams.get("gameCode")).toBe(game);
      return route.fulfill({ json: report(entries) });
    });
    await page.goto(`/${route}`);
    await expect(page.getByTestId("game-last-win")).toHaveText("₹198.00");
    for (const [width, height] of [[320, 568], [844, 390], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await expect(page.getByTestId("game-winnings")).toBeInViewport();
      const bar = await page.getByTestId("game-winnings").boundingBox();
      expect(bar!.width).toBeLessThanOrEqual(width);
      await page.getByTestId("open-game-winnings").click();
      const dialog = page.getByTestId("game-winnings-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("game-result-row")).toHaveCount(5);
      await expect(dialog.locator('[data-bet="won"]')).toContainText("+₹98.00");
      await expect(dialog.locator('[data-bet="lost"]')).toContainText("−₹50.00");
      await expect(dialog.locator('[data-bet="push"]')).toContainText("Stake returned");
      await expect(dialog.locator('[data-bet="refund"]')).toContainText("Voided / refunded");
      await expect(dialog.locator('[data-bet="new"]')).toContainText("In progress");
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
      if (width === 320) await page.screenshot({ path: `../../tmp/game-winnings/${game}-mobile.png` });
      await page.keyboard.press("Escape");
    }
    // A subsequent losing round never erases the most recent winning receipt.
    entries = [bet("next-loss", game, "lost", "100", "0"), ...entries];
    await page.reload();
    await expect(page.getByTestId("game-last-win")).toHaveText("₹198.00");
  });
}

test("settlement refreshes the winning amount; errors preserve the receipt and retry", async ({ page }) => {
  await mockGames(page);
  let settled = false, offline = false;
  await page.route("**/api/reports/gameresults?**", route => offline ? route.fulfill({ status: 503, json: { message: "Unavailable" } })
    : route.fulfill({ json: report([bet("live", "dice", settled ? "won" : "placed", "10000", settled ? "19800" : "0")]) }));
  await page.goto("/dice");
  await expect(page.getByTestId("game-last-win")).toHaveText("Bet in progress");
  settled = true;
  await expect(page.getByTestId("game-last-win")).toHaveText("₹198.00", { timeout: 12000 });
  await expect(page.getByTestId("winning-notice")).toBeVisible();
  await expect(page.getByTestId("winning-notice-amount")).toHaveText("₹198.00");
  await page.getByRole("button", { name: "Dismiss winning notification" }).click();
  offline = true;
  await expect(page.getByRole("button", { name: "Retry winnings" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("game-last-win")).toHaveText("₹198.00");
  offline = false;
  await page.getByRole("button", { name: "Retry winnings" }).click();
  await expect(page.getByRole("button", { name: "Retry winnings" })).toHaveCount(0);
  await expect(page.getByTestId("winning-notice")).toHaveCount(0);
});

test("older receipts can be loaded and demo winnings use coins", async ({ page }) => {
  await mockGames(page);
  await page.route("**/api/auth/me", route => route.fulfill({ json: { id: "viewport-test", role: "player", displayName: "Demo", isDemo: true, demoExpiresAt: new Date(Date.now() + 3600000).toISOString() } }));
  await page.route("**/api/reports/gameresults?**", route => {
    const older = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({ json: report([older ? bet("older-win", "dice") : bet("loss", "dice", "lost", "100", "0")], older ? null : "page-2") });
  });
  await page.goto("/dice");
  await expect(page.getByTestId("game-last-win")).toHaveText("View older results");
  await page.getByTestId("open-game-winnings").click();
  await page.getByRole("button", { name: "Older results" }).click();
  await expect(page.getByTestId("game-result-row")).toHaveCount(2);
  await expect(page.getByTestId("game-winnings-dialog")).toContainText("198.00 coins");
  await expect(page.getByTestId("game-winnings-dialog")).not.toContainText("₹");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("winning-notice")).toHaveCount(0);
});

test("successful game action refreshes immediately without a socket and opens the winning receipt", async ({ page }) => {
  await mockGames(page);
  await page.setViewportSize({ width: 390, height: 844 });
  let entries: ReturnType<typeof bet>[] = [];
  await page.route("**/api/reports/gameresults?**", route => route.fulfill({ json: report(entries) }));
  await page.route("**/api/dice/roll", route => {
    entries = [bet("action-win", "dice")];
    return route.fulfill({ json: { accepted: true } });
  });
  await page.goto("/dice");
  await expect(page.getByTestId("game-last-win")).toHaveText("No wins yet");
  const moduleUrl = "/@fs/" + path.resolve(import.meta.dirname, "../../../lib/api-client-react/src/custom-fetch.ts").replaceAll("\\", "/");
  await page.evaluate(async moduleUrl => {
    const client = await import(/* @vite-ignore */ moduleUrl);
    await client.customFetch("/api/dice/roll", { method: "POST", body: "{}" });
  }, moduleUrl);
  await expect(page.getByTestId("winning-notice")).toBeVisible({ timeout: 4000 });
  await expect(page.getByTestId("winning-notice")).toContainText("Profit +₹98.00");
  await page.screenshot({ path: "../../tmp/game-winnings/new-win-mobile.png" });
  const notice = await page.getByTestId("winning-notice").boundingBox();
  expect(notice!.x).toBeGreaterThanOrEqual(0);
  expect(notice!.x + notice!.width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "View result", exact: true }).click();
  await expect(page.getByTestId("game-winnings-dialog")).toContainText("₹198.00");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("game-last-win")).toHaveText("₹198.00");
  await expect(page.getByTestId("winning-notice")).toHaveCount(0);
});

test("a native win popup suppresses a duplicate announcement", async ({ page }) => {
  await mockGames(page);
  let settled = false;
  await page.route("**/api/reports/gameresults?**", route => route.fulfill({ json: report([bet("native", "dice", settled ? "won" : "placed", "10000", settled ? "19800" : "0")]) }));
  await page.goto("/dice");
  await expect(page.getByTestId("game-last-win")).toHaveText("Bet in progress");
  await page.evaluate(() => { const native = document.createElement("section"); native.dataset.testid = "round-win-dialog"; document.body.append(native); });
  settled = true;
  await expect(page.getByTestId("game-last-win")).toHaveText("₹198.00");
  await expect(page.getByTestId("winning-notice")).toHaveCount(0);
});

test("embedded launcher games expose the same personal winnings", async ({ page }) => {
  await mockGames(page);
  await page.route("**/api/launcher/exchange", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/reports/gameresults?**", route => {
    expect(new URL(route.request().url()).searchParams.get("gameCode")).toBe("dice");
    return route.fulfill({ json: report([bet("embedded-win", "dice")]) });
  });
  await page.goto("/launcher?game=dice&token=ui-test-token");
  await expect(page.getByTestId("game-last-win")).toHaveText("₹198.00");
  await page.getByTestId("open-game-winnings").click();
  await expect(page.getByTestId("game-winnings-dialog")).toContainText("+₹98.00");
});

test("a game in fullscreen keeps winnings and its receipt accessible", async ({ page }) => {
  await mockGames(page);
  await page.route("**/api/reports/gameresults?**", route => route.fulfill({ json: report([bet("fullscreen-win", "dice")]) }));
  await page.goto("/dice");
  await expect(page.getByTestId("game-last-win")).toHaveText("₹198.00");
  await page.locator('[data-game-viewport="dice"]').evaluate(element => element.requestFullscreen());
  const shortcut = page.getByTestId("fullscreen-game-winnings");
  await expect(shortcut).toBeVisible();
  await expect(shortcut).toContainText("₹198.00");
  expect(await shortcut.evaluate(element => document.fullscreenElement?.contains(element))).toBe(true);
  await shortcut.click();
  const dialog = page.getByTestId("game-winnings-dialog");
  await expect(dialog).toContainText("+₹98.00");
  expect(await dialog.evaluate(element => document.fullscreenElement?.contains(element))).toBe(true);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => document.exitFullscreen());
  await expect(shortcut).toHaveCount(0);
  await expect(page.getByTestId("open-game-winnings")).toBeInViewport();
});
