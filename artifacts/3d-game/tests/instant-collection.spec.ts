import { test, expect, type Page } from "@playwright/test";
import { collectionGame, collectionMultiplier, collectionPayout, INSTANT_COLLECTION, REQUESTED_INSTANT_CODES, progressive, type CollectionRound } from "@workspace/api-zod/instant-collection";
async function setup(page: Page, code: string, options: { drop?: boolean; lose?: boolean; low?: boolean; offline?: boolean; audio?: boolean; music?: boolean; delay?: number; cap?: number } = {}) {
  let balance = options.low ? 0n : 1000000n, round: CollectionRound | null = null, dropped = false;
  const posts: { path: string; input: any }[] = [], errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(settings => localStorage.setItem("aviator:v1", JSON.stringify({ musicOnByDefaultMigrated: true, settings: { onboarded: true, ...settings } })), { sound: !!options.audio, music: !!options.music });
  await page.routeWebSocket("**/ws", ws => ws.onMessage(() => {}));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname; let body: unknown = {};
    if (path === "/api/auth/me") body = { id: "instant-test", displayName: "Player", email: "instant@example.test", role: "player" };
    else if (path === "/api/wallet/balance") body = { balance: balance.toString(), currency: "INR", scope: "lunar", walletId: "shared" };
    else if (path === "/api/wallet/balances") body = { balances: { lunar: balance.toString() } };
    else if (path === "/api/game/registry") body = INSTANT_COLLECTION.map(g => ({ gameCode: g.code, title: g.name, route: `/${g.code}`, enabled: true }));
    else if (path.startsWith("/api/instant/")) {
      if (options.offline) return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
      const game = collectionGame(path.split("/")[3])!;
      if (path.endsWith("/config")) body = { enabled: true, minStakePaise: "100", maxStakePaise: "1000000", rtp: .97, maxMultiplier: options.cap ?? 1000 };
      else if (path.endsWith("/state")) body = { round: round?.status === "active" ? round : null, history: round ? [round] : [] };
      else if (route.request().method() === "POST") {
        const input = route.request().postDataJSON(); posts.push({ path, input });
        if (path.endsWith("/place")) {
          if (round?.requestId !== input.requestId) {
            balance -= BigInt(input.stakeAmount);
            round = { id: "instant-round", gameCode: game.code, requestId: input.requestId, status: progressive(game.kind) ? "active" : options.lose ? "lost" : "won", stakeAmount: input.stakeAmount, payoutAmount: "0", cashoutAmount: input.stakeAmount, multiplier: progressive(game.kind) ? 1 : game.kind === "dice" ? 2.32 : game.kind === "fishing" ? 6 : 1.94, step: 0, options: input.options, revealed: [], hazards: null, outcome: game.kind === "dice" ? [5, 3] : game.kind === "fishing" ? [4] : [0], serverSeedHash: "committed-hash", serverSeed: progressive(game.kind) ? null : "revealed-seed", clientSeed: input.clientSeed, createdAt: new Date().toISOString(), rtp: .97, maxMultiplier: 1000 };
            if (game.kind === "coin") {
              round.outcome = [(input.options.choice === "tails" ? 1 : 0) ^ Number(!!options.lose)];
              round.multiplier = options.lose ? 0 : Math.min(options.cap ?? 1000, round.multiplier);
            }
            if (round.status === "won") { round.payoutAmount = collectionPayout(BigInt(round.stakeAmount), round.multiplier).toString(); balance += BigInt(round.payoutAmount); }
          }
          if (options.drop && !dropped) { dropped = true; return route.abort("connectionreset"); }
        } else if (round && round.status === "active") {
          if (input.action === "reveal") {
            round.revealed.push(input.cell);
            if (options.lose) { round.status = "lost"; round.serverSeed = "revealed-seed"; round.hazards = [input.cell]; }
            else { round.step++; round.multiplier = collectionMultiplier(game.kind, round.step, round.options); round.cashoutAmount = collectionPayout(BigInt(round.stakeAmount), round.multiplier).toString(); }
          } else { round.status = "cashed_out"; round.payoutAmount = round.cashoutAmount; round.serverSeed = "revealed-seed"; balance += BigInt(round.payoutAmount); }
        }
        body = round;
        if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
      }
    } else if (path.includes("/config/")) body = { enabled: true, houseEdge: .03, maxMultiplier: 1000 };
    else if (path.includes("banners") || path.includes("coin-packs") || path.includes("upi-accounts")) body = [];
    else if (path.includes("transactions") || path.includes("/bets")) body = { entries: [], nextCursor: null };
    await route.fulfill({ json: body });
  });
  await page.goto(code === "lobby" ? "/" : `/${code}`);
  return { posts, errors, get balance() { return balance; } };
}

test("removed Chicken Road 2.0 links return to the lobby without a new bet", async ({ page }) => {
  const f = await setup(page, "chicken-road-2");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('a[href="/chicken-road-2"]')).toHaveCount(0);
  await expect(page.getByTestId("collection-play")).toHaveCount(0);
  await page.goto("/chicken-road-2.0");
  await expect(page).toHaveURL(/\/$/);
  expect(f.posts).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("removed Chicken Road 2.0 recovers an old round after a lost cash-out reply", async ({ page }) => {
  const f = await setup(page, "lobby");
  let settled = false;
  const requests: any[] = [];
  await page.route("**/api/instant/chicken-road-2/**", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); requests.push(body);
      expect(body.action).toBe("cashout");
      expect(body.expectedStep).toBe(3);
      settled = true;
      return route.abort("connectionreset");
    }
    return route.fulfill({ json: { round: settled ? null : { id: "old-round", gameCode: "chicken-road-2", status: "active", step: 3, cashoutAmount: "15700" }, history: [] } });
  });
  await page.goto("/chicken-road-2");
  await expect(page.getByRole("heading", { name: "Chicken Road 2.0 has been removed" })).toBeVisible();
  await expect(page.getByTestId("collection-play")).toHaveCount(0);
  await page.getByRole("button", { name: "Cash out ₹157.00", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(requests).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

for (const game of INSTANT_COLLECTION.filter(game => game.kind !== "dice" && game.kind !== "coin")) test(`${game.name}: play, settle, recover, responsive`, async ({ page }) => {
  const f = await setup(page, game.code);
  if (game.kind === "dice") await page.getByRole("button", { name: "Bet on 7 Up", exact: true }).click();
  await expect(page.getByTestId("collection-play")).toBeEnabled();
  await page.getByTestId("collection-play").click();
  if (progressive(game.kind)) {
    await expect(page.getByTestId("collection-cashout")).toBeEnabled();
    await page.reload();
    await expect(page.getByTestId("collection-cashout")).toBeEnabled();
    if (game.kind === "road") await page.getByRole("button", { name: "Cross lane 1", exact: true }).first().click();
    if (game.kind === "mines") await page.getByRole("button", { name: "Tile 1", exact: true }).click();
    if (game.kind === "tower") await page.getByRole("button", { name: "Floor 1 door 1", exact: true }).click();
    await expect(page.getByTestId("collection-cashout")).toContainText("Cash out");
    await page.getByTestId("collection-cashout").click();
  }
  await expect(page.getByTestId("collection-result")).toContainText("Returned to your wallet");
  await expect(page.getByTestId("collection-play")).toBeEnabled();
  expect(f.balance).toBeGreaterThan(1000000n);
  await page.getByRole("button", { name: "Game rules", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("total returns including your stake");
  await page.keyboard.press("Escape");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.getByTestId("collection-play")).toBeVisible();
  }
  if (["coin-flip", "pirate-jackpot-mines", "tower-rush", "chicken-road-pirate"].includes(game.code)) await page.screenshot({ path: `tmp/instant-${game.code}-mobile.png`, fullPage: true });
  expect(f.errors).toEqual([]);
});
test("pirate controls use wallet limits and keep difficulty locked during a round", async ({ page }) => {
  const f = await setup(page, "chicken-road-pirate");
  await expect(page.getByTestId("collection-play")).toBeEnabled();
  const stake = page.getByRole("textbox", { name: "Bet amount", exact: true });
  await page.getByRole("button", { name: "Minimum bet", exact: true }).click();
  await expect(stake).toHaveValue("1.00");
  await page.getByRole("button", { name: "Add 20 rupees", exact: true }).click();
  await expect(stake).toHaveValue("21.00");
  await page.getByRole("button", { name: "Maximum bet", exact: true }).click();
  await expect(stake).toHaveValue("10000.00");
  await stake.fill("100.50");
  await page.getByRole("button", { name: "Hard", exact: true }).click();
  await expect(page.locator(".pr-token").first()).toContainText("1.76");
  await page.screenshot({ path: "tmp/pirate-ui/desktop.png", fullPage: true });
  await page.getByTestId("collection-play").click();
  expect(f.posts[0].input.stakeAmount).toBe("10050");
  expect(f.posts[0].input.options.difficulty).toBe("hard");
  await expect(stake).toBeDisabled();
  await expect(page.getByRole("button", { name: "Easy", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add 20 rupees", exact: true })).toBeDisabled();
  await page.getByTestId("collection-cashout").click();
  await expect(page.getByTestId("collection-result")).toContainText("Returned to your wallet");
  expect(f.balance).toBe(1000000n);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 700 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await expect(page.getByTestId("collection-play")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `tmp/pirate-ui/responsive-${size.width}.png`, fullPage: true });
  }
  expect(f.errors).toEqual([]);
});

test("pirate crossing follows later platforms on mobile and restores the character", async ({ page }) => {
  const f = await setup(page, "chicken-road-pirate");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("collection-play").click();
  for (let lane = 1; lane <= 6; lane++) {
    await page.locator(".pr-actions .pr-play").click();
    await expect(page.getByTestId("pirate-character")).toHaveAttribute("data-step", String(lane));
  }
  await page.reload();
  await expect(page.getByTestId("pirate-character")).toHaveAttribute("data-step", "6");
  await expect.poll(() => page.locator(".pr-crossing").evaluate(e => e.scrollLeft)).toBeGreaterThan(500);
  const chicken = await page.getByTestId("pirate-character").boundingBox();
  expect(chicken!.x).toBeGreaterThan(0);
  expect(chicken!.x + chicken!.width).toBeLessThan(390);
  await page.screenshot({ path: "tmp/pirate-ui/mobile-active.png", fullPage: true });
  await page.getByRole("button", { name: "Game rules", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("collection-cashout").click();
  expect(f.balance).toBeGreaterThan(1000000n);
  expect(f.errors).toEqual([]);
});

test("pirate loss shows a broken platform and can start a fresh crossing", async ({ page }) => {
  const f = await setup(page, "chicken-road-pirate", { lose: true });
  await page.getByTestId("collection-play").click();
  await page.locator(".pr-actions .pr-play").click();
  await expect(page.getByTestId("collection-result")).toContainText("Round over");
  await expect(page.locator(".pr-lane.is-failed")).toHaveCount(1);
  await expect(page.locator(".pr-lane.is-safe")).toHaveCount(0);
  await expect(page.getByTestId("collection-cashout")).toHaveCount(0);
  expect(f.balance).toBe(990000n);
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("pirate-character")).toHaveAttribute("data-step", "0");
  await expect(page.locator(".pr-lane.is-failed")).toHaveCount(0);
  await page.getByTestId("collection-cashout").click();
  expect(f.balance).toBe(990000n);
  expect(f.errors).toEqual([]);
});

test("pirate idle scene animates the chicken, water and boat before betting", async ({ page }) => {
  const f = await setup(page, "chicken-road-pirate");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.getByTestId("collection-play")).toBeEnabled();
  await expect.poll(() => page.locator(".pr-ship img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const water = page.locator(".pr-water");
  await expect(water).toBeVisible();
  await expect.poll(() => water.evaluate((c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(c.width - 10, c.height - 10, 1, 1).data[3])).toBeGreaterThan(0);
  const frame = await water.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const bird = await page.locator(".pr-character-idle").evaluate(e => getComputedStyle(e).transform);
  const ship = await page.locator(".pr-ship img").evaluate(e => getComputedStyle(e).transform);
  await expect.poll(() => page.locator(".pr-character-idle").evaluate(e => getComputedStyle(e).transform)).not.toBe(bird);
  await expect.poll(() => page.locator(".pr-ship img").evaluate(e => getComputedStyle(e).transform)).not.toBe(ship);
  await expect.poll(() => water.evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(frame);
  expect(f.posts).toHaveLength(0);
  await expect(page.getByTestId("pirate-character")).toHaveAttribute("data-step", "0");
  await page.screenshot({ path: "tmp/pirate-ui/motion-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => water.evaluate((c: HTMLCanvasElement) => c.width)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "tmp/pirate-ui/motion-mobile.png", fullPage: true });
  await page.getByTestId("collection-play").click();
  await page.locator(".pr-actions .pr-play").click();
  await expect(page.getByTestId("pirate-character")).toHaveAttribute("data-step", "1");
  await page.getByTestId("collection-cashout").click();
  await expect(page.getByTestId("collection-result")).toContainText("Returned to your wallet");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(water).toHaveCount(0);
  await expect(page.locator(".pr-character-idle")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".pr-ship img")).toHaveCSS("animation-name", "none");
  expect(f.errors).toEqual([]);
});

test("pirate full screen keeps rules and history accessible", async ({ page }) => {
  const f = await setup(page, "chicken-road-pirate");
  await page.getByRole("button", { name: "Enter full screen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toBe("pr-page");
  await page.getByRole("button", { name: "Game rules", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.getByRole("dialog").evaluate(e => document.fullscreenElement?.contains(e))).toBe(true);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Exit full screen", exact: true }).click();
  await page.getByRole("button", { name: "Recent rounds", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("No rounds yet");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mute sound", exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("all 10 games appear under Instant Games with correct routes", async ({ page }) => {
  const f = await setup(page, "lobby");
  await page.getByRole("button", { name: "Instant Games", exact: true }).first().click();
  for (const code of REQUESTED_INSTANT_CODES) await expect(page.getByTestId(`card-game-${code}`)).toBeVisible();
  await expect(page.getByTestId("card-game-roulette")).toHaveCount(0);
  await page.screenshot({ path: "tmp/instant-lobby-desktop.png", fullPage: true });
  expect(f.errors).toEqual([]);
});
test("lost response retries the same request without a second debit", async ({ page }) => {
  const f = await setup(page, "duck-duel", { drop: true });
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("collection-play")).toHaveText(/Retry pending bet/);
  await page.reload();
  await expect(page.getByTestId("collection-play")).toHaveText(/Retry pending bet/);
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("collection-play")).toHaveText(/Let.s play/);
  expect(f.posts).toHaveLength(2); expect(f.posts[0].input).toEqual(f.posts[1].input);
  expect(f.balance).toBe(1009400n);
});
test("zero-step refund returns the original stake", async ({ page }) => {
  const f = await setup(page, "pirate-jackpot-mines", { lose: true });
  await page.getByTestId("collection-play").click();
  await page.getByTestId("collection-cashout").click();
  await expect(page.getByTestId("collection-result")).toContainText("100.00");
  expect(f.balance).toBe(1000000n);
});
test("invalid stakes and insufficient balance cannot place a bet", async ({ page }) => {
  const f = await setup(page, "duck-duel", { low: true });
  await expect(page.getByTestId("collection-play")).toBeDisabled();
  await page.getByLabel("Bet amount", { exact: true }).fill("-10");
  await expect(page.getByTestId("collection-play")).toBeDisabled();
  expect(f.posts).toHaveLength(0);
});
test("hitting a mine loses only the stake and reveals the board", async ({ page }) => {
  const f = await setup(page, "pirate-jackpot-mines", { lose: true });
  await page.getByTestId("collection-play").click();
  await page.getByRole("button", { name: "Tile 1", exact: true }).click();
  await expect(page.getByTestId("collection-result")).toContainText("Round over");
  await expect(page.getByRole("button", { name: "Tile 1, cannon", exact: true })).toBeDisabled();
  expect(f.balance).toBe(990000n);
  await expect(page.getByTestId("collection-cashout")).toHaveCount(0);
});
test("unavailable API prevents play and mobile rules remain accessible", async ({ page }) => {
  const f = await setup(page, "duck-duel", { offline: true });
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.getByTestId("collection-play")).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Could not connect");
  await page.getByRole("button", { name: "Read game rules", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(f.posts).toHaveLength(0);
});
test("Runway video assets decode and respect reduced motion", async ({ page }) => {
  await setup(page, "pirate-jackpot-mines");
  await expect(page.locator(".ic-video")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const video = page.locator(".ic-video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((v: HTMLVideoElement) => ({ muted: v.muted, width: v.videoWidth, loop: v.loop }))).toEqual({ muted: true, width: 1280, loop: true });
  await page.screenshot({ path: "tmp/instant-pirate-desktop.png", fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(video).toHaveCount(0);
});

async function recordPirateAudio(page: Page) {
  await page.addInitScript(() => {
    (window as any).pirateAudioEvents = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      const entry = { duration: this.buffer?.duration, loop: this.loop, ended: false };
      (window as any).pirateAudioEvents.push(entry);
      this.addEventListener("ended", () => { entry.ended = true; });
      return start.apply(this, args);
    };
  });
}
const pirateEvents = (page: Page) => page.evaluate(() => (window as any).pirateAudioEvents as { duration: number; loop: boolean; ended: boolean }[]);

test("pirate entry offers an audio tap and starts music without placing a bet", async ({ page }) => {
  // Model an autoplay-blocked device, then let a trusted tap resume the real context.
  await page.addInitScript(() => {
    const NativeContext = AudioContext;
    let interacted = false;
    window.addEventListener("pointerdown", event => { if (event.isTrusted) interacted = true; }, true);
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        Object.defineProperty(this, "state", { configurable: true, value: "suspended" });
      }
      override async resume() {
        if (!interacted) return;
        await super.resume();
        Object.defineProperty(this, "state", { configurable: true, value: "running" });
        this.dispatchEvent(new Event("statechange"));
      }
    };
  });
  await recordPirateAudio(page);
  const f = await setup(page, "chicken-road-pirate", { audio: true, music: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const prompt = page.getByTestId("pirate-audio-prompt");
  await expect(prompt).toHaveText("Tap to enable audio");
  expect(await pirateEvents(page)).toEqual([]);
  await prompt.click();
  await expect(prompt).toHaveCount(0);
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.loop && !e.ended).length).toBe(1);
  expect(f.posts).toHaveLength(0);
  await page.getByRole("button", { name: "Game rules", exact: true }).click();
  await page.keyboard.press("Escape");
  expect((await pirateEvents(page)).filter(e => e.loop && !e.ended)).toHaveLength(1);
  await page.getByRole("link", { name: "Back to lobby", exact: true }).click();
  await expect.poll(async () => (await pirateEvents(page)).every(e => e.ended)).toBe(true);
  expect(f.errors).toEqual([]);
});

test("pirate navigation starts already-unlocked music on entry", async ({ page }) => {
  await recordPirateAudio(page);
  const f = await setup(page, "duck-duel", { audio: true, music: true });
  await page.getByRole("button", { name: "Game rules", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    history.pushState(null, "", "/chicken-road-pirate");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("heading", { name: "Chicken Road Pirate Edition" })).toBeVisible();
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.loop && !e.ended).length).toBe(1);
  await expect(page.getByTestId("pirate-audio-prompt")).toHaveCount(0);
  expect(f.posts).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test("pirate opening respects saved mute and allows sound before play", async ({ page }) => {
  await recordPirateAudio(page);
  const f = await setup(page, "chicken-road-pirate", { audio: false, music: true });
  await expect(page.getByTestId("pirate-audio-prompt")).toHaveText("Turn on sound");
  await page.getByRole("button", { name: "Game rules", exact: true }).click();
  await page.keyboard.press("Escape");
  expect(await pirateEvents(page)).toEqual([]);
  await page.getByTestId("pirate-audio-prompt").click();
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.loop && !e.ended).length).toBe(1);
  await page.getByRole("button", { name: "Mute music", exact: true }).click();
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.loop && !e.ended).length).toBe(0);
  await page.getByRole("button", { name: "Enable music", exact: true }).click();
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.loop && !e.ended).length).toBe(1);
  expect(f.posts).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test("pirate sounds follow controls, accepted hops, cashout and independent music mute", async ({ page }) => {
  await recordPirateAudio(page);
  const f = await setup(page, "chicken-road-pirate", { audio: true, music: true });
  await expect(page.getByTestId("collection-play")).toBeEnabled();
  expect((await pirateEvents(page)).filter(e => !e.loop)).toEqual([]);
  await page.getByRole("button", { name: "Add 20 rupees", exact: true }).click();
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.duration === .12).length).toBe(1);
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.loop && !e.ended).length).toBe(1);
  expect(f.posts).toHaveLength(0);
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("collection-cashout")).toBeEnabled();
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.duration === .68).length).toBe(1);
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.loop && !e.ended).length).toBe(1);
  await page.getByRole("button", { name: "Cross lane 1", exact: true }).first().click();
  await expect(page.getByTestId("pirate-character")).toHaveAttribute("data-step", "1");
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.duration === .62).length).toBe(1);
  await page.getByTestId("collection-cashout").click();
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.duration === 1.65).length).toBe(1);
  await page.getByRole("button", { name: "Mute music", exact: true }).click();
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.loop && !e.ended).length).toBe(0);
  await expect(page.getByRole("button", { name: "Mute sound", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("aviator:v1")!).settings.music)).toBe(false);
  await page.getByRole("button", { name: "Enable music", exact: true }).click();
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.loop && !e.ended).length).toBe(1);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await expect.poll(async () => (await pirateEvents(page)).every(e => e.ended)).toBe(true);
  const count = (await pirateEvents(page)).length;
  await page.getByRole("button", { name: "Add 20 rupees", exact: true }).click();
  expect((await pirateEvents(page)).length).toBe(count);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.loop && !e.ended).length).toBe(1);
  await page.getByRole("link", { name: "Back to lobby", exact: true }).click();
  await expect.poll(async () => (await pirateEvents(page)).every(e => e.ended)).toBe(true);
  expect(f.errors).toEqual([]);
});

test("pirate failed hops splash once, refunds stay neutral and reload does not replay results", async ({ page }) => {
  await recordPirateAudio(page);
  const f = await setup(page, "chicken-road-pirate", { audio: true, lose: true });
  await page.getByTestId("collection-play").click();
  await page.getByRole("button", { name: "Cross lane 1", exact: true }).first().click();
  await expect(page.getByTestId("collection-result")).toContainText("Round over");
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.duration === 1.15).length).toBe(1);
  expect((await pirateEvents(page)).some(e => e.duration === .62 || e.duration === 1.65 || e.loop)).toBe(false);
  await page.reload();
  await expect(page.getByTestId("collection-result")).toContainText("Round over");
  expect(await pirateEvents(page)).toEqual([]);
  await page.getByTestId("collection-play").click();
  await page.getByTestId("collection-cashout").click();
  await expect.poll(async () => (await pirateEvents(page)).filter(e => e.duration === .4).length).toBe(1);
  expect((await pirateEvents(page)).some(e => e.duration === 1.65)).toBe(false);
  expect(f.errors).toEqual([]);
});

test("pirate pending responses stay silent after mute and after leaving the game", async ({ page }) => {
  await recordPirateAudio(page);
  const f = await setup(page, "chicken-road-pirate", { audio: true, music: true });
  await page.route("**/api/instant/chicken-road-pirate/place", async route => { await new Promise(resolve => setTimeout(resolve, 700)); await route.fallback(); });
  await page.getByTestId("collection-play").click();
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await expect(page.getByTestId("collection-cashout")).toBeEnabled();
  expect((await pirateEvents(page)).every(e => e.duration === .12 || e.loop)).toBe(true);
  await expect.poll(async () => (await pirateEvents(page)).every(e => e.ended)).toBe(true);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await page.route("**/api/instant/chicken-road-pirate/*/move", async route => { await new Promise(resolve => setTimeout(resolve, 700)); await route.fallback(); });
  await page.getByRole("button", { name: "Cross lane 1", exact: true }).first().click();
  await page.getByRole("link", { name: "Back to lobby", exact: true }).click();
  await expect.poll(() => f.posts.length).toBe(2);
  expect((await pirateEvents(page)).some(e => e.duration === .62)).toBe(false);
  await expect.poll(async () => (await pirateEvents(page)).every(e => e.ended)).toBe(true);
  expect(f.errors).toEqual([]);
});
