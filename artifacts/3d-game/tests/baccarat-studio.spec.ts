import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
const review = (name: string) =>
  path.resolve(import.meta.dirname, "../../../tmp/baccarat-reference", name);
import {
  bigRoadCells,
  type RoadEntry,
} from "../src/components/baccarat/roadLayout";
import {
  handTotal,
  orderedCards,
  presentedCount,
  studioCue,
  TAKES,
  visibleHand,
  type StudioDeal,
} from "../src/components/baccarat/studioTimeline";

const six: StudioDeal = {
  playerCards: [1, 14, 5],
  bankerCards: [0, 13, 6],
  playerTotal: 0,
  bankerTotal: 9,
  winner: "banker",
  playerPair: true,
  bankerPair: true,
  natural: false,
};
const natural: StudioDeal = {
  playerCards: [3, 17],
  bankerCards: [9, 12],
  playerTotal: 9,
  bankerTotal: 0,
  winner: "player",
  playerPair: false,
  bankerPair: false,
  natural: true,
};

test("tableau branches reveal in physical order and never show totals early", () => {
  for (const deal of [
    natural,
    six,
    { ...six, playerCards: [2, 3] },
    { ...six, bankerCards: [2, 3] },
  ]) {
    const cards = orderedCards(deal);
    expect(cards.slice(0, 4).map((c) => c.side)).toEqual([
      "player",
      "banker",
      "player",
      "banker",
    ]);
    let elapsed = 0;
    cards.forEach((card, i) => {
      const t = TAKES[card.take],
        cue = studioCue("reveal", elapsed + 1, 12000, deal);
      expect(cue.index).toBe(i);
      expect(presentedCount(cue, t.release - 0.01)).toBe(i);
      expect(presentedCount(cue, t.release + 0.01)).toBe(i + 1);
      expect(visibleHand(deal, i, card.side).length).toBeLessThanOrEqual(
        card.index,
      );
      elapsed += (t.end - t.start) * 1000;
    });
    expect(studioCue("reveal", 11999, 12000, deal).completed).toBe(
      cards.length,
    );
    expect(studioCue("settling", 0, 12000, deal).completed).toBe(cards.length);
    expect(studioCue("betting", 1000, 12000, deal).completed).toBe(0);
  }
  expect(handTotal(six.playerCards)).toBe(0);
  expect(handTotal(six.bankerCards)).toBe(9);
});

test("Big Road retains long streak tails, collisions and leading ties", () => {
  const e = (winner: RoadEntry["winner"]): RoadEntry => ({
    winner,
    playerPair: false,
    bankerPair: false,
  });
  const cells = bigRoadCells([
    e("tie"),
    ...Array.from({ length: 10 }, () => e("player")),
    e("tie"),
    ...Array.from({ length: 8 }, () => e("banker")),
    e("player"),
  ]);
  expect(cells).toHaveLength(19);
  expect(new Set(cells.map((c) => `${c.col}:${c.row}`)).size).toBe(19);
  expect(cells[0].ties).toBe(1);
  expect(cells[9].ties).toBe(1);
  expect(cells[9]).toMatchObject({ col: 4, row: 5 });
  expect(cells.every((c) => c.row < 6)).toBe(true);
});

async function setup(page: Page, wallet = 50000000) {
  let phase = "betting",
    deadline = 0,
    outcome: StudioDeal | null = null,
    round = 1;
  const posts: any[] = [],
    errors: string[] = [],
    myBets: any[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => socket.close());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me")
      body = {
        id: "baccarat-studio-user",
        displayName: "Studio player",
        email: "studio@example.test",
        role: "player",
      };
    else if (path === "/api/wallet/balance")
      body = {
        walletId: "shared",
        balance: String(wallet),
        currency: "INR",
        scope: "lunar",
      };
    else if (path === "/api/baccarat/config")
      body = {
        enabled: true,
        decks: 8,
        maxMultiplier: 12,
        maxStakePaise: "50000000",
        maxBetsPerDeal: 5,
        payouts: {
          player: 1.8,
          banker: 1.75,
          tie: 8.56,
          playerPair: 10.91,
          bankerPair: 10.91,
        },
      };
    else if (path === "/api/baccarat/recent") body = [];
    else if (path === "/api/baccarat/round") {
      // Start the fixture's betting window when the app connects, so cold Vite
      // compilation cannot expire the round before its first response.
      if (!deadline) deadline = Date.now() + 30000;
      body = {
        roundId: `studio-${round}`,
        gameCode: "baccarat",
        phase,
        now: Date.now(),
        bettingEndsAt: deadline,
        revealEndsAt: deadline + 12000,
        settleEndsAt: deadline + 18000,
        outcome,
        myBets,
        liveBets: [],
        recent: Array.from({ length: 43 }, (_, i) => ({
          roundId: `past-${i}`,
          outcome: {
            ...natural,
            winner: i % 9 === 0 ? "tie" : i % 5 < 2 ? "player" : "banker",
          },
          settledAt: new Date().toISOString(),
        })),
        serverSeedHash: "test-seed-commitment",
        clientSeed: "test-client",
        nonce: round,
        serverSeed: phase === "betting" ? null : "test-seed",
        playerCount: 8,
        totalStake: "175000",
        config: {
          bettingWindowMs: 30000,
          revealDurationMs: 12000,
          settleDurationMs: 6000,
          minStakePaise: "10000",
          maxStakePaise: "50000000",
        },
      };
    } else if (path === "/api/baccarat/deal") {
      const payload = route.request().postDataJSON();
      posts.push(payload);
      const stake = payload.bets.reduce(
        (sum: number, b: any) => sum + Number(b.amountPaise),
        0,
      );
      wallet -= stake;
      myBets.push({
        slipId: `slip-${posts.length}`,
        bets: payload.bets,
        totalStake: String(stake),
        payoutAmount: "0",
        status: "pending",
        auditRoundId: null,
      });
      body = { slipId: myBets.at(-1).slipId };
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/baccarat", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("spot-player")).toBeEnabled();
  const refresh = () => page.evaluate(() => (window as any).refreshBaccarat());
  return {
    posts,
    errors,
    async reveal(deal = six, elapsed = 0) {
      phase = "reveal";
      deadline = Date.now() - elapsed;
      outcome = deal;
      await refresh();
    },
    async closeSoon(remaining = 2200) {
      deadline = Date.now() + remaining;
      await refresh();
    },
    async next() {
      round++;
      phase = "betting";
      deadline = Date.now() + 30000;
      outcome = null;
      myBets.length = 0;
      await refresh();
    },
  };
}

test("native dealer renders, all six cards and totals synchronize, and the next round clears", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const state = await setup(page);
  await expect(page.locator(".bc-studio canvas")).toHaveAttribute(
    "data-paints",
    /[1-9]/,
  );
  await page.screenshot({
    path: review("desktop-betting.png"),
  });
  await state.reveal();
  await expect(page.getByTestId("spot-player")).toBeDisabled();
  await expect(page.locator(".bc-studio canvas")).toHaveAttribute(
    "data-dealt",
    "1",
  );
  await expect(page.getByTestId("text-player-total")).toHaveText("2");
  await expect(page.getByTestId("text-result-winner")).not.toContainText(
    "wins",
  );
  await expect(page.locator(".bc-studio canvas")).toHaveAttribute(
    "data-dealt",
    "6",
  );
  await expect(page.getByTestId("text-player-total")).toHaveText("0");
  await expect(page.getByTestId("text-banker-total")).toHaveText("9");
  await expect(page.getByTestId("text-result-winner")).toHaveText(
    "Banker wins",
  );
  await page.screenshot({
    path: review("desktop-result.png"),
  });
  await state.next();
  await expect(page.getByTestId("text-player-total")).toHaveText("–");
  await expect(page.getByTestId("spot-player")).toBeEnabled();
  expect(state.errors).toEqual([]);
});

test("chip editing, one automatic submission, accepted stacks and repeat bets", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByTestId("spot-player").click();
  await page.getByTestId("spot-banker").click();
  await expect(page.getByTestId("text-total-staked")).toContainText("200");
  await page.getByTestId("btn-undo").click();
  await expect(page.getByTestId("text-total-staked")).toContainText("100");
  await page.getByTestId("btn-double").click();
  await expect(page.getByTestId("text-total-staked")).toContainText("200");
  await state.closeSoon();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0]).toEqual({
    roundId: "studio-1",
    bets: [{ type: "player", amountPaise: "20000" }],
  });
  await expect(page.getByTestId("placed-summary")).toContainText("200");
  await expect(page.getByTestId("chipstack-player")).toBeVisible();
  await state.next();
  await page.getByTestId("btn-rebet").click();
  await expect(page.getByTestId("text-total-staked")).toContainText("200");
  await page.getByTestId("btn-clear").click();
  await expect(page.getByTestId("text-total-staked")).toHaveText("Selected ₹0");
  expect(state.errors).toEqual([]);
});

test("wallet limits prevent an unaffordable draft", async ({ page }) => {
  const state = await setup(page, 15000);
  await page.getByTestId("spot-player").click();
  await page.getByTestId("spot-player").click();
  await expect(page.getByTestId("text-total-staked")).toHaveText(
    "Selected ₹100",
  );
  await page.getByTestId("btn-double").click();
  await expect(page.getByTestId("text-total-staked")).toHaveText(
    "Selected ₹100",
  );
  expect(state.posts).toHaveLength(0);
});

test("phone layout, natural outcome on a late join and safe video failure", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/clean-table.png", (route) => route.abort());
  const state = await setup(page);
  await expect(
    page.getByText(
      "Dealer video unavailable. Cards and game remain connected.",
    ),
  ).toBeVisible();
  await state.reveal(natural, 9000);
  await expect(page.getByTestId("text-result-winner")).toHaveText(
    "Player wins",
  );
  await expect(page.getByTestId("text-player-total")).toHaveText("9");
  await expect(page.locator(".bc-mini-card")).toHaveCount(4);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(state.errors).toEqual([]);
});

test("screen sizes keep the table, bets and coins together with the app styles loaded", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page);
  await expect(page.locator(".bc-studio canvas")).toHaveAttribute(
    "data-paints",
    /[1-9]/,
  );
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
    [1024, 600],
    [768, 1024],
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await state.next();
    const layout = await page.evaluate(() => {
      const box = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect();
      const board = box(".bc-betting-board"),
        stage = box(".bc-stage");
      const player = box(".bc-spot-player"),
        pair = box(".bc-spot-playerPair");
      const coins = box(".bc-coins"),
        actions = box(".bc-actions");
      const coinButtons = [
        ...document.querySelectorAll(".bc-coins [data-game-coin]"),
      ].map((el) => el.getBoundingClientRect());
      const settings = box('[data-testid="coin-settings-button"]');
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        center: Math.abs(board.x + board.width / 2 - innerWidth / 2),
        tableGap: board.top - stage.bottom,
        betGap: player.left - pair.right,
        betHeight: player.height,
        boardHeight: board.height,
        coinGap: coins.top - board.bottom,
        settingsGap: settings.left - coinButtons.at(-1)!.right,
        actionsBottom: actions.bottom,
        cardsEnd: box(".bc-studio canvas").bottom,
        stageBottom: stage.bottom,
      };
    });
    expect(layout.overflow, `${width} horizontal overflow`).toBe(false);
    expect(layout.center, `${width} centered bets`).toBeLessThan(1);
    expect(
      layout.tableGap,
      `${width} table-to-bets gap`,
    ).toBeGreaterThanOrEqual(0);
    expect(layout.tableGap).toBeLessThanOrEqual(10);
    expect(
      layout.betGap,
      `${width} adjacent bet targets`,
    ).toBeGreaterThanOrEqual(0);
    expect(layout.betGap).toBeLessThanOrEqual(4);
    expect(
      layout.boardHeight - layout.betHeight,
      `${width} bets fill board`,
    ).toBeLessThanOrEqual(10);
    expect(layout.coinGap, `${width} coins close to bets`).toBeLessThanOrEqual(
      8,
    );
    expect(
      layout.settingsGap,
      `${width} settings beside coins`,
    ).toBeLessThanOrEqual(8);
    expect(
      layout.actionsBottom,
      `${width} controls visible without scrolling`,
    ).toBeLessThanOrEqual(height);
    expect(
      Math.abs(layout.cardsEnd - layout.stageBottom),
      `${width} complete dealer table visible`,
    ).toBeLessThan(2);
    await page.getByTestId("spot-playerPair").click();
    await expect(page.getByTestId("chipstack-playerPair")).toBeVisible();
    await page.screenshot({ path: review(`layout-${width}x${height}.png`) });
  }
  expect(state.errors).toEqual([]);
});

test("reduced motion freezes the dealer while scores still settle correctly", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await setup(page);
  const canvas = page.locator(".bc-studio canvas");
  await expect(canvas).toHaveAttribute("data-frame", "4.300");
  await state.reveal(six, 10500);
  await expect(page.getByTestId("text-banker-total")).toHaveText("9");
  await expect(canvas).toHaveAttribute("data-frame", "4.300");
  await expect(
    page.getByRole("button", { name: "Play dealer motion" }),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
});

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.baccaratAudioLog = [];
    w.baccaratSources = [];
    w.baccaratMusicGain = null;
    const connect = MediaElementAudioSourceNode.prototype.connect;
    MediaElementAudioSourceNode.prototype.connect = function(destination: any, ...args: any[]) {
      w.baccaratMusicGain = destination;
      return (connect as any).call(this, destination, ...args);
    } as any;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args: any[]) {
      const record = { duration: this.buffer?.duration, ended: false };
      this.addEventListener("ended", () => { record.ended = true; });
      w.baccaratSources.push(record);
      return (start as any).apply(this, args);
    };
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type !== "attributes" || record.attributeName !== "data-commentary") continue;
        const line = (record.target as HTMLElement).dataset.commentary;
        if (line && line !== "idle") w.baccaratAudioLog.push({ line, at: performance.now(), gain: w.baccaratMusicGain?.gain.value, count: document.querySelector(".bc-studio canvas")?.getAttribute("data-dealt") });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-commentary"] });
  });
}

test("music and Hindi commentary follow real reveals without early or duplicate results", async ({ page }) => {
  await observeAudio(page);
  const state = await setup(page);
  await page.getByTestId("baccarat-audio-settings").click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const table = page.getByTestId("baccarat-table");
  await expect(table).toHaveAttribute("data-audio-state", "running");
  await expect(table).toHaveAttribute("data-music-playing", "true");
  await expect.poll(() => page.evaluate(() => (window as any).baccaratAudioLog.find((e: any) => e.line === "open")?.gain)).toBeCloseTo(.7 * .25 * .24, 3);
  await expect(table).toHaveAttribute("data-commentary", "idle");
  await expect.poll(() => page.evaluate(() => (window as any).baccaratMusicGain.gain.value)).toBeCloseTo(.7 * .25, 3);
  await state.closeSoon(4900);
  await expect(table).toHaveAttribute("data-commentary", "closing");
  await state.reveal();
  await expect(table).toHaveAttribute("data-commentary", "closed");
  await expect(table).toHaveAttribute("data-commentary", "both-pairs", { timeout: 18000 });
  const log = await page.evaluate(() => (window as any).baccaratAudioLog);
  expect(log.map((e: any) => e.line)).toEqual(["open", "closing", "closed", "player-0", "banker-9", "banker-wins", "both-pairs"]);
  expect(log.filter((e: any) => /^(player-|banker-|both-)/.test(e.line)).every((e: any) => e.count === "6")).toBe(true);
  await page.evaluate(() => (window as any).refreshBaccarat());
  await expect(table).toHaveAttribute("data-commentary", "idle");
  expect(await page.evaluate(() => (window as any).baccaratAudioLog.filter((e: any) => e.line === "banker-wins").length)).toBe(1);
  await state.next();
  await expect(table).toHaveAttribute("data-commentary", "open");
  expect(state.errors).toEqual([]);
});

test("audio toggles persist, music ducks independently, and hiding/leaving stops sound", async ({ page }) => {
  await observeAudio(page);
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("baccarat-audio-settings").click();
  await expect(page.getByTestId("baccarat-audio-controls")).toBeVisible();
  await page.screenshot({ path: review("audio-controls-mobile.png") });
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-music-playing", "true");
  await page.getByTestId("baccarat-commentary-toggle").click();
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-commentary", "idle");
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-music-playing", "true");
  await page.getByTestId("baccarat-music-toggle").click();
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-music-playing", "false");
  await page.reload();
  await expect(page.getByTestId("spot-player")).toBeEnabled();
  await page.getByTestId("baccarat-audio-settings").click();
  await expect(page.getByTestId("baccarat-commentary-toggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("baccarat-music-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("baccarat-music-toggle").click();
  await page.getByTestId("baccarat-commentary-toggle").click();
  await page.getByTestId("baccarat-sound-toggle").click();
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-music-playing", "false");
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-commentary", "idle");
  await page.getByTestId("baccarat-sound-toggle").click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-music-playing", "true");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-music-playing", "false");
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-commentary", "idle");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-music-playing", "true");
  await state.reveal(natural, 7000);
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-commentary", "player-9");
  await page.evaluate(() => {
    (window as any).detachedBaccaratMusic = document.querySelector('[data-testid="baccarat-music"]');
    (window as any).unmountBaccarat();
  });
  await expect.poll(() => page.evaluate(() => (window as any).detachedBaccaratMusic.paused)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).baccaratSources.every((s: any) => s.ended))).toBe(true);
  expect(state.errors).toEqual([]);
});

test("late natural and tie commentary use confirmed scores; missing audio cannot break play", async ({ page }) => {
  await observeAudio(page);
  await page.route("**/media/baccarat/audio/banker-0.mp3", route => route.abort());
  const state = await setup(page);
  await page.getByTestId("spot-player").click();
  await state.reveal(natural, 7000);
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-commentary", "natural-9");
  const first = await page.evaluate(() => (window as any).baccaratAudioLog.map((e: any) => e.line));
  expect(first).toContain("player-9");
  expect(first).toContain("player-wins");
  expect(first).not.toContain("banker-0");
  await state.next();
  await state.reveal({ ...natural, bankerCards: [3, 17], bankerTotal: 9, winner: "tie" }, 7000);
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-commentary", "tie");
  await expect(page.getByTestId("text-result-winner")).toHaveText("Tie");
  expect(state.errors).toEqual([]);
});

test("unsupported audio keeps the table usable and explains availability", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: undefined });
  });
  const state = await setup(page);
  await page.getByTestId("spot-player").click();
  await expect(page.getByTestId("text-total-staked")).toContainText("100");
  await page.getByTestId("baccarat-audio-settings").click();
  await expect(page.getByText("Audio is unavailable in this browser. The table is still connected.")).toBeVisible();
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-audio-state", "unsupported");
  await expect(page.getByTestId("baccarat-enable-audio")).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("a delayed result recording is cancelled when the next round opens", async ({ page }) => {
  await observeAudio(page);
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/media/baccarat/audio/player-9.mp3", async route => {
    await gate;
    await route.continue();
  });
  const state = await setup(page);
  await page.getByTestId("spot-player").click();
  await state.reveal(natural, 7000);
  await expect(page.getByTestId("text-result-winner")).toHaveText("Player wins");
  await state.next();
  await expect(page.getByTestId("text-result-winner")).toHaveText("Place your bets");
  const response = page.waitForResponse("**/media/baccarat/audio/player-9.mp3");
  release!();
  await response;
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute("data-commentary", "idle");
  expect(await page.evaluate(() => (window as any).baccaratAudioLog.some((e: any) => e.line === "player-9" || e.line === "player-wins"))).toBe(false);
  expect(state.errors).toEqual([]);
});
