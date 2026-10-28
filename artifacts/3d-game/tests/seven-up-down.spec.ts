import { test, expect, type Page } from "@playwright/test";
import { sevenPayout } from "@workspace/api-zod/instant-collection";

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    (window as any).sevenAudio = [];
    (window as any).audioFingerprint = (buffer: AudioBuffer) => {
      let hash = buffer.length;
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 97) hash = Math.imul(hash ^ Math.round(samples[i] * 1e7), 16777619);
      return hash;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      const samples = this.buffer?.getChannelData(0) ?? [];
      let peak = 0; for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      const event = { duration: this.buffer?.duration ?? 0, loop: this.loop, ended: false, peak, fingerprint: this.buffer ? (window as any).audioFingerprint(this.buffer) : null };
      (window as any).sevenAudio.push(event);
      this.addEventListener("ended", () => { event.ended = true; });
      return start.apply(this, args);
    };
  });
}
const audioCount = (page: Page) => page.evaluate(() => (window as any).sevenAudio.length as number);
const cueCount = (page: Page, cue: number | string) => page.evaluate(c => (window as any).sevenAudio.filter((e: any) => !e.loop && (typeof c === "number" ? Math.abs(e.duration - c) < .001 : e.fingerprint === (window as any).exactSeven[c])).length as number, cue);

async function setup(page: Page, options: { low?: boolean; drop?: boolean; reject?: boolean } = {}) {
  let wallet = options.low ? 500n : 1000000n, dropped = false, id = 1, phase = "betting", outcome: any = null, myBets: any[] = [];
  let bettingEndsAt = Date.now() + 60000, offline = false;
  const history: any[] = [], recent: any[] = [], posts: any[] = [], errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("aviator:v1", JSON.stringify({ settings: { onboarded: true, sound: false } })));
  await page.routeWebSocket("**/ws", ws => ws.onMessage(() => {}));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me") body = { id: "seven-test", displayName: "Player", email: "seven@example.test", role: "player" };
    else if (path === "/api/wallet/balance") body = { balance: String(wallet), currency: "INR", scope: "lunar", walletId: "shared" };
    else if (path === "/api/wallet/balances") body = { balances: { lunar: String(wallet) } };
    else if (path.startsWith("/api/7up7down")) {
      if (offline) return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
      if (path.endsWith("/config")) body = { enabled: true, minStakePaise: "1000", maxStakePaise: "1000000", rtp: .97, maxMultiplier: 1.98, sevenPayoutVersion: 2 };
      else if (path.endsWith("/state")) body = { round: null, history };
      else if (path.endsWith("/round")) body = { roundId: `live-${id}`, phase, now: Date.now(), bettingEndsAt, revealEndsAt: Date.now() + 3000, settleEndsAt: Date.now() + 4000, outcome, myBets, recent, liveBets: [], playerCount: myBets.length, totalStake: myBets[0]?.totalStake ?? "0", config: { sevenPayoutVersion: 2, houseEdge: .03, minStakePaise: "1000", maxStakePaise: "1000000", maxMultiplier: 1000, bettingWindowMs: 120000, revealDurationMs: 3000, settleDurationMs: 4000 } };
      else if (path.endsWith("/bet")) {
        const input = route.request().postDataJSON(); posts.push(input);
        if (options.reject) return route.fulfill({ status: 400, json: { detail: "Betting is closed. Choose your chips for the next round." } });
        if (!myBets.length) {
          const totalStake = input.bets.reduce((sum: bigint, b: any) => sum + BigInt(b.amount), 0n);
          wallet -= totalStake;
          myBets = [{ slipId: `slip-${id}`, totalStake: String(totalStake), bets: input.bets, status: "pending", payoutAmount: "0" }];
        }
        if (options.drop && !dropped) { dropped = true; return route.abort("connectionreset"); }
        body = { ...myBets[0], roundId: `live-${id}` };
      }
    } else if (path.includes("banners") || path.includes("coin-packs") || path.includes("upi-accounts") || path.includes("registry")) body = [];
    else if (path.includes("transactions") || path.includes("/bets")) body = { entries: [], nextCursor: null };
    await route.fulfill({ json: body });
  });
  await page.goto("/7up7down");
  await expect(page.getByTestId("seven-spot-up")).toBeEnabled();
  await page.evaluate(async () => {
    if (!(window as any).sevenAudio) return;
    const modulePath = "/src/game/publicDemoSounds.ts";
    const { PublicDemoSoundBank, PUBLIC_DEMO_AUDIO_MANIFEST } = (window as any).sevenTestRecordings ?? await import(modulePath);
    const context = new AudioContext(), bank = new PublicDemoSoundBank(context);
    (window as any).exactSeven = {};
    for (const cue of Object.keys(PUBLIC_DEMO_AUDIO_MANIFEST.seven)) {
      await bank.prepare("7up7down", cue);
      (window as any).exactSeven[cue] = (window as any).audioFingerprint(bank.take("7up7down", cue).buffer);
    }
    await context.close();
  });
  return {
    posts, errors, get wallet() { return wallet; },
    disconnect() { offline = true; }, reconnect() { offline = false; },
    countdown(seconds: number) { bettingEndsAt = Date.now() + seconds * 1000; },
    reveal() { phase = "reveal"; bettingEndsAt = Date.now() - 1; },
    land(dice = [5, 3]) { outcome = { dice, total: dice[0] + dice[1] }; },
    settle() {
      phase = "settling";
      if (myBets[0]?.status === "pending") {
        const payout = sevenPayout(myBets[0].bets, outcome.dice, .97);
        wallet += payout; myBets[0] = { ...myBets[0], status: "settled", payoutAmount: String(payout) };
        history.unshift({ id: `live-${id}`, outcome: outcome.dice, options: { bets: myBets[0].bets }, stakeAmount: myBets[0].totalStake, payoutAmount: String(payout), createdAt: new Date().toISOString() });
      }
    },
    next() { recent.unshift({ roundId: `live-${id}`, outcome }); id++; phase = "betting"; outcome = null; myBets = []; bettingEndsAt = Date.now() + 60000; },
  };
}

test("all range and number spots show 1.98 total return and explain the 98 paise profit", async ({ page }) => {
  await setup(page);
  await expect(page.locator(".sud-odds")).toHaveText(Array(13).fill("1.98×"));
  await expect(page.getByTestId("seven-spot-down")).toContainText("2–6");
  await expect(page.getByTestId("seven-spot-up")).toContainText("8–12");
  await page.getByRole("button", { name: "Game rules", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("a ₹1 bet returns ₹1.98, including ₹0.98 profit");
  await expect(page.getByRole("dialog")).not.toContainText("current RTP");
});

test("chips support multiple spots, double, undo, clear and single mode", async ({ page }) => {
  const f = await setup(page);
  await page.getByTestId("seven-spot-up").click(); await page.getByTestId("seven-spot-8").click();
  await expect(page.getByTestId("seven-total-bet")).toHaveText("₹20.00");
  await page.getByRole("button", { name: "Double bets", exact: true }).click();
  await expect(page.getByTestId("seven-total-bet")).toHaveText("₹40.00");
  await page.getByRole("button", { name: "Undo last chip" }).click();
  await expect(page.getByTestId("seven-total-bet")).toHaveText("₹20.00");
  await page.getByRole("button", { name: "Choose chip value" }).click();
  await page.getByRole("button", { name: "Select ₹100 chip", exact: true }).click();
  await page.getByRole("button", { name: "Clear bets" }).click();
  await page.getByRole("button", { name: "Multiple Mode" }).click();
  await page.getByTestId("seven-spot-down").click(); await page.getByTestId("seven-spot-up").click();
  await expect(page.getByTestId("seven-total-bet")).toHaveText("₹100.00");
  await expect(page.locator(".sud-spot.has-bet")).toHaveCount(1); expect(f.posts).toHaveLength(0);
});

test("spectator sees continuous dice, bot activity and new rounds without debits", async ({ page }) => {
  const f = await setup(page);
  await expect(page.getByLabel("Simulated players")).toContainText("SIMULATED");
  await expect(page.locator(".sud-bot-player")).toHaveCount(3);
  await expect(page.locator(".sud-bot-chip").first()).toBeVisible();
  for (let i = 0; i < 2; i++) {
    f.reveal(); await expect(page.getByTestId("dice-dome")).toHaveClass(/is-rolling/);
    await expect(page.getByTestId("seven-spot-up")).toBeDisabled();
    f.land(); f.settle(); await expect(page.getByTestId("collection-result")).toContainText("8 · 7 UP");
    f.next(); await expect(page.getByTestId("seven-spot-up")).toBeEnabled();
  }
  expect(f.posts).toHaveLength(0); expect(f.wallet).toBe(1000000n); expect(f.errors).toEqual([]);
});

test("confirmed slip settles all winning spots and repeat requires fresh confirmation", async ({ page }) => {
  const f = await setup(page);
  await page.getByTestId("seven-spot-up").click(); await page.getByTestId("seven-spot-8").click();
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("collection-play")).toContainText("Bet confirmed");
  await expect(page.getByTestId("seven-spot-up")).toBeDisabled(); expect(f.wallet).toBe(998000n);
  f.reveal(); await expect(page.getByTestId("dice-dome")).toHaveClass(/is-rolling/);
  await expect(page.locator(".is-winner")).toHaveCount(0);
  f.land(); f.settle();
  await expect(page.getByTestId("collection-result")).toContainText("₹39.60 · Returned to your wallet");
  await expect(page.getByTestId("collection-balance")).toHaveText("₹10,019.60");
  await expect(page.getByRole("img", { name: "Die 1: 5", exact: true })).toBeVisible();
  await page.screenshot({ path: "tmp/seven-up-down-result.png", fullPage: true });
  f.next(); await expect(page.getByTestId("seven-total-bet")).toHaveText("₹0.00");
  await page.getByRole("button", { name: "Repeat last bet" }).click();
  await expect(page.getByTestId("seven-total-bet")).toHaveText("₹20.00");
  expect(f.posts).toHaveLength(1); expect(f.wallet).toBe(1001960n); expect(f.errors).toEqual([]);
});

test("lost response and reload recover accepted bet without another debit", async ({ page }) => {
  const f = await setup(page, { drop: true });
  await page.getByTestId("seven-spot-up").click(); await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("collection-play")).toContainText("Bet confirmed");
  await page.reload(); await expect(page.getByTestId("collection-play")).toContainText("Bet confirmed");
  await expect(page.getByTestId("seven-total-bet")).toHaveText("₹10.00");
  expect(f.posts).toHaveLength(1); expect(f.wallet).toBe(999000n);
});

test("unconfirmed chips expire at next round and never auto-bet", async ({ page }) => {
  const f = await setup(page); await page.getByTestId("seven-spot-seven").click();
  f.reveal(); await expect(page.getByTestId("collection-play")).toBeDisabled();
  f.land([3, 4]); f.settle(); await expect(page.getByTestId("seven-spot-seven")).toHaveClass(/is-winner/);
  f.next(); await expect(page.getByTestId("seven-total-bet")).toHaveText("₹0.00");
  expect(f.posts).toHaveLength(0); expect(f.wallet).toBe(1000000n);
});

test("low balance prevents placement", async ({ page }) => {
  const f = await setup(page, { low: true }); await page.getByTestId("seven-spot-up").click();
  await expect(page.getByRole("alert")).toContainText("Insufficient");
  await expect(page.getByTestId("collection-play")).toBeDisabled(); expect(f.posts).toHaveLength(0);
});

test("disconnect locks table and reconnect resumes server clock", async ({ page }) => {
  const f = await setup(page); f.disconnect();
  await expect(page.getByRole("alert")).toContainText("Could not connect");
  await expect(page.getByTestId("seven-spot-up")).toBeDisabled();
  f.reconnect(); await expect(page.getByTestId("seven-spot-up")).toBeEnabled(); expect(f.posts).toHaveLength(0);
});

test("server rejection preserves editable chips", async ({ page }) => {
  await setup(page, { reject: true });
  await page.getByTestId("seven-spot-up").click(); await page.getByTestId("collection-play").click();
  await expect(page.getByRole("alert")).toContainText("Betting is closed");
  await expect(page.getByTestId("seven-spot-up")).toBeEnabled();
  await expect(page.getByTestId("seven-total-bet")).toHaveText("₹10.00");
});

test("desktop and narrow mobile preserve controls, rules, roadmap and sound", async ({ page }) => {
  const f = await setup(page);
  await page.screenshot({ path: "tmp/seven-up-down-desktop.png", fullPage: true });
  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.locator(".sud-dock").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(page.getByTestId("collection-play")).toBeVisible();
    await page.getByRole("button", { name: "Game rules", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Confirmed chips apply to this round only");
    await expect(page.getByRole("dialog")).toContainText("simulated entertainment");
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "tmp/seven-up-down-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Toggle roadmap" }).click();
  await expect(page.locator(".sud-roadmap")).toContainText("automatically");
  await page.getByRole("button", { name: "Close roadmap" }).click();
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mute sound", exact: true })).toBeVisible(); expect(f.errors).toEqual([]);
});

test("chip, stack, undo, clear, menus and confirmation have audible cues; mute silences actions", async ({ page }) => {
  await observeAudio(page); const f = await setup(page);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  const actions = [
    () => page.getByTestId("seven-spot-up").click(),
    () => page.getByRole("button", { name: "Double bets", exact: true }).click(),
    () => page.getByRole("button", { name: "Undo last chip" }).click(),
    () => page.getByRole("button", { name: "Clear bets" }).click(),
    () => page.getByRole("button", { name: "Choose chip value" }).click(),
    () => page.getByRole("button", { name: "Select ₹50 chip", exact: true }).click(),
    () => page.getByRole("button", { name: "Game rules", exact: true }).click(),
    () => page.keyboard.press("Escape"),
    () => page.getByRole("button", { name: "Toggle roadmap" }).click(),
    () => page.getByRole("button", { name: "Close roadmap" }).click(),
  ];
  for (const action of actions) {
    const before = await audioCount(page); await action();
    await expect.poll(() => audioCount(page)).toBeGreaterThan(before);
  }
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  const muted = await audioCount(page); await page.getByTestId("seven-spot-up").click();
  await page.waitForTimeout(300); expect(await audioCount(page)).toBe(muted);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await page.getByTestId("collection-play").click();
  await expect.poll(() => cueCount(page, "confirm")).toBe(1);
  expect(f.posts).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).sevenAudio.every((e: any) => e.peak > .001))).toBe(true);
  expect(f.errors).toEqual([]);
});

test("round sounds follow countdown, dice landing and settled payout once, including reconnect", async ({ page }) => {
  await observeAudio(page); const f = await setup(page);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await page.getByTestId("seven-spot-up").click(); await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("collection-play")).toContainText("Bet confirmed");
  const beforeTicks = await cueCount(page, "tick");
  f.countdown(3);
  await expect.poll(() => cueCount(page, "lastTick")).toBe(1);
  expect(await cueCount(page, "tick") - beforeTicks).toBe(2);
  f.reveal();
  await expect.poll(() => page.evaluate(() => (window as any).sevenAudio.filter((e: any) => e.loop && !e.ended).length)).toBe(1);
  await expect.poll(() => cueCount(page, "lock")).toBe(1);
  f.land();
  await expect.poll(() => cueCount(page, .22)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).sevenAudio.filter((e: any) => e.loop && !e.ended).length)).toBe(0);
  expect(await cueCount(page, "win")).toBe(0);
  f.settle(); await expect.poll(() => cueCount(page, "win")).toBe(1);
  f.disconnect(); await expect(page.getByRole("alert")).toBeVisible();
  f.reconnect(); await expect(page.getByRole("alert")).toHaveCount(0);
  await page.waitForTimeout(900); expect(await cueCount(page, "win")).toBe(1);
  f.next(); await expect.poll(() => cueCount(page, "roundOpen")).toBe(1);
  await page.getByRole("button", { name: "Repeat last bet" }).click();
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("collection-play")).toContainText("Bet confirmed");
  f.reveal(); await expect(page.getByTestId("dice-dome")).toHaveClass(/is-rolling/);
  f.land([3, 4]); f.settle(); await expect.poll(() => cueCount(page, .44)).toBe(1);
  expect(await cueCount(page, "win")).toBe(1); expect(f.errors).toEqual([]);
});

test("muting and hiding stop dice audio immediately; failed chip placement only plays error", async ({ page }) => {
  await observeAudio(page); const f = await setup(page, { low: true });
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await page.getByTestId("seven-spot-up").click(); await expect.poll(() => cueCount(page, .22)).toBe(1);
  await expect(page.getByTestId("seven-total-bet")).toHaveText("₹0.00");
  f.reveal();
  const loops = () => page.evaluate(() => (window as any).sevenAudio.filter((e: any) => e.loop && !e.ended).length);
  await expect.poll(loops).toBe(1);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click(); await expect.poll(loops).toBe(0);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click(); await expect.poll(loops).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(loops).toBe(0);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(loops).toBe(1);
  f.land(); f.settle(); await expect.poll(loops).toBe(0);
  expect(await cueCount(page, "win")).toBe(0); expect(await cueCount(page, .44)).toBe(0); expect(f.posts).toHaveLength(0);
});
