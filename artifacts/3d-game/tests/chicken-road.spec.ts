import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { CHICKEN_MODES, chickenReturn, chickenSurvival, type ChickenRound } from "@workspace/api-zod/chicken-road-game";

async function setup(page: Page, options: { lose?: boolean; lostResponse?: boolean; lowBalance?: boolean; timed?: boolean } = {}) {
  let balance = options.lowBalance ? 0n : 1000000n;
  let round: ChickenRound | null = null;
  let dropped = false;
  let pauseSettlement = false;
  const posts: { path: string; body: any }[] = [], errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("aviator:v1", JSON.stringify({ settings: { onboarded: true, sound: false } })));
  await page.routeWebSocket("**/ws", ws => ws.onMessage(() => {}));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    // Deliberately offset the server clock to exercise client clock synchronization.
    const serverNow = options.timed ? await page.evaluate(() => Date.now() + 300000) : Date.now();
    if (options.timed && round?.status === "active" && round.expiresAt && serverNow >= Date.parse(round.expiresAt) && !pauseSettlement) {
      round.status = "cashed_out"; round.endReason = "timeout";
      round.payoutAmount = round.cashoutAmount; round.serverSeed = "revealed-seed";
      balance += BigInt(round.payoutAmount);
    }
    if (options.timed && round) round.serverTime = serverNow;
    let body: unknown = {};
    if (path === "/api/auth/me") body = { id: "chicken-browser", displayName: "Road player", email: "road@example.test", role: "player" };
    else if (path === "/api/game/registry") body = [{ gameCode: "chicken-road", title: "Chicken Road", route: "/chicken-road", enabled: true }];
    else if (path === "/api/wallet/balances") body = { balances: { lunar: balance.toString() } };
    else if (path === "/api/wallet/balance") body = { balance: balance.toString(), currency: "INR", scope: "lunar", walletId: "same-wallet" };
    else if (path === "/api/chicken-road/config") body = { enabled: true, minStakePaise: "100", maxStakePaise: "1000000", rtp: null, version: 2 };
    else if (path === "/api/chicken-road/state") body = { round: round?.status === "active" ? round : null, history: round ? [round] : [] };
    else if (path.startsWith("/api/chicken-road/") && route.request().method() === "POST") {
      const input = route.request().postDataJSON(); posts.push({ path, body: input });
      if (path.endsWith("/place")) {
        if (round?.requestId !== input.requestId) {
          balance -= BigInt(input.stakeAmount);
          round = { id: `round-${posts.length}`, requestId: input.requestId, version: options.lose ? 1 : 2, difficulty: input.difficulty, status: "active", step: 0, attemptedStep: 0, totalSteps: CHICKEN_MODES[input.difficulty as "easy"].returns.length, stakeAmount: input.stakeAmount, payoutAmount: "0", cashoutAmount: input.stakeAmount, multiplier: 1, nextMultiplier: chickenReturn(input.difficulty, 1) / 100, nextSurvival: chickenSurvival(input.difficulty, 1, options.lose ? 1 : 2), serverSeedHash: "commitment-before-first-step", serverSeed: null, clientSeed: input.clientSeed, createdAt: new Date().toISOString() };
        }
        if (options.lostResponse && !dropped) { dropped = true; return route.abort("connectionreset"); }
      } else if (round && path.endsWith("/step")) {
        round.attemptedStep++;
        if (options.lose) { round.status = "busted"; round.serverSeed = "revealed-seed"; }
        else { round.step++; round.multiplier = chickenReturn(round.difficulty, round.step) / 100; round.cashoutAmount = (BigInt(round.stakeAmount) * BigInt(chickenReturn(round.difficulty, round.step)) / 100n).toString(); round.nextMultiplier = chickenReturn(round.difficulty, round.step + 1) / 100; round.nextSurvival = chickenSurvival(round.difficulty, round.step + 1, round.version); }
      } else if (round && path.endsWith("/cashout") && round.status === "active") { round.status = "cashed_out"; round.payoutAmount = round.cashoutAmount; round.serverSeed = "revealed-seed"; balance += BigInt(round.payoutAmount); }
      if (options.timed && round) {
        round.expiresAt ??= new Date(serverNow + 60000).toISOString();
        round.serverTime = serverNow;
      }
      body = round;
    } else if (path.includes("/config/")) body = { enabled: true, houseEdge: .02, maxMultiplier: 1000 };
    else if (path.includes("banners") || path.includes("coin-packs") || path.includes("upi-accounts")) body = [];
    else if (path.includes("transactions") || path.includes("deposits") || path.includes("withdrawals")) body = { entries: [], nextCursor: null };
    await route.fulfill({ json: body });
  });
  await page.goto("/chicken-road");
  await expect(page.getByTestId("chicken-wallet")).toContainText(options.lowBalance ? "0.00" : "10,000.00");
  return { posts, errors, get balance() { return balance; }, get round() { return round; }, pauseSettlement(value: boolean) { pauseSettlement = value; } };
}

test("round countdown survives moves and reload, blocks overdue actions and refreshes auto-cashout wallet", async ({ page }) => {
  await page.clock.install();
  const f = await setup(page, { timed: true });
  await expect(page.getByTestId("chicken-timer")).toContainText("60s");
  await expect(page.getByTestId("chicken-play")).toBeEnabled();
  await page.getByTestId("chicken-play").dispatchEvent("click");
  await expect(page.getByTestId("chicken-timer")).toContainText("01:00");
  const deadline = f.round!.expiresAt;
  await page.clock.fastForward(20000);
  await expect(page.getByTestId("chicken-timer")).toHaveText(/00:(3\d|40)LEFT/);
  await expect(page.getByTestId("chicken-step")).toBeEnabled();
  await page.getByTestId("chicken-step").dispatchEvent("click");
  await expect(page.getByTestId("chicken-cashout")).toContainText("101.00");
  expect(f.round!.expiresAt).toBe(deadline);
  await page.clock.fastForward(1000);
  await page.reload();
  await expect(page.getByTestId("chicken-timer")).toHaveAttribute("aria-label", "Round time remaining");
  expect(f.round!.expiresAt).toBe(deadline);
  const left = Date.parse(deadline!) - await page.evaluate(() => Date.now() + 300000);
  expect(left).toBeGreaterThan(0);
  expect(left).toBeLessThanOrEqual(40000);
  f.pauseSettlement(true);
  await page.clock.fastForward(Math.max(0, left - 9000));
  await expect(page.getByTestId("chicken-timer")).toHaveClass(/is-urgent/);
  await expect(page.getByTestId("chicken-timer")).toHaveText(/00:0\dLEFT/);
  await page.clock.fastForward(10000);
  await expect(page.getByTestId("chicken-timer")).toContainText("00:00");
  await expect(page.getByTestId("chicken-step")).toBeDisabled();
  await expect(page.getByTestId("chicken-cashout")).toBeDisabled();
  expect(f.posts.map(p => p.path.split("/").at(-1))).toEqual(["place", "step"]);
  f.pauseSettlement(false);
  await page.clock.fastForward(4000);
  await expect(page.locator(".cr-result")).toContainText("TIME UP · AUTO CASHOUT");
  await expect(page.getByTestId("chicken-wallet")).toContainText("10,001.00");
  await expect(page.getByTestId("chicken-play")).toBeEnabled();
  expect(f.posts).toHaveLength(2);
  expect(f.errors).toEqual([]);
});

test("idle round timeout returns the stake without automatically placing another bet", async ({ page }) => {
  await page.clock.install();
  const f = await setup(page, { timed: true });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.getByTestId("chicken-play")).toBeEnabled();
  await page.getByTestId("chicken-play").dispatchEvent("click");
  await expect(page.getByTestId("chicken-step")).toBeVisible();
  await expect(page.getByTestId("chicken-timer")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const controls = (await page.getByTestId("chicken-step").boundingBox())!;
  expect(controls.y + controls.height).toBeLessThanOrEqual(569);
  await page.clock.fastForward(61000);
  await expect(page.getByText("Stake returned to your wallet", { exact: true })).toBeVisible();
  await expect(page.getByTestId("chicken-wallet")).toContainText("10,000.00");
  await page.clock.fastForward(120000);
  expect(f.posts).toHaveLength(1);
  expect(f.balance).toBe(1000000n);
  expect(f.errors).toEqual([]);
});

test("coins, stake debit, safe step, cash out, lobby wallet and refreshed history", async ({ page }) => {
  const f = await setup(page);
  await expect(page.getByRole("button", { name: "Cross lane 1 for +0.01x profit", exact: true })).toContainText("+0.01x");
  await page.getByRole("button", { name: "₹100 coin", exact: true }).click();
  await page.getByTestId("chicken-play").click();
  await expect(page.getByTestId("chicken-wallet")).toContainText("9,900.00");
  await expect(page.getByLabel("Difficulty", { exact: true })).toBeDisabled();
  await expect(page.getByTestId("chicken-cashout")).toBeDisabled();
  await expect(page.getByTestId("chicken-step")).toContainText("Profit +0.01x");
  await page.getByTestId("chicken-step").click();
  await expect(page.getByTestId("chicken-cashout")).toContainText("101.00");
  await expect(page.locator(".cr-current")).toContainText("+0.01x");
  await expect(page.getByTestId("chicken-cashout")).toContainText("Stake + profit");
  await page.getByTestId("chicken-cashout").click();
  await expect(page.getByTestId("chicken-wallet")).toContainText("10,001.00");
  await expect(page.getByText("Winnings added to your wallet")).toBeVisible();
  await expect(page.locator(".cr-result")).toContainText("+0.01x");
  expect(f.posts.map(p => p.path.split("/").at(-1))).toEqual(["place", "step", "cashout"]);
  await page.getByLabel("Back to lobby").click();
  await expect(page.getByTestId("card-game-chicken-road").first()).toBeVisible();
  await expect(page.locator("body")).toContainText("10,001.00");
  await page.getByTestId("card-game-chicken-road").first().click();
  await page.reload();
  await page.getByLabel("Round history", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("101.00");
  await expect(page.getByRole("dialog")).toContainText("+0.01x profit");
  expect(f.errors).toEqual([]);
});

test("accepted request lost in transit and reload recover one stake", async ({ page }) => {
  const f = await setup(page, { lostResponse: true });
  await page.getByTestId("chicken-play").click();
  await expect(page.getByTestId("chicken-step")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("chicken-step")).toBeVisible();
  await expect(page.getByTestId("chicken-wallet")).toContainText("9,900.00");
  expect(f.posts).toHaveLength(1); expect(f.balance).toBe(990000n);
});

test("classic version 1 losses still display correctly, support all modes, and reject invalid stakes", async ({ page }) => {
  const f = await setup(page, { lose: true });
  for (const difficulty of ["medium", "hard", "hardcore", "easy"]) {
    await page.getByLabel("Difficulty", { exact: true }).selectOption(difficulty);
    await page.getByTestId("chicken-play").click(); await page.getByTestId("chicken-step").click();
    await expect(page.getByText("Oh, cluck!")).toBeVisible();
    await expect(page.getByTestId("chicken-play")).toBeEnabled();
  }
  expect(f.balance).toBe(960000n);
  await page.getByLabel("Bet amount", { exact: true }).fill("-1"); await expect(page.getByTestId("chicken-play")).toBeDisabled();
  await page.getByLabel("Bet amount", { exact: true }).fill("2.001"); await expect(page.getByTestId("chicken-play")).toBeDisabled();
  await page.getByLabel("Bet amount", { exact: true }).fill("10001"); await expect(page.getByTestId("chicken-play")).toBeDisabled();
  expect(f.errors).toEqual([]);
});

test("all controls and dialogs fit mobile, tablet, desktop and landscape", async ({ page }) => {
  const f = await setup(page);
  for (const [width, height] of [[320,568],[390,844],[478,854],[768,1024],[1440,900],[844,390]]) {
    await page.setViewportSize({ width, height });
    const play = page.getByTestId("chicken-play"); await expect(play).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const box = (await play.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1); expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    await page.screenshot({ path: path.resolve(import.meta.dirname, `../../../tmp/chicken-road-${width}.png`) });
    await page.getByLabel("Game rules", { exact: true }).click();
    const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
    const d = (await dialog.boundingBox())!;
    expect(d.x).toBeGreaterThanOrEqual(0); expect(d.y).toBeGreaterThanOrEqual(0); expect(d.y + d.height).toBeLessThanOrEqual(height + 1);
    await page.keyboard.press("Escape");
  }
  await page.getByLabel("Enable sound", { exact: true }).click(); await expect(page.getByLabel("Mute sound", { exact: true })).toBeVisible();
  await page.getByLabel("Coin settings", { exact: true }).click(); await expect(page.getByTestId("coin-settings-dialog")).toBeVisible();
  await page.keyboard.press("Escape"); expect(f.errors).toEqual([]);
});

test("zero balance disables play and keeps the shared wallet link", async ({ page }) => {
  const f = await setup(page, { lowBalance: true });
  await expect(page.getByTestId("chicken-play")).toBeDisabled();
  await expect(page.getByLabel("Open shared wallet")).toHaveAttribute("href", "/wallet");
  expect(f.posts).toHaveLength(0);
});

async function observeChickenAudio(page: Page) {
  await page.addInitScript(() => {
    const events: { duration: number; ended: boolean; peak: number }[] = [];
    (window as any).chickenAudioEvents = events;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args: Parameters<typeof start>) {
      if (this.buffer && !this.loop) {
        let peak = 0;
        for (const sample of this.buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
        const entry = { duration: this.buffer.duration, ended: false, peak };
        events.push(entry);
        this.addEventListener("ended", () => { entry.ended = true; });
      }
      return start.apply(this, args);
    };
  });
}
const audioEvents = (page: Page) => page.evaluate(() => (window as any).chickenAudioEvents as { duration: number; ended: boolean; peak: number }[]);

test("chicken calls follow play, hop and cashout; mute persists and leaving stops calls", async ({ page }) => {
  await observeChickenAudio(page);
  const f = await setup(page);
  await page.getByLabel("Enable sound", { exact: true }).click();
  await expect.poll(async () => (await audioEvents(page)).some(e => Math.abs(e.duration - .56) < .001 && e.peak > .1)).toBe(true);
  await expect.poll(async () => (await audioEvents(page)).every(e => e.ended)).toBe(true);
  const previewCount = (await audioEvents(page)).length;
  await page.getByTestId("chicken-play").click();
  await expect.poll(async () => (await audioEvents(page)).slice(previewCount).some(e => Math.abs(e.duration - .56) < .001)).toBe(true);
  await page.getByTestId("chicken-step").click();
  await expect.poll(async () => (await audioEvents(page)).some(e => e.duration === .48)).toBe(true);
  await page.getByTestId("chicken-cashout").click();
  await expect.poll(async () => (await audioEvents(page)).some(e => e.duration === 1.3)).toBe(true);
  await page.getByLabel("Mute sound", { exact: true }).click();
  await expect.poll(async () => (await audioEvents(page)).every(e => e.ended)).toBe(true);
  const mutedCount = (await audioEvents(page)).length;
  await page.getByTestId("chicken-play").click();
  await page.getByTestId("chicken-step").click();
  await expect(page.getByTestId("chicken-cashout")).toBeEnabled();
  expect((await audioEvents(page)).length).toBe(mutedCount);
  await page.reload();
  await expect(page.getByLabel("Enable sound", { exact: true })).toBeVisible();
  expect(await audioEvents(page)).toEqual([]);
  await page.getByLabel("Enable sound", { exact: true }).click();
  await page.getByTestId("chicken-cashout").click();
  await expect.poll(async () => (await audioEvents(page)).some(e => e.duration === 1.3)).toBe(true);
  await page.getByLabel("Back to lobby").click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await audioEvents(page)).every(e => e.ended)).toBe(true);
  expect(f.errors).toEqual([]);
});

test("a classic version 1 collision plays the squawk and loses only the stake", async ({ page }) => {
  await observeChickenAudio(page);
  const f = await setup(page, { lose: true });
  await page.getByLabel("Enable sound", { exact: true }).click();
  await page.getByTestId("chicken-play").click();
  await page.getByTestId("chicken-step").click();
  await expect(page.getByText("Oh, cluck!")).toBeVisible();
  await expect.poll(async () => (await audioEvents(page)).some(e => e.duration === .76 && e.peak > .1)).toBe(true);
  await expect(page.getByTestId("chicken-wallet")).toContainText("9,900.00");
  expect(f.errors).toEqual([]);
});

test("waiting chicken hops and plays its jump sound without placing bets, pauses during Go, and respects mute", async ({ page }) => {
  await observeChickenAudio(page);
  const f = await setup(page);
  const chicken = page.locator(".cr-chicken"), sprite = chicken.locator("img");
  const idleCalls = async () => (await audioEvents(page)).filter(e => Math.abs(e.duration - .36) < .001).length;
  await expect(chicken).toHaveClass(/is-idle/);
  await expect(sprite).toHaveCSS("animation-name", "cr-idle-hop");
  const initialTransform = await sprite.evaluate(el => getComputedStyle(el).transform);
  await expect.poll(() => sprite.evaluate(el => getComputedStyle(el).transform)).not.toBe(initialTransform);
  await page.getByLabel("Enable sound", { exact: true }).click();
  await expect.poll(idleCalls).toBeGreaterThanOrEqual(2);
  expect(f.posts).toHaveLength(0);
  await expect(page.getByTestId("chicken-wallet")).toContainText("10,000.00");
  await page.getByLabel("Mute sound", { exact: true }).click();
  const mutedCalls = await idleCalls();
  // Observe an entire animation cycle: muted motion must never emit another call.
  await page.waitForTimeout(3000);
  expect(await idleCalls()).toBe(mutedCalls);
  await expect(sprite).toHaveCSS("animation-name", "cr-idle-hop");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(chicken).not.toHaveClass(/is-idle/);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(chicken).toHaveClass(/is-idle/);
  await page.getByLabel("Enable sound", { exact: true }).click();
  await page.getByTestId("chicken-play").click();
  await expect(page.getByTestId("chicken-step")).toBeEnabled();
  await expect(chicken).toHaveClass(/is-idle/);
  const beforeGo = await idleCalls();
  await expect.poll(idleCalls).toBeGreaterThan(beforeGo);
  expect(f.posts.map(p => p.path.split("/").at(-1))).toEqual(["place"]);
  await expect(page.getByRole("progressbar", { name: "Lanes crossed" })).toHaveAttribute("aria-valuenow", "0");

  let release!: () => void;
  const requestGate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/chicken-road/*/step", async route => { await requestGate; await route.fallback(); });
  try {
    await page.getByTestId("chicken-step").click();
    await expect(chicken).not.toHaveClass(/is-idle/);
  } finally { release(); }
  await expect(page.getByTestId("chicken-cashout")).toBeEnabled();
  await expect(chicken).toHaveClass(/is-idle/);
  await page.getByTestId("chicken-cashout").click();
  await expect(chicken).toHaveClass(/is-celebrating/);
  await expect(chicken).not.toHaveClass(/is-idle/);
  const afterCashout = await idleCalls();
  await page.waitForTimeout(3000);
  expect(await idleCalls()).toBe(afterCashout);
  expect(f.errors).toEqual([]);
});

test("reduced motion disables waiting jumps and their repeating sound", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await observeChickenAudio(page);
  const f = await setup(page);
  await page.getByLabel("Enable sound", { exact: true }).click();
  await expect(page.locator(".cr-chicken img")).toHaveCSS("animation-name", "none");
  await page.waitForTimeout(3000);
  expect((await audioEvents(page)).filter(e => Math.abs(e.duration - .36) < .001)).toEqual([]);
  expect(f.posts).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test("guaranteed mode shows 100% safe crossings in every difficulty and explains the return", async ({ page }) => {
  const f = await setup(page);
  await expect(page.locator(".cr-footer")).toContainText("100% win chance");
  await page.getByLabel("Game rules", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("100% crossing chance on every lane");
  await expect(page.getByRole("dialog")).toContainText("100% win chance is not 100% RTP");
  await expect(page.getByRole("dialog")).not.toContainText("2% house edge");
  await page.keyboard.press("Escape");
  for (const mode of ["easy", "medium", "hard", "hardcore"] as const) {
    await page.getByLabel("Difficulty", { exact: true }).selectOption(mode);
    await expect(page.locator(".cr-risk")).toContainText("Every lane is safe");
    await page.getByTestId("chicken-play").click();
    await page.getByTestId("chicken-step").click();
    await expect(page.locator(".cr-feedback")).toContainText("100.0% safe");
    await page.getByTestId("chicken-cashout").click();
    await expect(page.getByText("Winnings added to your wallet")).toBeVisible();
  }
  expect(f.balance).toBe(1008800n);
  await page.getByRole("button", { name: "Fairness", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Guaranteed-win rules");
  await page.getByText("Guaranteed-win rule", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Version 2 uses a 100% survival probability");
  expect(f.errors).toEqual([]);
});
