import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { BACCARAT_ROUND_TIMING } from "@workspace/api-zod/baccarat-game";
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
  expect(BACCARAT_ROUND_TIMING.bettingWindowMs).toBe(20_000);
  expect(
    Object.values(BACCARAT_ROUND_TIMING).reduce((sum, ms) => sum + ms, 0),
  ).toBe(30_000);
  for (const revealMs of [BACCARAT_ROUND_TIMING.revealDurationMs, 12000]) {
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
      const rate = studioCue("reveal", 0, revealMs, deal).rate;
      cards.forEach((card, i) => {
        const t = TAKES[card.take],
          cue = studioCue("reveal", elapsed + 1, revealMs, deal);
        expect(cue.index).toBe(i);
        expect(presentedCount(cue, t.release - 0.01)).toBe(i);
        expect(presentedCount(cue, t.release + 0.01)).toBe(i + 1);
        expect(visibleHand(deal, i, card.side).length).toBeLessThanOrEqual(
          card.index,
        );
        elapsed += ((t.end - t.start) * 1000) / rate;
      });
      expect(studioCue("reveal", revealMs - 1, revealMs, deal).completed).toBe(
        cards.length,
      );
      expect(studioCue("settling", 0, revealMs, deal).completed).toBe(
        cards.length,
      );
      expect(studioCue("betting", 1000, revealMs, deal).completed).toBe(0);
    }
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

async function setup(page: Page, wallet = 50000000, historyCount = 43, legacyRound = false) {
  let payoutVersion = legacyRound ? 2 : 3;
  const currentPayouts = {
    player: 2, banker: 2, tie: 9, playerPair: 12, bankerPair: 12,
    score1_4: 8.5, score5_6: 5, score7: 5.5, score8: 4, score9: 3.5,
  };
  const legacyPayouts = { ...currentPayouts, player: 1.69, banker: 1.64, tie: 8.93, playerPair: 11.37, bankerPair: 11.37 };
  let phase = "betting",
    deadline = 0,
    outcome: StudioDeal | null = null,
    round = 1;
  const posts: any[] = [],
    errors: string[] = [],
    myBets: any[] = [];
  const recent = Array.from({ length: historyCount }, (_, i) => ({
    roundId: `past-${i}`,
    outcome:
      i % 9 === 0
        ? {
            ...natural,
            bankerCards: [3, 17],
            bankerTotal: 9,
            winner: "tie" as const,
          }
        : i % 5 < 2
          ? natural
          : six,
    settledAt: new Date(Date.now() - (i + 1) * 48000).toISOString(),
  }));
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
        maxBetsPerDeal: 10,
        payoutVersion: 3,
        bankerSixReturn: 1.5,
        payouts: currentPayouts,
      };
    else if (path === "/api/baccarat/recent") body = [];
    else if (path === "/api/baccarat/round") {
      // Start the fixture's betting window when the app connects, so cold Vite
      // compilation cannot expire the round before its first response.
      if (!deadline)
        deadline = Date.now() + BACCARAT_ROUND_TIMING.bettingWindowMs;
      body = {
        roundId: `studio-${round}`,
        gameCode: "baccarat",
        phase,
        now: Date.now(),
        bettingEndsAt: deadline,
        revealEndsAt: deadline + BACCARAT_ROUND_TIMING.revealDurationMs,
        settleEndsAt:
          deadline +
          BACCARAT_ROUND_TIMING.revealDurationMs +
          BACCARAT_ROUND_TIMING.settleDurationMs,
        outcome,
        myBets,
        liveBets: [],
        recent,
        serverSeedHash: "test-seed-commitment",
        clientSeed: "test-client",
        nonce: round,
        serverSeed: phase === "betting" ? null : "test-seed",
        playerCount: 8,
        totalStake: "175000",
        config: {
          ...BACCARAT_ROUND_TIMING,
          payoutVersion,
          baccaratPayouts: {
            payoutVersion,
            payouts: payoutVersion === 3 ? currentPayouts : legacyPayouts,
            bankerSixReturn: payoutVersion === 3 ? 1.5 : 1.64,
          },
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
      if (outcome)
        recent.unshift({
          roundId: `studio-${round}`,
          outcome,
          settledAt: new Date().toISOString(),
        });
      round++;
      payoutVersion = 3;
      phase = "betting";
      deadline = Date.now() + BACCARAT_ROUND_TIMING.bettingWindowMs;
      outcome = null;
      myBets.length = 0;
      await refresh();
    },
  };
}

test("face-down cards wait for lock, flip in dealer order, and reset next round", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const state = await setup(page);
  await expect(page.locator(".bc-studio canvas")).toHaveAttribute(
    "data-paints",
    /[1-9]/,
  );
  const hands = page.getByTestId("current-hands");
  await expect(
    hands.locator('.bc-playing-card[data-revealed="false"]'),
  ).toHaveCount(6);
  await expect(hands.locator(".bc-third-card")).toHaveCount(2);
  expect(
    await hands.locator(".bc-third-card").evaluateAll((cards) =>
      cards.every((card) => {
        const rect = card.getBoundingClientRect();
        return rect.width > rect.height;
      }),
    ),
  ).toBe(true);
  expect(
    Number(await page.getByTestId("baccarat-countdown").textContent()),
  ).toBeLessThanOrEqual(20);
  await expect(hands.locator(".bc-face-card")).toHaveCount(0);
  await expect(page.locator('.bc-score-spot[data-winning="true"]')).toHaveCount(0);
  await expect(page.getByTestId("text-player-total")).toHaveText("–");
  await hands.evaluate((el) => {
    const w = window as any;
    w.openingPlayerCard = el.querySelector(
      '[data-testid="current-player-card-0"]',
    );
    w.cardFlipOrder = [];
    w.cardFlipFrames = [];
    new MutationObserver((records) => {
      for (const record of records) {
        const card = record.target as HTMLElement;
        if (card.dataset.revealed === "true") {
          w.cardFlipOrder.push(card.dataset.testid);
          w.cardFlipFrames.push({
            playerTotal: el.querySelector('[data-testid="text-player-total"]')
              ?.textContent,
            bankerTotal: el.querySelector('[data-testid="text-banker-total"]')
              ?.textContent,
            status: document.querySelector('[data-testid="text-result-winner"]')
              ?.textContent,
            score: document.querySelector('[data-testid="baccarat-score-result"]')?.textContent,
          });
        }
      }
    }).observe(el, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-revealed"],
    });
  });
  await page.screenshot({
    path: review("desktop-betting.png"),
  });
  await state.reveal();
  await expect(page.getByTestId("spot-player")).toBeDisabled();
  // Capture transient reveal states in the page instead of polling for a
  // sub-second frame in the accelerated eight-second dealing window.
  await expect(page.locator(".bc-studio canvas")).toHaveAttribute(
    "data-dealt",
    "6",
  );
  await expect(page.getByTestId("current-player-card-0")).toHaveAttribute(
    "aria-label",
    "2 ♠",
  );
  expect(
    await page
      .getByTestId("current-player-card-0")
      .evaluate((el) => el === (window as any).openingPlayerCard),
  ).toBe(true);
  const firstFlip = await page.evaluate(
    () => (window as any).cardFlipFrames[0],
  );
  expect(firstFlip).toMatchObject({ playerTotal: "2", bankerTotal: "–" });
  expect(firstFlip.status).not.toContain("wins");
  expect(firstFlip.score).not.toContain("Score 9");
  await expect(page.getByTestId("text-player-total")).toHaveText("0");
  await expect(page.getByTestId("text-banker-total")).toHaveText("9");
  await expect(page.getByTestId("spot-score9")).toHaveAttribute("data-winning", "true");
  await expect(page.getByTestId("text-result-winner")).toHaveText(
    "Banker wins",
  );
  await expect(
    hands.locator('.bc-playing-card[data-revealed="true"]'),
  ).toHaveCount(6);
  expect(await page.evaluate(() => (window as any).cardFlipOrder)).toEqual([
    "current-player-card-0",
    "current-banker-card-0",
    "current-player-card-1",
    "current-banker-card-1",
    "current-player-card-2",
    "current-banker-card-2",
  ]);
  await page.screenshot({
    path: review("desktop-result.png"),
  });
  await state.next();
  await expect(page.getByTestId("text-player-total")).toHaveText("–");
  await expect(page.locator('.bc-score-spot[data-winning="true"]')).toHaveCount(0);
  await expect(page.getByTestId("spot-player")).toBeEnabled();
  await expect(
    hands.locator('.bc-playing-card[data-revealed="false"]'),
  ).toHaveCount(6);
  await expect(hands.locator(".bc-face-card")).toHaveCount(0);
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

test("round quotes retain old rates, then switch to reference odds and Banker 6 rules", async ({ page }) => {
  const state = await setup(page, 50000000, 43, true);
  await expect(page.getByTestId("spot-player").locator(".bc-odds")).toHaveText("0.69:1");
  await expect(page.getByTestId("spot-banker").locator(".bc-odds")).toHaveText("0.64:1");
  await expect(page.getByTestId("banker-six-odds")).toHaveCount(0);
  await state.next();
  await expect(page.getByTestId("spot-player").locator(".bc-odds")).toHaveText("1:1");
  await expect(page.getByTestId("spot-banker").locator(".bc-odds")).toHaveText("1:1 · 6 pays 0.5:1");
  await expect(page.getByTestId("spot-tie").locator(".bc-odds")).toHaveText("8:1");
  await expect(page.getByTestId("spot-playerPair").locator(".bc-odds")).toHaveText("11:1");
  await expect(page.getByTestId("spot-bankerPair").locator(".bc-odds")).toHaveText("11:1");
  await page.getByTestId("btn-game-rules").click();
  const rules = page.getByTestId("baccarat-drawing-rules");
  await expect(rules.locator("table")).toHaveCount(2);
  await expect(page.getByTestId("banker-six-example")).toContainText("₹100 returns ₹150");
  await expect(rules).toContainText("Pairs use only the first two cards");
  await page.keyboard.press("Escape");
  expect(state.errors).toEqual([]);
});

test("score markets support all ten spots, chip editing, auto submission, locks and repeat", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page);
  const scoreboard = page.getByTestId("baccarat-scoreboard");
  await expect(scoreboard.locator(".bc-score-label")).toHaveText(["Score 1-4", "Score 5-6", "Score 7", "Score 8", "Score 9"]);
  await expect(scoreboard.locator(".bc-score-odds")).toHaveText(["7.5:1", "4:1", "4.5:1", "3:1", "2.5:1"]);
  await page.getByTestId("spot-score9").click();
  await page.getByTestId("btn-double").click();
  await expect(page.getByTestId("chipstack-score9")).toContainText("₹200");
  await page.getByTestId("btn-undo").click();
  await expect(page.getByTestId("chipstack-score9")).toContainText("₹100");
  await page.getByTestId("btn-clear").click();
  const types = ["player", "banker", "tie", "playerPair", "bankerPair", "score1_4", "score5_6", "score7", "score8", "score9"];
  for (const type of types) await page.getByTestId(`spot-${type}`).click();
  await expect(page.getByTestId("text-total-staked")).toHaveText("Selected ₹1,000");
  await page.screenshot({ path: review("score-bets-mobile.png") });
  await state.closeSoon();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0].bets).toEqual(types.map((type) => ({ type, amountPaise: "10000" })));
  for (const type of types) await expect(page.getByTestId(`chipstack-${type}`)).toBeVisible();
  await state.reveal(six, 7500);
  await expect(page.getByTestId("spot-score9")).toBeDisabled();
  await expect(scoreboard.locator(".bc-score-lock")).toHaveCount(5);
  await expect(page.getByTestId("spot-score9")).toHaveAttribute("data-winning", "true");
  await expect(page.getByTestId("baccarat-score-result")).toHaveText("Banker · Score 9");
  await state.next();
  await page.getByTestId("btn-rebet").click();
  await expect(page.getByTestId("text-total-staked")).toHaveText("Selected ₹1,000");
  await state.reveal({ ...natural, winner: "tie", bankerCards: [3, 17], bankerTotal: 9 }, 7500);
  await expect(page.getByTestId("baccarat-score-result")).toHaveText("Tie · No score winner");
  await expect(scoreboard.locator('[data-winning="true"]')).toHaveCount(0);
  expect(state.errors).toEqual([]);
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
  await state.reveal(natural, 7500);
  await expect(page.getByTestId("text-result-winner")).toHaveText(
    "Player wins",
  );
  await expect(page.getByTestId("text-player-total")).toHaveText("9");
  await expect(
    page.getByTestId("current-hands").locator(".bc-face-card"),
  ).toHaveCount(4);
  await expect(
    page.getByTestId("current-hands").locator(".bc-playing-card"),
  ).toHaveCount(6);
  await expect(
    page
      .getByTestId("current-hands")
      .locator('.bc-third-card[data-unused="true"]'),
  ).toHaveCount(2);
  await expect(
    page.getByTestId("current-hands").locator(".bc-third-card .bc-face-card"),
  ).toHaveCount(0);
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
  test.setTimeout(90000);
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
    await state.reveal(six, 7500);
    await expect(
      page.getByTestId("current-hands").locator(".bc-face-card"),
    ).toHaveCount(6);
    const layout = await page.evaluate(() => {
      const box = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect();
      const board = box(".bc-betting-board"),
        stage = box(".bc-stage");
      const player = box(".bc-spot-player"),
        pair = box(".bc-spot-playerPair");
      const coins = box(".bc-coins"),
        actions = box(".bc-actions");
      const scoreboard = box(".bc-scoreboard");
      const scoreSpots = [...document.querySelectorAll(".bc-score-spot")].map((el) => el.getBoundingClientRect());
      const coinButtons = [
        ...document.querySelectorAll(".bc-coins [data-game-coin]"),
      ].map((el) => el.getBoundingClientRect());
      const settings = box('[data-testid="coin-settings-button"]');
      const hands = [
        ...document.querySelectorAll(".bc-card-panel .bc-result-hand"),
      ].map((el) => el.getBoundingClientRect());
      const tie = box(".bc-spot-tie");
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        center: Math.abs(board.x + board.width / 2 - innerWidth / 2),
        tableGap: scoreboard.top - stage.bottom,
        scoreCoinGap: coins.top - scoreboard.bottom,
        scoresFit: scoreSpots.length === 5 && scoreSpots.every((spot) => spot.left >= scoreboard.left && spot.right <= scoreboard.right + 1 && spot.height >= 44 && spot.top === scoreSpots[0].top),
        cardsInsideBoard: hands.every(
          (hand) => hand.top >= board.top && hand.bottom <= board.bottom,
        ),
        cardsClearOfTie:
          hands[0].right <= tie.left && hands[1].left >= tie.right,
        handOverflow: [...document.querySelectorAll(".bc-result-hand")].some(
          (el) => el.scrollWidth > el.clientWidth,
        ),
        horizontalThirds: [
          ...document.querySelectorAll(".bc-third-card"),
        ].every((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > rect.height;
        }),
        betGap: player.left - pair.right,
        betHeight: player.height,
        boardHeight: board.height,
        coinGap: board.top - coins.bottom,
        settingsGap: settings.left - coinButtons.at(-1)!.right,
        actionsBottom: actions.bottom,
        cardsEnd: box(".bc-studio canvas").bottom,
        stageBottom: stage.bottom,
      };
    });
    expect(layout.overflow, `${width} horizontal overflow`).toBe(false);
    expect(layout.handOverflow, `${width} hand overflow`).toBe(false);
    expect(
      layout.horizontalThirds,
      `${width} third cards stay horizontal`,
    ).toBe(true);
    expect(
      layout.cardsInsideBoard,
      `${width} cards stay inside the betting panel`,
    ).toBe(true);
    expect(layout.cardsClearOfTie, `${width} Tie does not cover cards`).toBe(
      true,
    );
    expect(layout.center, `${width} centered bets`).toBeLessThan(1);
    expect(
      layout.tableGap,
      `${width} table-to-bets gap`,
    ).toBeGreaterThanOrEqual(0);
    expect(layout.tableGap).toBeLessThanOrEqual(10);
    expect(layout.scoresFit, `${width} score bets fit on one row`).toBe(true);
    expect(layout.scoreCoinGap).toBeGreaterThanOrEqual(0);
    expect(layout.scoreCoinGap).toBeLessThanOrEqual(10);
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
      16,
    );
    expect(
      layout.settingsGap,
      `${width} settings beside coins`,
    ).toBeLessThanOrEqual(8);
    expect(
      layout.actionsBottom,
      `${width} controls stay within the game`,
    ).toBeLessThanOrEqual(Math.max(height, 760));
    expect(
      Math.abs(layout.cardsEnd - layout.stageBottom),
      `${width} complete dealer table visible`,
    ).toBeLessThan(2);
    await page.screenshot({ path: review(`layout-${width}x${height}.png`) });
    await state.next();
    await page.getByTestId("spot-playerPair").click();
    await expect(page.getByTestId("chipstack-playerPair")).toBeVisible();
    expect(
      await page
        .locator(".bc-spot-playerPair")
        .evaluate(
          (el) =>
            el.querySelector(".bc-bet-chip")!.getBoundingClientRect().bottom <=
            el.querySelector(".bc-spot-title")!.getBoundingClientRect().top,
        ),
      `${width} chip leaves the bet label readable`,
    ).toBe(true);
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
  await state.reveal(six, 7500);
  await expect(page.getByTestId("text-banker-total")).toHaveText("9");
  await expect(canvas).toHaveAttribute("data-frame", "4.300");
  expect(
    await page
      .getByTestId("current-player-card-0")
      .locator(".bc-card-turn")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  await expect(
    page.getByRole("button", { name: "Play dealer motion" }),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
});

async function openAudio(page: Page) {
  await page.getByTestId("baccarat-audio-settings").click();
}

test("commentary stays removed even with an old enabled preference; music still works", async ({
  page,
}) => {
  const voiceRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /\/media\/baccarat\/audio\//.test(request.url()) &&
      !request.url().includes("vip-lounge.mp3")
    )
      voiceRequests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem("baccarat:commentary", "true");
    localStorage.setItem("baccarat:voice-volume", "1");
  });
  const state = await setup(page);
  await openAudio(page);
  await expect(page.getByTestId("baccarat-commentary-toggle")).toHaveCount(0);
  await expect(
    page.getByRole("slider", { name: "Commentary volume" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute(
    "data-music-playing",
    "true",
  );
  await state.closeSoon(4900);
  await state.reveal(natural, 7500);
  await expect(page.getByTestId("baccarat-card-status")).toHaveText(
    "Player wins",
  );
  await expect(page.getByTestId("baccarat-commentary-caption")).toHaveCount(0);
  await state.next();
  await page.reload();
  await expect(page.getByTestId("spot-player")).toBeEnabled();
  expect(voiceRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("music settings persist and hiding or leaving the game stops playback", async ({
  page,
}) => {
  const state = await setup(page);
  await openAudio(page);
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute(
    "data-music-playing",
    "true",
  );
  await page.getByTestId("baccarat-music-toggle").click();
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute(
    "data-music-playing",
    "false",
  );
  await page.reload();
  await openAudio(page);
  await expect(page.getByTestId("baccarat-music-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.getByTestId("baccarat-music-toggle").click();
  await page.getByTestId("baccarat-sound-toggle").click();
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute(
    "data-music-playing",
    "false",
  );
  await page.getByTestId("baccarat-sound-toggle").click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute(
    "data-music-playing",
    "true",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute(
    "data-music-playing",
    "false",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute(
    "data-music-playing",
    "true",
  );
  await page.evaluate(() => {
    (window as any).detachedBaccaratMusic = document.querySelector(
      '[data-testid="baccarat-music"]',
    );
    (window as any).unmountBaccarat();
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).detachedBaccaratMusic.paused),
    )
    .toBe(true);
  expect(state.errors).toEqual([]);
});

test("history shows all table rounds without early results and retains cards after next round and reload", async ({
  page,
}) => {
  const state = await setup(page);
  const history = page.getByTestId("baccarat-history");
  await expect(page.getByTestId("statistics-player").locator("b")).toHaveText(
    "16",
  );
  await expect(page.getByTestId("statistics-banker").locator("b")).toHaveText(
    "22",
  );
  await expect(page.getByTestId("statistics-tie").locator("b")).toHaveText("5");
  await expect(history.locator(".bc-result-cell")).toHaveCount(20);
  await history.getByRole("button", { name: "Results", exact: true }).click();
  await expect(history.locator(".bc-history-row")).toHaveCount(43);
  await expect(history.locator(".bc-history-row").first()).toContainText(
    "Latest",
  );
  await state.reveal();
  await expect(page.getByTestId("history-studio-1")).toHaveCount(0);
  await expect(
    page.getByTestId("current-hands").locator(".bc-face-card"),
  ).toHaveCount(6);
  await expect(page.getByTestId("history-studio-1")).toBeVisible();
  await expect(page.getByTestId("baccarat-card-status")).toHaveText(
    "Banker wins",
  );
  await history
    .getByRole("button", { name: "Statistics", exact: true })
    .click();
  await expect(page.getByTestId("statistics-banker").locator("b")).toHaveText(
    "23",
  );
  await expect(history.locator(".bc-result-cell").first()).toHaveText("B");
  await history.getByRole("button", { name: "Results", exact: true }).click();
  await state.next();
  await expect(
    page.getByTestId("current-hands").locator(".bc-face-card"),
  ).toHaveCount(0);
  await expect(history.locator(".bc-history-row")).toHaveCount(44);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("history-studio-1").click();
  const detail = page.getByTestId("baccarat-history-detail");
  await expect(detail.getByRole("heading")).toHaveText("Banker wins");
  await expect(detail.locator(".bc-face-card")).toHaveCount(6);
  expect(
    await detail
      .locator(".bc-result-hand")
      .evaluateAll((hands) =>
        hands.every((hand) => hand.scrollWidth <= hand.clientWidth),
      ),
  ).toBe(true);
  await expect(detail.getByTestId("history-player-total")).toHaveText("0");
  await expect(detail.getByTestId("history-banker-total")).toHaveText("9");
  await expect(detail.getByText("Player pair", { exact: true })).toBeVisible();
  await expect(detail.getByText("Banker pair", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("statistics-banker").locator("b")).toHaveText(
    "23",
  );
  await history.getByRole("button", { name: "Results", exact: true }).click();
  await expect(page.getByTestId("history-studio-1")).toBeVisible();
  await history.getByRole("button", { name: "Roads", exact: true }).click();
  await expect(history.locator(".bc-road-grid")).toHaveCount(2);
  await history.getByRole("button", { name: "Results", exact: true }).click();
  await expect(history.locator(".bc-history-row")).toHaveCount(44);
  expect(state.posts).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("empty history and tied hands are clear on a small phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const state = await setup(page, 50000000, 0);
  await expect(
    page.getByTestId("baccarat-statistics").getByRole("img"),
  ).toHaveAttribute("aria-label", "No completed rounds yet");
  await expect(
    page.getByText("Completed rounds will appear here."),
  ).toBeVisible();
  await state.reveal(
    { ...natural, bankerCards: [3, 17], bankerTotal: 9, winner: "tie" },
    7500,
  );
  await expect(page.getByTestId("baccarat-card-status")).toHaveText("Tie");
  await expect(
    page.getByTestId("current-hands").locator(".bc-hand-outcome"),
  ).toHaveText(["TIE", "TIE"]);
  await page.getByTestId("result-studio-1").click();
  await expect(
    page.getByTestId("history-hands").locator(".bc-face-card"),
  ).toHaveCount(4);
  expect(
    await page
      .getByTestId("baccarat-history-detail")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: review("phone-result-history.png") });
  expect(state.errors).toEqual([]);
});

test("unsupported audio keeps the table usable and explains availability", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "webkitAudioContext", {
      configurable: true,
      value: undefined,
    });
  });
  const state = await setup(page);
  await page.getByTestId("spot-player").click();
  await expect(page.getByTestId("text-total-staked")).toContainText("100");
  await openAudio(page);
  await expect(
    page.getByText(
      "Audio is unavailable in this browser. The table is still connected.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("baccarat-table")).toHaveAttribute(
    "data-audio-state",
    "unsupported",
  );
  await expect(page.getByTestId("baccarat-enable-audio")).toHaveCount(0);
  expect(state.errors).toEqual([]);
});
