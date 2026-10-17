import { test, expect } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";

test("four JetX cards place separately, restore correctly and cash out independently", async ({ page }, info) => {
  await mockGames(page);
  let phase = "betting";
  const posts: { panel: number; stakeAmount: string; autoCashOut?: number }[] = [];
  let receipts: { id: string; panel: number; stakeAmount: string; payoutAmount: string; status: string; multiplier: number | null }[] = [];
  await page.route("**/api/crash/**", route => {
    const now = Date.now();
    return route.fulfill({ json: { id: "crash-four-panels", gameCode: "jetx", phase, now, startsAt: phase === "betting" ? now + 20000 : now - 3500, bettingMs: 20000, multiplier: 1.42, nextRoundAt: null, crashPoint: null, serverSeedHash: "four-panels", clientSeed: "test", nonce: 0, version: 3, bets: receipts } });
  });
  await page.route("**/api/bets/place", async route => {
    const body = route.request().postDataJSON(); posts.push(body);
    await new Promise(resolve => setTimeout(resolve, 60));
    const receipt = { id: `panel-${body.panel}`, panel: body.panel, stakeAmount: body.stakeAmount, payoutAmount: "0", status: "placed", multiplier: null };
    receipts.push(receipt); return route.fulfill({ json: receipt });
  });
  await page.route("**/api/bets/*/cashout", route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2);
    receipts = receipts.map(r => r.id === id ? { ...r, status: "cashed_out", payoutAmount: String(Number(r.stakeAmount) * 1.42), multiplier: 1.42 } : r);
    return route.fulfill({ json: receipts.find(r => r.id === id) });
  });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 1192, height: 626 });
  await page.goto("/jetx");
  await expect(page.locator(".jetx-bet-panel:visible")).toHaveCount(4);
  for (let i = 0; i < 4; i++) await page.getByTestId(`input-amount-${i}`).fill(String((i + 1) * 100));
  await page.getByTestId("input-amount-3").blur();
  expect(posts).toHaveLength(0);
  await expect(page.getByTestId("btn-jetx-place-all")).toContainText("1,000.00");
  await page.getByRole("switch", { name: "Auto cashout for all bets" }).click();
  await page.getByRole("spinbutton", { name: "Auto cashout multiplier" }).fill("3");
  await page.getByTestId("btn-jetx-place-all").evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => posts.length).toBe(4);
  expect(posts.map(p => p.panel)).toEqual([0, 1, 2, 3]);
  expect(posts.map(p => p.stakeAmount)).toEqual(["10000", "20000", "30000", "40000"]);
  expect(posts.every(p => p.autoCashOut === 3)).toBe(true);
  await expect(page.getByTestId("btn-jetx-place-all")).toBeDisabled();
  await expect(page.locator(".jetx-bet-count")).toHaveText("4 Bets");
  phase = "flying";
  await page.reload();
  for (let i = 0; i < 4; i++) await expect(page.getByTestId(`btn-cashout-${i}`)).toBeEnabled();
  await page.getByTestId("btn-cashout-3").click();
  await expect(page.getByTestId("jetx-flight-canvas")).toHaveAttribute("data-cashout-ids", "panel-3");
  await expect(page.getByTestId("btn-cashout-0")).toBeEnabled();
  await expect(page.getByTestId("btn-cashout-1")).toBeEnabled();
  await expect(page.getByTestId("btn-cashout-2")).toBeEnabled();
  await expect(page.getByTestId("btn-bet-3")).toBeDisabled();
  await expect(page.locator(".jetx-players-summary")).toContainText("₹ 568.00");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: info.outputPath("reference-size-four-bets.png") });
  expect(posts).toHaveLength(4);
  expect(errors).toEqual([]);
});

test("Place all stops after a rejected reservation and keeps accepted cards locked", async ({ page }) => {
  await mockGames(page);
  const posted: number[] = [];
  await page.route("**/api/bets/place", route => {
    const body = route.request().postDataJSON(); posted.push(body.panel);
    return body.panel === 0
      ? route.fulfill({ json: { id: "accepted-first", status: "placed", stakeAmount: body.stakeAmount, payoutAmount: "0" } })
      : route.fulfill({ status: 400, json: { error: { message: "Betting window closed" } } });
  });
  await page.goto("/jetx");
  await page.getByTestId("btn-jetx-place-all").click();
  await expect(page.getByTestId("btn-bet-1")).toBeEnabled();
  await expect(page.getByTestId("btn-bet-0")).toHaveText("Bet accepted");
  expect(posted).toEqual([0, 1]);
});

test("JetX auto play stops when the player switches to another game", async ({ page }) => {
  await mockGames(page);
  const posts: unknown[] = [];
  await page.route("**/api/bets/place", route => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { error: { message: "Unexpected hidden placement" } } });
  });
  await page.goto("/jetx");
  await expect(page.getByTestId("jetx-countdown")).toBeVisible();
  await page.getByRole("button", { name: "Auto play settings" }).click();
  await page.getByText("Bet selection & limits").click();
  await page.getByRole("checkbox", { name: "Bet 4" }).check();
  await page.getByRole("button", { name: /Start 50 rounds/ }).click();
  await expect(page.getByRole("button", { name: "Stop auto play", exact: true })).toBeVisible();
  await page.evaluate(() => {
    history.pushState(null, "", "/fury");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.locator('[data-game-viewport="fury"]')).toBeVisible();
  await page.waitForTimeout(750);
  expect(posts).toEqual([]);
});

test("JetX panel layouts persist, quick stakes do not bet, and active cashout cards cannot be hidden", async ({ page }) => {
  await mockGames(page);
  let receipt: object | null = null;
  const posts: { panel: number; stakeAmount: string }[] = [];
  await page.route("**/api/crash/**", route => {
    const now = Date.now();
    return route.fulfill({ json: { id: "crash-layout", gameCode: "jetx", phase: "betting", now, startsAt: now + 20000, bettingMs: 20000, multiplier: 1, serverSeedHash: "layout", clientSeed: "test", nonce: 0, version: 3, bets: receipt ? [receipt] : [] } });
  });
  await page.route("**/api/bets/place", route => {
    const body = route.request().postDataJSON(); posts.push(body);
    receipt = { id: "layout-card-four", panel: body.panel, stakeAmount: body.stakeAmount, payoutAmount: "0", status: "placed", multiplier: null };
    return route.fulfill({ json: receipt });
  });
  await page.setViewportSize({ width: 1258, height: 636 });
  await page.goto("/jetx");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "2 Panel New" }).click();
  await expect(page.locator(".jetx-bet-panel:visible")).toHaveCount(2);
  await page.getByTestId("bet-panel-0").getByRole("button", { name: "5,000", exact: true }).click();
  await expect(page.getByTestId("input-amount-0")).toHaveValue("5000.00");
  expect(posts).toEqual([]);
  await page.reload();
  await expect(page.locator(".jetx-bet-panel:visible")).toHaveCount(2);
  for (const [width, height] of [[320, 568], [568, 320], [844, 390], [1258, 636]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId("btn-bet-0")).toBeInViewport({ ratio: .99 });
    await expect(page.getByTestId("btn-bet-1")).toBeInViewport({ ratio: .99 });
    const overlap = await page.evaluate(() => {
      const r = document.querySelector('.jetx-readout')!.getBoundingClientRect(), d = document.querySelector('.jetx-betting-dock')!.getBoundingClientRect();
      return r.left < d.right && r.right > d.left && r.top < d.bottom && r.bottom > d.top;
    });
    expect(overlap).toBe(false);
  }
  await page.getByRole("button", { name: "Toggle players sidebar" }).click();
  await expect(page.locator(".jetx-activity-column")).toBeHidden();
  await page.getByRole("button", { name: "Toggle players sidebar" }).click();
  await expect(page.locator(".jetx-activity-column")).toBeVisible();
  await page.getByRole("button", { name: /Try 4 Bets Panel/ }).click();
  await expect(page.locator(".jetx-bet-panel:visible")).toHaveCount(4);
  await page.getByTestId("btn-bet-3").click();
  await expect(page.getByTestId("btn-bet-3")).toHaveText("Bet accepted");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "2 Panel New" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "1 Panel Simple" })).toBeDisabled();
  await page.getByRole("switch", { name: "Animations", exact: true }).click();
  await expect(page.getByTestId("jetx-flight-canvas")).toHaveAttribute("data-reduced-motion", "true");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".jetx-bet-panel:visible")).toHaveCount(4);
  await expect(page.getByTestId("jetx-flight-canvas")).toHaveAttribute("data-reduced-motion", "true");
  expect(posts.map(p => p.panel)).toEqual([3]);
});
