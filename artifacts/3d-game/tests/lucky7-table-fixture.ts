import { type Locator, type Page, type WebSocketRoute } from "@playwright/test";

/** Observe the loop inside the browser so a slow test runner cannot miss it. */
export async function crossNativeLoop(video: Locator) {
  return video.evaluate(element => new Promise<number>((resolve, reject) => {
    const player = element as HTMLVideoElement;
    const cleanup = () => {
      clearTimeout(timeout);
      player.removeEventListener("seeked", observe);
      player.removeEventListener("timeupdate", observe);
    };
    const observe = () => {
      if (player.currentTime < player.duration / 2) {
        const time = player.currentTime;
        cleanup(); resolve(time);
      }
    };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Native video did not loop")); }, 10000);
    player.addEventListener("seeked", observe);
    player.addEventListener("timeupdate", observe);
    player.currentTime = player.duration - .18;
  }));
}

const config = {
  enabled: true, houseEdge: 0.03, maxMultiplier: 12,
  minStakePaise: "1000", maxStakePaise: "50000000",
  bettingWindowMs: 20000, revealDurationMs: 5000, settleDurationMs: 5000,
};

export async function table(page: Page, lateJoin = false, snapshotClockSkew = 0, options: { sound?: boolean; bettingMs?: number; enabled?: boolean } = {}) {
  let socket: WebSocketRoute;
  let connected!: () => void;
  const socketReady = new Promise<void>(resolve => { connected = resolve; });
  const now = Date.now();
  let snapshot = {
    roundId: "dealer-test-round", gameCode: "lucky-7", phase: "betting", now,
    bettingEndsAt: now + (options.bettingMs ?? 20000), revealEndsAt: now + (options.bettingMs ?? 20000) + 5000, settleEndsAt: now + (options.bettingMs ?? 20000) + 10000,
    serverSeedHash: "test", clientSeed: "test", nonce: 1,
    outcome: null as null | { dice: number[]; total: number }, serverSeed: null,
    totalStake: "0", playerCount: 0, config, liveBets: [],
    myBets: [] as { slipId: string; totalStake: string; bets: object; status: string; payoutAmount: string; auditRoundId: string | null }[],
    recent: [{ roundId: "previous-round", outcome: { dice: [1, 4], total: 5 }, settledAt: null }],
  };
  if (lateJoin) snapshot = { ...snapshot, phase: "reveal", revealEndsAt: now + 700, outcome: { dice: [3, 4], total: 7 } };
  let balance = 100000n;
  const submissions: { bets: { type: string; amountPaise: string }[] }[] = [];
  const acceptBet = (bets: { type: string; amountPaise: string }[]) => {
    submissions.push({ bets });
    const totalStake = bets.reduce((total, bet) => total + BigInt(bet.amountPaise), 0n).toString();
    const slipId = `instant-slip-${submissions.length}`;
    balance -= BigInt(totalStake);
    snapshot = { ...snapshot, myBets: [...snapshot.myBets, { slipId, totalStake, bets, status: "pending", payoutAmount: "0", auditRoundId: null }] };
    return { slipId, roundId: snapshot.roundId, totalStake, betId: slipId, gameCode: "lucky-7", phase: "betting", bettingEndsAt: new Date(snapshot.bettingEndsAt).toISOString() };
  };
  await page.addInitScript(sound => localStorage.setItem("aviator:v1", JSON.stringify({ settings: { onboarded: true, sound } })), options.sound ?? false);
  await page.routeWebSocket("**/ws", ws => {
    socket = ws;
    ws.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.op === "subscribe") {
        ws.send(JSON.stringify({ op: "subscribed", topic: message.topic }));
        if (message.topic === "table-rounds:lucky-7") connected();
      }
    });
  });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me") body = { id: "dealer-preview", email: "dealer@example.test", displayName: "Preview", role: "player" };
    else if (path === "/api/game/registry") body = [];
    else if (path === "/api/lucky-7/config") body = { ...config, enabled: options.enabled ?? true, maxBetsPerRound: 3, combinations: 36, winningCombinations: { under: 15, exactly: 6, over: 15 }, payouts: { under: 2, exactly: 12, over: 2 } };
    else if (path === "/api/lucky-7/round") body = { ...snapshot, now: Date.now() + snapshotClockSkew };
    else if (path === "/api/lucky-7/recent") body = [];
    else if (path === "/api/lucky-7/bet" && route.request().method() === "POST") body = acceptBet(route.request().postDataJSON().bets);
    else if (path.includes("/wallet/")) body = { balance: balance.toString(), currency: "INR", scope: "lucky-7" };
    else if (path.includes("/config/")) body = { ...config, gameCode: "lucky-7" };
    await route.fulfill({ json: body });
  });
  await page.goto("/lucky-7");
  await socketReady;
  const emit = (payload: object) => socket.send(JSON.stringify({ op: "event", topic: "table-rounds:lucky-7", payload }));
  return {
    submissions,
    acceptBet,
    reveal(duration = 5000, dice: [number, number] = [3, 4]) {
      const now = Date.now();
      snapshot = { ...snapshot, phase: "reveal", bettingEndsAt: now, revealEndsAt: now + duration, settleEndsAt: now + duration + 5000, outcome: { dice, total: dice[0] + dice[1] } };
      emit({ type: "phase", roundId: snapshot.roundId, phase: "reveal", endsAt: snapshot.revealEndsAt, serverSeedHash: "test", clientSeed: "test", nonce: 1, ts: now });
      emit({ type: "result", roundId: snapshot.roundId, outcome: snapshot.outcome, serverSeed: "test" });
    },
    repeatResult() { emit({ type: "result", roundId: snapshot.roundId, outcome: snapshot.outcome, serverSeed: "test" }); },
    settle(payout = "12000", status = "settled", duration = 5000) {
      const now = Date.now();
      snapshot = { ...snapshot, phase: "settling", settleEndsAt: now + duration,
        myBets: snapshot.myBets.length
          ? snapshot.myBets.map((bet, index) => ({ ...bet, status, payoutAmount: index === 0 ? payout : "0" }))
          : [{ slipId: "preview-slip", totalStake: "1000", bets: [{ type: "exactly", amountPaise: "1000" }], status, payoutAmount: payout, auditRoundId: null }] };
      emit({ type: "phase", roundId: snapshot.roundId, phase: "settling", endsAt: snapshot.settleEndsAt, ts: now });
      emit({ type: "settled", roundId: snapshot.roundId });
    },
    repeatSettlement() { emit({ type: "settled", roundId: snapshot.roundId }); },
    nextBetting(id = "dealer-next-round", duration = options.bettingMs ?? 20000) {
      const now = Date.now();
      snapshot = { ...snapshot, roundId: id, phase: "betting", bettingEndsAt: now + duration, revealEndsAt: now + duration + 5000, settleEndsAt: now + duration + 10000, myBets: [], outcome: null };
      emit({ type: "phase", roundId: snapshot.roundId, phase: "betting", endsAt: snapshot.bettingEndsAt, serverSeedHash: "test", clientSeed: "test", nonce: 2, ts: now });
    },
  };
}
