import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

type Game = "teen-patti" | "teen-patti-live";
async function table(
  page: Page,
  game: Game,
  options: {
    balance?: string;
    min?: string;
    max?: string;
    reject?: boolean;
  } = {},
) {
  let socket: WebSocketRoute;
  let delivered = false;
  const requests: {
    roundId: string;
    bets: { type: string; amountPaise: string }[];
  }[] = [];
  const frozenPrices = {
    playerA: 1.23,
    playerB: 1.23,
    tie: 10.25,
    pairPlus: {
      pair: 1.23,
      color: 4.39,
      sequence: 6.15,
      pureSequence: 10.25,
      trail: 10.25,
    },
  };
  const config = {
    enabled: true,
    houseEdge: 0.15,
    maxMultiplier: 10.25,
    minStakePaise: options.min ?? "1000",
    maxStakePaise: "1000000",
    bettingWindowMs: 6000,
    revealDurationMs: 9000,
    settleDurationMs: 5000,
    payouts: { ...frozenPrices, playerA: 1.69 },
  };
  const outcome = {
    handACards: [0, 13, 26],
    handBCards: [9, 24, 38],
    handA: { category: "trail", score: 6 },
    handB: { category: "highCard", score: 1 },
    winner: "playerA",
  };
  let snapshot: Record<string, any> = {
    roundId: "betting-test-1",
    gameCode: game,
    phase: "betting",
    now: Date.now(),
    bettingEndsAt: 0,
    revealEndsAt: 0,
    settleEndsAt: 0,
    serverSeedHash: "test",
    clientSeed: "test",
    nonce: 1,
    config: {
      ...config,
      maxStakePaise: options.max ?? "1000000",
      teenPattiPayouts: frozenPrices,
    },
    outcome: null,
    serverSeed: null,
    totalStake: "0",
    playerCount: 0,
    liveBets: [],
    myBets: [],
    recent: [],
  };
  await page.addInitScript(() =>
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({ settings: { onboarded: true, sound: false } }),
    ),
  );
  await page.routeWebSocket("**/ws", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      if (m.op === "subscribe")
        ws.send(JSON.stringify({ op: "subscribed", topic: m.topic }));
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me")
      body = {
        id: "bet-audit",
        email: "bet@example.test",
        displayName: "Bet audit",
        role: "player",
      };
    else if (path === `/api/${game}/config` || path.includes("/config/"))
      body = config;
    else if (path === `/api/${game}/round`) {
      if (!delivered) {
        const now = Date.now();
        snapshot = {
          ...snapshot,
          bettingEndsAt: now + 6000,
          revealEndsAt: now + 15000,
          settleEndsAt: now + 20000,
        };
        delivered = true;
      }
      body = { ...snapshot, now: Date.now() };
    } else if (
      path === `/api/${game}/${game === "teen-patti" ? "deal" : "bet"}`
    ) {
      const payload = route.request().postDataJSON();
      requests.push(payload);
      if (options.reject)
        return route.fulfill({
          status: 400,
          json: { detail: "Betting is closed for this round" },
        });
      const totalStake = payload.bets
        .reduce(
          (sum: bigint, b: { amountPaise: string }) =>
            sum + BigInt(b.amountPaise),
          0n,
        )
        .toString();
      const slipId = `slip-${requests.length}`;
      snapshot = {
        ...snapshot,
        myBets: [
          ...snapshot.myBets,
          {
            slipId,
            bets: payload.bets,
            totalStake,
            status: "pending",
            payoutAmount: "0",
            auditRoundId: null,
          },
        ],
      };
      body = { roundId: payload.roundId, totalStake, slipId };
    } else if (path.includes("/wallet/"))
      body = {
        balance: options.balance ?? "1000000",
        currency: "INR",
        scope: game,
      };
    else if (path.endsWith("/recent") || path === "/api/game/registry")
      body = [];
    await route.fulfill({ json: body });
  });
  await page.goto(`/${game}`);
  await expect(page.getByTestId("spot-playerA")).toBeEnabled();
  await page.getByTestId("chip-100").click();
  const emit = (payload: object) =>
    socket.send(
      JSON.stringify({ op: "event", topic: `table-rounds:${game}`, payload }),
    );
  return {
    requests,
    async next() {
      const now = Date.now();
      snapshot = {
        ...snapshot,
        roundId: "betting-test-2",
        phase: "betting",
        bettingEndsAt: now + 6000,
        revealEndsAt: now + 15000,
        settleEndsAt: now + 20000,
        outcome: null,
        myBets: [],
      };
      emit({
        type: "phase",
        roundId: snapshot.roundId,
        phase: "betting",
        endsAt: snapshot.bettingEndsAt,
        ts: now,
        serverSeedHash: "test",
        clientSeed: "test",
        nonce: 2,
      });
      await expect(page.getByTestId("spot-playerA")).toBeEnabled();
    },
    settle(payout: string) {
      const now = Date.now();
      snapshot = {
        ...snapshot,
        phase: "settling",
        outcome,
        bettingEndsAt: now - 9000,
        revealEndsAt: now,
        settleEndsAt: now + 5000,
        myBets: snapshot.myBets.map((b: object) => ({
          ...b,
          status: "settled",
          payoutAmount: payout,
        })),
      };
      emit({
        type: "result",
        roundId: snapshot.roundId,
        outcome,
        serverSeed: "test",
      });
      emit({
        type: "phase",
        roundId: snapshot.roundId,
        phase: "settling",
        endsAt: snapshot.settleEndsAt,
        ts: now,
        serverSeedHash: "test",
        clientSeed: "test",
        nonce: 1,
      });
    },
  };
}

for (const game of ["teen-patti", "teen-patti-live"] as const) {
  for (const constraint of ["balance", "max"] as const) {
    test(`${game}: ${constraint} limit, frozen odds and one exact debit request`, async ({
      page,
    }) => {
      const f = await table(page, game, { [constraint]: "15000" });
      await expect(page.getByTestId("spot-playerA")).toContainText("1.23");
      await page.getByTestId("spot-playerA").click();
      await page.getByTestId("spot-playerA").click();
      await expect(
        page.getByText("Check your balance and table limits", { exact: true }),
      ).toBeVisible();
      await expect.poll(() => f.requests.length, { timeout: 10000 }).toBe(1);
      expect(f.requests[0]).toEqual({
        roundId: "betting-test-1",
        bets: [{ type: "playerA", amountPaise: "10000" }],
      });
      await expect(page.getByTestId("spot-playerA")).toBeDisabled();
      await page.waitForTimeout(1000);
      expect(f.requests).toHaveLength(1);
    });
  }
  test(`${game}: below-minimum draft never debits`, async ({ page }) => {
    const f = await table(page, game, { min: "20000" });
    await page.getByTestId("spot-playerA").click();
    await expect(
      page.getByText(/Check balance and table limits \(minimum/),
    ).toBeVisible({ timeout: 10000 });
    expect(f.requests).toHaveLength(0);
  });
  test(`${game}: rejected bet is sent once and never carried into the next round`, async ({
    page,
  }) => {
    const f = await table(page, game, { reject: true });
    await page.getByTestId("spot-playerB").click();
    await expect.poll(() => f.requests.length, { timeout: 10000 }).toBe(1);
    await expect(
      page.getByText("Betting is closed for this round", { exact: true }),
    ).toBeVisible();
    await f.next();
    await expect(page.getByTestId("spot-playerA")).toBeDisabled({
      timeout: 10000,
    });
    expect(f.requests).toHaveLength(1);
  });
}

test("20/20: a mixed bet with a partial return shows net loss", async ({
  page,
}) => {
  const f = await table(page, "teen-patti");
  await page.getByTestId("spot-playerA").click();
  await page.getByTestId("spot-playerB").click();
  await expect.poll(() => f.requests.length, { timeout: 10000 }).toBe(1);
  expect(f.requests[0].bets).toHaveLength(2);
  f.settle("12300");
  await expect(page.getByTestId("text-result-payout")).toHaveText(
    "−₹77.00 net",
  );
  await expect(page.getByText(/Net win/)).toHaveCount(0);
});
