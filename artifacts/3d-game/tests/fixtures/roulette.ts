import { expect, type Page, type WebSocketRoute } from "@playwright/test";



// All traffic is mocked: these presentation tests never create accounts or bets.
export async function studio(
  page: Page,
  options: { late?: boolean; bettingMs?: number; balance?: string } = {},
) {
  let socket: WebSocketRoute;
  let ready!: () => void;
  const connected = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const now = Date.now();
  const config = {
    enabled: true,
    houseEdge: 0.027,
    maxMultiplier: 36,
    roulettePayoutBase: 36,
    payoutBase: 36,
    minStakePaise: "1000",
    maxStakePaise: "50000000",
    maxBetsPerSpin: 40,
    bettingWindowMs: 25000,
    revealDurationMs: 5000,
    settleDurationMs: 5000,
  };
  let snapshot = {
    roundId: "studio-round-1",
    gameCode: "roulette",
    phase: options.late ? "settling" : "betting",
    now,
    bettingEndsAt: now + (options.bettingMs ?? 120000),
    revealEndsAt: now + 125000,
    settleEndsAt: now + 130000,
    serverSeedHash: "test",
    clientSeed: "test",
    nonce: 1,
    outcome: options.late
      ? { pocket: 17 }
      : (null as { pocket: number } | null),
    serverSeed: null,
    totalStake: "0",
    playerCount: 0,
    config,
    liveBets: [],
    myBets: [] as { slipId: string; bets: Bet[]; totalStake: string; status: string; payoutAmount: string }[],
    recent: [],
  };
  let balance = options.balance ?? "100000";
  type Bet = { type: string; numbers?: number[]; selection?: number; amountPaise: string };
  const requests: { roundId: string; bets: Bet[] }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({ settings: { onboarded: true, sound: false } }),
    ),
  );
  await page.routeWebSocket("**/ws", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.op === "subscribe") {
        ws.send(JSON.stringify({ op: "subscribed", topic: message.topic }));
        if (message.topic === "table-rounds:roulette") ready();
      }
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me")
      body = {
        id: "studio-preview",
        email: "studio@example.test",
        displayName: "Preview",
        role: "player",
      };
    else if (path === "/api/game/registry") body = [];
    else if (path === "/api/roulette/config") body = config;
    else if (path === "/api/roulette/round")
      body = { ...snapshot, now: Date.now() };
    else if (path === "/api/roulette/recent") body = [];
    else if (path === "/api/roulette/spin" && route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      requests.push(input);
      const totalStake = input.bets.reduce((sum: bigint, b: Bet) => sum + BigInt(b.amountPaise), 0n).toString();
      const slipId = "mock-slip-" + requests.length;
      snapshot.myBets.push({ slipId, bets: input.bets, totalStake, status: "pending", payoutAmount: "0" });
      balance = (BigInt(balance) - BigInt(totalStake)).toString();
      body = { slipId, roundId: snapshot.roundId, betId: slipId, totalStake };
    }
    else if (path.includes("/wallet/"))
      body = { balance, currency: "INR", scope: "roulette" };
    else if (path.includes("/config/"))
      body = { ...config, gameCode: "roulette" };
    await route.fulfill({ json: body });
  });
  await page.goto("/roulette");
  await connected;
  await expect(page.getByTestId("roulette-dealer-table")).toBeVisible();
  const emit = (payload: object) =>
    socket.send(
      JSON.stringify({ op: "event", topic: "table-rounds:roulette", payload }),
    );
  return {
    errors,
    requests,
    betting(id: string, duration = 4500) {
      const now = Date.now();
      snapshot = {
        ...snapshot,
        myBets: id === snapshot.roundId ? snapshot.myBets : [],
        roundId: id,
        phase: "betting",
        bettingEndsAt: now + duration,
        revealEndsAt: now + duration + 5000,
        settleEndsAt: now + duration + 10000,
        outcome: null,
      };
      emit({
        type: "phase",
        roundId: id,
        phase: "betting",
        endsAt: snapshot.bettingEndsAt,
        serverSeedHash: "test",
        clientSeed: "test",
        nonce: 2,
        ts: now,
      });
    },
    reveal(pocket: number, duration = 5000) {
      const now = Date.now();
      snapshot = {
        ...snapshot,
        phase: "reveal",
        revealEndsAt: now + duration,
        settleEndsAt: now + duration + 5000,
        outcome: { pocket },
      };
      emit({
        type: "phase",
        roundId: snapshot.roundId,
        phase: "reveal",
        endsAt: snapshot.revealEndsAt,
        ts: now,
      });
      emit({
        type: "result",
        roundId: snapshot.roundId,
        outcome: { pocket },
        serverSeed: "test",
      });
    },
    repeatResult() {
      emit({
        type: "result",
        roundId: snapshot.roundId,
        outcome: snapshot.outcome,
        serverSeed: "test",
      });
    },
  };
}
