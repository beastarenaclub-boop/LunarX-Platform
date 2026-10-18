import { test, expect, type Page } from "@playwright/test";
import {
  INSTANT_COLLECTION,
  coinLiveMultiplier,
  collectionPayout,
  type CoinSide,
  type CoinLiveReceipt,
  type CoinLiveInput,
} from "@workspace/api-zod/instant-collection";

async function setup(
  page: Page,
  options: {
    balance?: bigint;
    cap?: number;
    drop?: boolean;
    reject?: boolean;
    motion?: boolean;
  } = {},
) {
  let balance = options.balance ?? 1000000n,
    number = 1,
    phase = "betting",
    chosen: CoinSide | null = null;
  let ends = Date.now() + 15000,
    slips: any[] = [],
    receipts: CoinLiveReceipt[] = [],
    recent: any[] = [];
  let failRound = false,
    hiddenSlip = false,
    dropped = false;
  const posts: CoinLiveInput[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const roundId = () => `coin-round-${number}`;
  const snapshot = () => ({
    roundId: roundId(),
    gameCode: "coin-flip",
    phase,
    now: Date.now(),
    bettingEndsAt: ends,
    revealEndsAt: ends + 10000,
    settleEndsAt: ends + 15000,
    serverSeedHash: "committed-hash",
    serverSeed: chosen ? "revealed-seed" : null,
    clientSeed: "shared-client-seed",
    nonce: 0,
    outcome: chosen
      ? { side: chosen, value: chosen === "heads" ? 0 : 1 }
      : null,
    totalStake: slips[0]?.totalStake ?? "0",
    playerCount: slips.length,
    config: {
      houseEdge: 0.03,
      maxMultiplier: options.cap ?? 1000,
      minStakePaise: "100",
      maxStakePaise: "1000000",
      bettingWindowMs: 15000,
      revealDurationMs: 10000,
      settleDurationMs: 5000,
    },
    liveBets: [],
    myBets: hiddenSlip ? [] : slips,
    recent,
  });
  await page.emulateMedia({
    reducedMotion: options.motion ? "no-preference" : "reduce",
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({
        musicOnByDefaultMigrated: true,
        settings: { onboarded: true, sound: false, music: false },
      }),
    ),
  );
  await page.routeWebSocket("**/ws", (ws) => ws.onMessage(() => {}));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: any = {};
    if (path === "/api/auth/me")
      body = {
        id: "coin-test",
        displayName: "Player",
        role: "player",
        email: "coin@example.test",
      };
    else if (path === "/api/wallet/balance")
      body = {
        balance: String(balance),
        currency: "INR",
        scope: "lunar",
        walletId: "shared",
      };
    else if (path === "/api/wallet/balances")
      body = { balances: { lunar: String(balance) } };
    else if (path === "/api/game/registry")
      body = INSTANT_COLLECTION.map((g) => ({
        gameCode: g.code,
        title: g.name,
        route: `/${g.code}`,
        enabled: true,
      }));
    else if (path === "/api/instant/coin-flip/config")
      body = {
        enabled: true,
        minStakePaise: "100",
        maxStakePaise: "1000000",
        rtp: 0.97,
        maxMultiplier: options.cap ?? 1000,
      };
    else if (path.endsWith("/live/round")) {
      if (failRound)
        return route.fulfill({ status: 503, json: { detail: "Offline" } });
      body = snapshot();
    } else if (path.endsWith("/live/state"))
      body = { round: null, history: hiddenSlip ? [] : receipts };
    else if (path.endsWith("/live/bet")) {
      const input = route.request().postDataJSON() as CoinLiveInput;
      posts.push(input);
      if (options.reject)
        return route.fulfill({
          status: 400,
          json: { detail: "This table is paused." },
        });
      const existing =
        slips[0]?.roundId === input.roundId
          ? slips[0]
          : receipts.find((r) => r.tableRoundId === input.roundId);
      if (!existing) {
        if (phase !== "betting" || input.roundId !== roundId())
          return route.fulfill({
            status: 400,
            json: { detail: "Betting closed." },
          });
        balance -= BigInt(input.stakeAmount);
        slips = [
          {
            roundId: input.roundId,
            slipId: `slip-${number}`,
            totalStake: input.stakeAmount,
            bets: [{ side: input.side, amount: input.stakeAmount }],
            status: "pending",
            payoutAmount: "0",
            auditRoundId: null,
          },
        ];
      }
      if (options.drop && !dropped) {
        dropped = true;
        hiddenSlip = true;
        return route.abort("connectionreset");
      }
      hiddenSlip = false;
      body = {
        roundId: input.roundId,
        status: "pending",
        slipId: `slip-${number}`,
      };
    } else if (
      path.includes("banners") ||
      path.includes("upi-accounts") ||
      path.includes("coin-packs")
    )
      body = [];
    else if (path.includes("transactions") || path.includes("/bets"))
      body = { entries: [], nextCursor: null };
    await route.fulfill({ json: body });
  });
  await page.goto("/coin-flip");
  await expect(page.getByTestId("collection-play")).toBeVisible();
  await expect(page.getByTestId("coin-round-clock")).toContainText("BETS CLOSE IN");
  return {
    posts,
    errors,
    get balance() {
      return balance;
    },
    get roundId() {
      return roundId();
    },
    fail() {
      failRound = true;
    },
    toss(elapsed = 0) {
      phase = "reveal";
      ends = Date.now() - elapsed;
    },
    result(side: CoinSide) {
      phase = "settling";
      chosen = side;
      ends = Date.now() - 10000;
      const slip = slips[0];
      if (slip && slip.status === "pending") {
        const multiplier =
          slip.bets[0].side === side
            ? coinLiveMultiplier(0.97, options.cap ?? 1000)
            : 0;
        const payout = collectionPayout(BigInt(slip.totalStake), multiplier);
        balance += payout;
        slip.status = "settled";
        slip.payoutAmount = String(payout);
        slip.auditRoundId = roundId();
        receipts.unshift({
          id: `bet-${number}`,
          tableRoundId: roundId(),
          slipStatus: "settled",
          gameCode: "coin-flip",
          requestId: slip.slipId,
          status: payout > 0n ? "won" : "lost",
          stakeAmount: slip.totalStake,
          payoutAmount: String(payout),
          cashoutAmount: String(payout),
          multiplier,
          step: 0,
          options: { choice: slip.bets[0].side, difficulty: "easy", mines: 3 },
          outcome: [side === "heads" ? 0 : 1],
          revealed: [],
          hazards: null,
          serverSeed: "revealed-seed",
          serverSeedHash: "committed-hash",
          clientSeed: "shared-client-seed",
          createdAt: new Date().toISOString(),
          rtp: 0.97,
          maxMultiplier: options.cap ?? 1000,
        });
      }
    },
    next() {
      if (chosen)
        recent.unshift({
          roundId: roundId(),
          outcome: { side: chosen, value: chosen === "heads" ? 0 : 1 },
          settledAt: new Date().toISOString(),
        });
      number++;
      phase = "betting";
      ends = Date.now() + 15000;
      chosen = null;
      slips = [];
    },
  };
}

test("continuous rounds show the shared result on her palm without placing a bet", async ({
  page,
}) => {
  const f = await setup(page);
  await expect(page.getByTestId("coin-round-clock")).toContainText(
    "BETS CLOSE IN",
  );
  for (const side of ["heads", "tails"] as CoinSide[]) {
    f.toss();
    await expect(page.getByTestId("coin-round-clock")).toContainText(
      "RESULT IN",
    );
    await expect(page.getByTestId("coin-palm-result")).toHaveCount(0);
    f.result(side);
    await expect(page.getByTestId("coin-palm-result")).toHaveAttribute(
      "data-side",
      side,
    );
    await expect(page.getByTestId("collection-result")).toContainText(
      side.toUpperCase() + " LANDED",
    );
    f.next();
    await expect(page.getByTestId("coin-round-clock")).toContainText(
      "BETS CLOSE IN",
    );
  }
  expect(f.posts).toHaveLength(0);
  expect(f.balance).toBe(1000000n);
  expect(f.errors).toEqual([]);
});

for (const side of ["heads", "tails"] as CoinSide[])
  for (const win of [true, false])
    test(`${side} ${win ? "win" : "loss"}: palm, receipt, wallet and reload agree`, async ({
      page,
    }) => {
      const f = await setup(page);
      await page
        .getByRole("button", {
          name: `Bet on ${side === "heads" ? "Heads" : "Tails"}`,
          exact: true,
        })
        .click();
      await page.getByLabel("Bet amount", { exact: true }).fill("101.01");
      await page.getByTestId("collection-play").dblclick();
      await expect(page.getByTestId("collection-play")).toContainText(
        "Bet confirmed",
      );
      expect(f.posts).toHaveLength(1);
      expect(f.balance).toBe(989899n);
      f.toss();
      const result = win ? side : side === "heads" ? "tails" : "heads";
      f.result(result);
      await expect(page.getByTestId("coin-palm-result")).toHaveAttribute(
        "data-side",
        result,
      );
      await expect(page.getByTestId("collection-result")).toContainText(
        win ? "₹195.95 returned" : "no win",
      );
      await expect(page.getByTestId("collection-balance")).toContainText(
        win ? "10,094.94" : "9,898.99",
      );
      await page.reload();
      await expect(
        page.getByRole("button", {
          name: `Bet on ${side === "heads" ? "Heads" : "Tails"}`,
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      await page
        .getByRole("button", { name: "Recent rounds", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toContainText(
        win ? "195.95" : "0.00",
      );
      expect(f.posts).toHaveLength(1);
      expect(f.errors).toEqual([]);
    });

test("auto-bet starts explicitly and spends once per round for the chosen count", async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole("button", { name: "Bet on Tails", exact: true }).click();
  await page.getByLabel("Bet amount", { exact: true }).fill("10.10");
  await page.getByLabel("Auto-bet rounds", { exact: true }).fill("2");
  expect(f.posts).toHaveLength(0);
  await page
    .getByRole("button", { name: "Start auto-bet · TAILS", exact: true })
    .click();
  await expect.poll(() => f.posts.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Stop auto-bet", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Bet amount", { exact: true })).toBeDisabled();
  f.result("tails");
  await expect(page.getByTestId("coin-auto-controls")).toContainText(
    "Net: ₹9.49",
  );
  f.next();
  await expect.poll(() => f.posts.length).toBe(2);
  expect(f.posts[1]).toEqual({
    roundId: "coin-round-2",
    side: "tails",
    stakeAmount: "1010",
  });
  f.result("heads");
  await expect(page.getByTestId("coin-auto-controls")).toContainText(
    "Auto-bet completed",
  );
  f.next();
  await expect(page.getByTestId("collection-play")).toBeEnabled();
  expect(f.posts).toHaveLength(2);
  expect(f.errors).toEqual([]);
});

for (const mode of [
  "stop",
  "hidden",
  "offline",
  "reload",
  "server-error",
] as const)
  test(`auto-bet ${mode} never resumes spending on the next round`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page
      .getByRole("button", { name: "Start auto-bet · HEADS", exact: true })
      .click();
    await expect.poll(() => f.posts.length).toBe(1);
    await expect(page.getByTestId("collection-play")).toContainText(
      "Bet confirmed",
    );
    if (mode === "stop")
      await page
        .getByRole("button", { name: "Stop auto-bet", exact: true })
        .click();
    if (mode === "hidden")
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    if (mode === "offline")
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    if (mode === "reload") await page.reload();
    if (mode === "server-error") f.fail();
    await expect(
      page.getByRole("button", { name: "Stop auto-bet", exact: true }),
    ).toHaveCount(0);
    if (mode === "hidden")
      await page.evaluate(() => {
        delete (document as any).hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
    f.result("heads");
    f.next();
    await expect(page.getByTestId("coin-auto-controls")).toContainText("OFF");
    expect(f.posts).toHaveLength(1);
  });

for (const kind of ["loss", "profit"] as const)
  test(`auto-bet stops at its net ${kind} limit`, async ({ page }) => {
    const f = await setup(page);
    await page
      .getByLabel(
        kind === "loss" ? "Auto-bet loss limit" : "Auto-bet profit target",
        { exact: true },
      )
      .fill(kind === "loss" ? "100" : "94");
    await page
      .getByRole("button", { name: "Start auto-bet · HEADS", exact: true })
      .click();
    await expect.poll(() => f.posts.length).toBe(1);
    f.result(kind === "loss" ? "tails" : "heads");
    await expect(page.getByTestId("coin-auto-controls")).toContainText(
      kind === "loss" ? "loss limit reached" : "profit target reached",
    );
    f.next();
    await expect(page.getByTestId("collection-play")).toBeEnabled();
    expect(f.posts).toHaveLength(1);
  });

test("lost response recovers the original round after reload without another debit", async ({
  page,
}) => {
  const f = await setup(page, { drop: true });
  await page.getByRole("button", { name: "Bet on Tails", exact: true }).click();
  await page.getByLabel("Bet amount", { exact: true }).fill("250");
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("collection-play")).toContainText(
    "Recover pending bet",
  );
  await page.reload();
  await expect(page.getByLabel("Bet amount", { exact: true })).toHaveValue(
    "250.00",
  );
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("collection-play")).toContainText(
    "Bet confirmed",
  );
  expect(f.posts).toHaveLength(2);
  expect(f.posts[0]).toEqual(f.posts[1]);
  expect(f.balance).toBe(975000n);
});

test("a rejected auto bet stops without reporting acceptance", async ({
  page,
}) => {
  const f = await setup(page, { reject: true });
  await page
    .getByRole("button", { name: "Start auto-bet · HEADS", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("paused");
  await expect(page.getByTestId("coin-auto-controls")).toContainText("OFF");
  expect(f.posts).toHaveLength(1);
  expect(f.balance).toBe(1000000n);
});

test("closed rounds lock manual betting; auto-bet waits for the next open round", async ({
  page,
}) => {
  const f = await setup(page);
  f.toss();
  await expect(page.getByTestId("coin-round-clock")).toContainText("RESULT IN");
  await expect(page.getByTestId("collection-play")).toBeDisabled();
  await page
    .getByRole("button", { name: "Start auto-bet · HEADS", exact: true })
    .click();
  expect(f.posts).toHaveLength(0);
  f.result("heads");
  f.next();
  await expect.poll(() => f.posts.length).toBe(1);
});

test("invalid amounts, empty wallet and invalid auto settings cannot spend", async ({
  page,
}) => {
  const f = await setup(page, { balance: 1000n });
  await expect(page.getByTestId("collection-play")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start auto-bet · HEADS", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Bet amount", { exact: true }).fill("1.001");
  await expect(page.getByTestId("collection-play")).toBeDisabled();
  await page.getByLabel("Bet amount", { exact: true }).fill("1");
  await page.getByLabel("Auto-bet rounds", { exact: true }).fill("0");
  await expect(
    page.getByRole("button", { name: "Start auto-bet · HEADS", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Auto-bet rounds", { exact: true }).fill("10");
  await page.getByLabel("Auto-bet loss limit", { exact: true }).fill("-1");
  await expect(
    page.getByRole("button", { name: "Start auto-bet · HEADS", exact: true }),
  ).toBeDisabled();
  expect(f.posts).toHaveLength(0);
});

test("video follows the shared clock; palm result fits desktop and mobile without a wager", async ({
  page,
}) => {
  const f = await setup(page, { motion: true });
  const video = page.getByTestId("coin-host-video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  f.toss(3500);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(3);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  await page.getByTestId("coin-stadium").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "tmp/coin-live/toss.png" });
  f.result("heads");
  await expect(page.getByTestId("coin-palm-result")).toHaveAttribute(
    "data-side",
    "heads",
  );
  for (const width of [1440, 390, 320, 844]) {
    await page.setViewportSize({ width, height: 950 });
    await page.getByTestId("coin-stadium").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const hand = await page.getByTestId("coin-palm-result").boundingBox(),
      stage = await page.getByTestId("coin-stadium").boundingBox();
    expect(hand!.x).toBeGreaterThan(stage!.x);
    expect(hand!.x + hand!.width).toBeLessThan(stage!.x + stage!.width);
    await page.screenshot({ path: `tmp/coin-live/palm-${width}.png` });
    await page.getByTestId("coin-auto-controls").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tmp/coin-live/controls-${width}.png` });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(video).toHaveCount(0);
  await expect(page.getByTestId("coin-palm-result")).toHaveAttribute(
    "data-side",
    "heads",
  );
  expect(f.posts).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test("failed media still reveals the correct palm and leaves betting usable", async ({
  page,
}) => {
  await page.route("**/stadium-palm-toss.mp4", (r) => r.abort());
  const f = await setup(page, { motion: true });
  f.toss();
  f.result("tails");
  await expect(page.getByTestId("coin-palm-result")).toHaveAttribute(
    "data-side",
    "tails",
  );
  f.next();
  await expect(page.getByTestId("collection-play")).toBeEnabled();
  expect(f.posts).toHaveLength(0);
});

test("payout cap and account chip presets are retained", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "account:coin-test:button-values:v1",
      JSON.stringify([25, 75, 125, 250, 500, 25000]),
    ),
  );
  const f = await setup(page, { cap: 1.5 });
  await page.getByTestId("chip-coin-flip-75").click();
  await expect(page.getByTestId("coin-potential-return")).toHaveText("₹112.50");
  await expect(page.getByTestId("chip-coin-flip-25000")).toHaveCount(0);
  expect(f.posts).toHaveLength(0);
});
