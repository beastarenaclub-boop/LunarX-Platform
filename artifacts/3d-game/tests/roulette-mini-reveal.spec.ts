import { test, expect, type WebSocketRoute } from "@playwright/test";

/**
 * Mini Roulette must not show a win before the ball has landed.
 *
 * The server settles a round (credits the wallet and pushes the new balance)
 * at the end of its reveal window, but this cabinet only starts the spin when
 * the on-screen clock reaches zero — some seconds later. The Score used to take
 * the pushed balance at once, so the player read their win off it before the
 * wheel had even started turning. All traffic is mocked.
 */
test("the Score holds the win back until the ball lands", async ({ page }) => {
  test.setTimeout(90_000);
  const user = "reveal-preview";
  const stake = { type: "straight", selection: [7], amountPaise: "1000" };
  const config = {
    bettingWindowMs: 25_000,
    revealDurationMs: 3_000,
    settleDurationMs: 3_000,
    maxMultiplier: 36,
    houseEdge: 0.027,
  };
  /**
   * The close, fixed on the FIRST snapshot read rather than at test start: a
   * cold dev server can take many seconds to serve the page, and deadlines set
   * before it answered would already be in the past.
   */
  let t0 = 0;
  const at = (ms: number) => page.waitForTimeout(Math.max(0, t0 + ms - Date.now()));
  let round = {
    roundId: "mini-r1",
    phase: "betting",
    outcome: null as { pocket: number } | null,
    myBets: [{ slipId: "slip-1", bets: [stake], totalStake: "1000", status: "pending", payoutAmount: "0", auditRoundId: null }],
    recent: [] as { roundId: string; outcome: unknown; settledAt: string | null }[],
    offset: 0,
  };
  const snapshot = () => {
    if (!t0) t0 = Date.now() + 6_000;
    const close = t0 + round.offset;
    return {
      ...round,
      gameCode: "roulette-mini",
      now: Date.now(),
      bettingEndsAt: close,
      revealEndsAt: close + config.revealDurationMs,
      settleEndsAt: close + config.revealDurationMs + config.settleDurationMs,
      serverSeedHash: "test", clientSeed: "test", nonce: 1, serverSeed: null,
      totalStake: "1000", playerCount: 1, config, liveBets: [],
    };
  };
  // ₹12,345 left after the ₹10 stake; a straight pays 36x, so the win is 360.
  let balance = "1234500";
  let pendingWin: { amountPaise: string; roundId: string } | null = null;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  let socket!: WebSocketRoute;
  let ready!: () => void;
  const connected = new Promise<void>((r) => (ready = r));
  await page.addInitScript(() =>
    localStorage.setItem("aviator:v1", JSON.stringify({ settings: { onboarded: true, sound: false } })),
  );
  await page.routeWebSocket("**/ws", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      if (m.op !== "subscribe") return;
      ws.send(JSON.stringify({ op: "subscribed", topic: m.topic }));
      if (m.topic === "table-rounds:roulette-mini") ready();
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me") body = { id: user, email: "preview@example.test", displayName: "Preview", role: "player" };
    else if (path === "/api/game/registry") body = [];
    else if (path === "/api/roulette-mini/round") body = snapshot();
    else if (path === "/api/roulette-mini/config")
      body = {
        enabled: true, houseEdge: 0.027, maxMultiplier: 36, maxStakePaise: "50000000", minStakePaise: "500", maxBetsPerSlip: 40,
        wheel: { code: "roulette-mini", numberCount: 18, pocketCount: 20, doubleZero: 1, third: 6, half: 9 },
        paytable: {}, limits: {},
      };
    else if (path === "/api/roulette-mini/win")
      body = { pendingWin, layout: pendingWin ? { pocket: 7, bets: [{ ...stake, payoutPaise: "36000", didWin: true }] } : null };
    else if (path === "/api/roulette-mini/win/take") {
      pendingWin = null;
      body = { takenPaise: "36000" };
    } else if (path === "/api/roulette-mini/recent") body = [];
    else if (path === "/api/reports/gameresults") body = { items: [], nextCursor: null };
    else if (path.includes("/wallet/")) body = { balance, currency: "INR", scope: "lunar" };
    await route.fulfill({ json: body });
  });

  await page.goto("/roulette-mini");
  await connected;
  const emit = (topic: string, payload: object) => socket.send(JSON.stringify({ op: "event", topic, payload }));
  const table = (payload: object) => emit("table-rounds:roulette-mini", payload);
  const phase = (roundId: string, name: string, endsAt: number) =>
    table({ type: "phase", roundId, phase: name, endsAt, serverSeedHash: "test", clientSeed: "test", nonce: 1, ts: Date.now() });
  const score = (points: string) => page.getByText(points, { exact: true });

  await expect(score("12345")).toHaveCount(1);
  expect(Date.now()).toBeLessThan(t0);

  // Betting closes.
  await at(0);
  round = { ...round, phase: "reveal" };
  phase("mini-r1", "reveal", t0 + 3_000);

  // The outcome is disclosed for the landing; the wheel will not turn until
  // the clock reaches zero at the end of the settle window.
  await at(500);
  round = { ...round, outcome: { pocket: 7 } };
  table({ type: "result", roundId: "mini-r1", outcome: { pocket: 7 }, serverSeed: "test" });

  // Settlement: the server pays the win and pushes the new balance.
  await at(3_000);
  balance = "1270500";
  pendingWin = { amountPaise: "36000", roundId: "mini-r1" };
  round = {
    ...round,
    phase: "settling",
    myBets: [{ slipId: "slip-1", bets: [stake], totalStake: "1000", status: "settled", payoutAmount: "36000", auditRoundId: null }],
  };
  phase("mini-r1", "settling", t0 + 6_000);
  emit(`wallet:${user}`, { type: "balance", balance });
  table({ type: "settled", roundId: "mini-r1" });

  // The wheel has not even started: nothing may show the 360 yet.
  while (Date.now() < t0 + 5_800) {
    await expect(score("12705")).toHaveCount(0, { timeout: 100 });
    await expect(score("12345")).toHaveCount(1, { timeout: 100 });
    await page.waitForTimeout(150);
  }

  // The next round opens and the wheel spins into it.
  await at(6_000);
  round = {
    roundId: "mini-r2",
    phase: "betting",
    outcome: null,
    myBets: [],
    recent: [{ roundId: "mini-r1", outcome: { pocket: 7 }, settledAt: new Date(t0 + 3_000).toISOString() }],
    offset: 6_000 + config.bettingWindowMs,
  };
  phase("mini-r2", "betting", t0 + round.offset);

  // Mid-spin (a half-second zoom, then six seconds of ring): still hidden.
  await at(9_500);
  await expect(score("12705")).toHaveCount(0);
  await expect(score("12345")).toHaveCount(1);

  // The ball lands: the win is announced, taken, and counted into the Score.
  await expect(score("12705")).toHaveCount(1, { timeout: 15_000 });
  expect(errors).toEqual([]);
});
