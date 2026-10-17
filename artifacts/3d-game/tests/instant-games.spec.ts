import { test, expect, type Page } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";

const hash = "a".repeat(64);
function minesRound(status = "active", revealedIndexes: number[] = []) {
  return { id: "mine-round", betId: "bet-mine", stakeAmount: "10000", gridSize: 25, mineCount: 3,
    status, revealedIndexes, mineIndexes: status === "active" ? null : [2, 8, 20], serverSeed: status === "active" ? null : "server",
    serverSeedHash: hash, clientSeed: "player", nonce: 1, multiplier: revealedIndexes.length ? 1.15 : 1,
    nextMultiplier: 1.31, maxMultiplier: 1000, payoutAmount: status === "cashed_out" ? "11500" : status === "busted" ? "0" : null,
    createdAt: new Date().toISOString(), settledAt: status === "active" ? null : new Date().toISOString() };
}
async function setup(page: Page, options: { active?: ReturnType<typeof minesRound>; failRestore?: boolean } = {}) {
  await mockGames(page);
  const state = { mine: options.active ?? null as ReturnType<typeof minesRound> | null, drops: [] as any[], places: 0, reveals: 0, cashouts: 0, failRestore: options.failRestore ?? false };
  await page.route("**/api/mines/**", async route => {
    const p = new URL(route.request().url()).pathname;
    let json: unknown;
    if (p.endsWith("/config")) json = { enabled: true, houseEdge: .05, maxStakePaise: "10000000", maxMultiplier: 1000, multipliers: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i + 1, [1.15, 1.31, 1.5, 1.8, 2.1]])) };
    else if (p.endsWith("/active")) { if (state.failRestore) return route.fulfill({ status: 503, json: { detail: "Offline" } }); json = state.mine; }
    else if (p.endsWith("/recent")) json = state.mine ? [state.mine] : [];
    else if (p.endsWith("/place")) { state.places++; state.mine = minesRound(); json = state.mine; }
    else if (p.endsWith("/reveal")) { state.reveals++; const idx = route.request().postDataJSON().cellIndex; state.mine = minesRound(idx === 2 ? "busted" : "active", [...state.mine!.revealedIndexes, idx]); json = state.mine; }
    else if (p.endsWith("/cashout")) { state.cashouts++; state.mine = minesRound("cashed_out", state.mine!.revealedIndexes); json = state.mine; }
    else json = state.mine;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(json) });
  });
  await page.route("**/api/plinko/**", async route => {
    const p = new URL(route.request().url()).pathname;
    let json: unknown;
    if (p.endsWith("/config")) json = { enabled: true, houseEdge: .05, maxStakePaise: "10000000", maxMultiplier: 1000,
      multipliers: Object.fromEntries(["low", "medium", "high"].map(r => [r, Object.fromEntries([8, 12, 16].map(n => [n, Array.from({ length: n + 1 }, (_, i) => i === 0 || i === n ? 15 : .5)]))])) };
    else if (p.endsWith("/seed/rotate")) json = { revealedServerSeed: "old-seed", newSeed: { serverSeedHash: "b".repeat(64), clientSeed: "new-client", nextNonce: 0 } };
    else if (p.endsWith("/seed")) json = { serverSeedHash: hash, clientSeed: "player", nextNonce: state.drops.length };
    else if (p.endsWith("/drop")) {
      const body = route.request().postDataJSON();
      json = { id: `drop-${state.drops.length}`, betId: "drop-bet", ...body, path: Array(body.rows).fill("L"), bucket: 0, multiplier: 15,
        payoutAmount: "150000", serverSeed: null, serverSeedHash: hash, clientSeed: "player", nonce: state.drops.length, houseEdge: .05, maxMultiplier: 1000, createdAt: new Date().toISOString() };
      state.drops.unshift(json);
    } else if (p.endsWith("/verify")) json = { ...state.drops[0], serverSeed: "old-seed", verified: true };
    else if (p.endsWith("/recent")) json = state.drops;
    else json = {};
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(json) });
  });
  return state;
}

test("Mines: manual start, serialized reveals, cashout and replay", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/mines", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("mines-profit")).toHaveText("₹0.00");
  await page.getByTestId("btn-mines-place").click();
  expect(state.places).toBe(1);
  await expect(page.getByTestId("btn-mines-cashout")).toBeDisabled();
  await page.getByTestId("mines-cell-0").dblclick();
  await expect(page.getByTestId("mines-cell-0")).toHaveAccessibleName("Tile 1: gem");
  expect(state.reveals).toBe(1);
  await page.getByTestId("btn-mines-cashout").click();
  await expect(page.getByTestId("mines-payout")).toHaveText("₹115.00");
  expect(state.cashouts).toBe(1);
  await page.keyboard.press("Escape");
  await page.getByTestId("btn-mines-new-round").click();
  await expect(page.getByTestId("btn-mines-place")).toBeEnabled();
});
test("Mines: mine hit reveals board and excludes mine from gem count", async ({ page }) => {
  await setup(page); await page.goto("/mines", { waitUntil: "domcontentloaded" });
  await page.getByTestId("btn-mines-place").click(); await page.getByTestId("mines-cell-2").click();
  await expect(page.getByTestId("mines-cell-8")).toHaveAccessibleName("Tile 9: mine");
  await expect(page.getByTestId("mines-profit")).toHaveText("−₹100.00");
  await expect(page.getByText("22 gems remaining")).toBeVisible();
  await expect(page.getByTestId("btn-mines-new-round")).toBeEnabled();
});
test("Mines: restore failure blocks wagering until retry; refresh resumes active round", async ({ page }) => {
  const state = await setup(page, { failRestore: true }); await page.goto("/mines", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("We couldn't restore your round.", { exact: false })).toBeVisible();
  await expect(page.getByTestId("btn-mines-place")).toBeDisabled();
  state.failRestore = false; state.mine = minesRound("active", [0]);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByTestId("mines-cell-0")).toHaveAccessibleName("Tile 1: gem");
  await expect(page.getByTestId("btn-mines-cashout")).toBeEnabled();
  await page.reload(); await expect(page.getByTestId("btn-mines-cashout")).toBeEnabled();
  expect(state.places).toBe(0);
});
test("Mines: invalid amount does not place a round", async ({ page }) => {
  const state = await setup(page); await page.goto("/mines", { waitUntil: "domcontentloaded" });
  await page.getByTestId("input-mines-stake").fill("99999999");
  await expect(page.getByTestId("btn-mines-place")).toBeDisabled();
  await page.waitForTimeout(3200); expect(state.places).toBe(0);
});
for (const rows of [8, 12, 16]) test(`Plinko: ${rows} rows, result waits for ball and lands in exact pocket`, async ({ page }) => {
  await setup(page); await page.emulateMedia({ reducedMotion: "no-preference" }); await page.goto("/plinko", { waitUntil: "domcontentloaded" });
  await page.getByTestId(`rows-${rows}`).click(); await page.getByTestId("risk-high").click();
  await page.getByTestId("btn-plinko-drop").click();
  await expect(page.getByTestId("plinko-ball")).toBeVisible();
  await expect(page.getByTestId("plinko-last-multiplier")).toHaveText("—");
  await expect(page.getByTestId("rows-8")).toBeDisabled();
  await expect(page.getByTestId("plinko-bucket-0")).toHaveAttribute("data-landed", "true");
  await expect(page.getByTestId("plinko-last-multiplier")).toHaveText("15.00×");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("btn-plinko-drop")).toBeEnabled();
});
test("Plinko: auto count is exact and Stop prevents future drops", async ({ page }) => {
  const state = await setup(page); await page.goto("/plinko", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Auto drops", exact: true }).click();
  await page.getByTestId("input-auto-count").fill("3");
  await page.getByTestId("btn-auto-start").click();
  await expect(page.getByTestId("btn-auto-start")).toBeVisible({ timeout: 15000 });
  expect(state.drops).toHaveLength(3); await page.keyboard.press("Escape");
  await page.getByTestId("input-auto-count").fill("10"); await page.getByTestId("btn-auto-start").click();
  await expect(page.getByTestId("plinko-ball")).toBeVisible();
  const before = state.drops.length;
  await page.getByTestId("btn-auto-stop").click();
  await expect(page.getByTestId("btn-auto-start")).toBeVisible();
  expect(state.drops).toHaveLength(before);
});
test("Plinko: navigation cancels the auto loop", async ({ page }) => {
  const state = await setup(page); await page.goto("/plinko", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Auto drops", exact: true }).click(); await page.getByTestId("btn-auto-start").click();
  await expect(page.getByTestId("plinko-ball")).toBeVisible();
  await page.getByRole("link", { name: "Mines", exact: true }).click();
  await expect(page.getByTestId("btn-mines-place")).toBeVisible();
  await page.waitForTimeout(1600); expect(state.drops).toHaveLength(1);
});
test("Plinko: seed rotation and round verification are accessible", async ({ page }) => {
  await setup(page); await page.goto("/plinko", { waitUntil: "domcontentloaded" });
  await page.getByTestId("btn-fairness").click(); await page.getByTestId("btn-rotate-seed").click();
  await expect(page.getByText("old-seed", { exact: true })).toBeVisible(); await page.keyboard.press("Escape");
  await page.getByTestId("btn-plinko-drop").click(); await expect(page.getByTestId("plinko-last-multiplier")).toHaveText("15.00×");
  await page.keyboard.press("Escape"); await page.getByTestId("recent-drop-0").click(); await page.getByRole("button", { name: "Verify this drop" }).click();
  await expect(page.getByText("Server verification passed", { exact: false })).toBeVisible();
});
for (const game of ["mines", "plinko"]) test(`${game}: responsive layouts and screenshots`, async ({ page }, info) => {
  await setup(page); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`/${game}`, { waitUntil: "domcontentloaded" });
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 700], [844, 390], [768, 1024]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId(game === "mines" ? "btn-mines-place" : "btn-plinko-drop")).toBeVisible();
    const metrics = await page.evaluate(() => { const el = document.querySelector("[data-game-viewport]")!; return { overflow: el.scrollWidth - el.clientWidth, body: document.documentElement.scrollWidth - innerWidth, outside: [...document.querySelectorAll(".instant-page button")].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1); }).map(b => b.textContent) }; });
    expect(metrics).toEqual({ overflow: 0, body: 0, outside: [] });
    if (width === 1440 || width === 390) {
      await page.locator("[data-game-viewport]").evaluate(el => el.scrollTop = 0);
      await page.screenshot({ path: info.outputPath(`${game}-${width}.png`), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});
