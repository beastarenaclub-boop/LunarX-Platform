import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { DEMO_COINS, DemoSessions, type DemoSession } from "../sessions";
import { INSTANT_COLLECTION, progressive } from "@workspace/api-zod/instant-collection";

let worker: Worker;
let port: number;
const secret = randomUUID();
const sessions = new DemoSessions();
const callbacks = new Map<string, (message: { ok: boolean }) => void>();
const codes = ["mines", "dice", "plinko", "jetx", "fury", "roulette", "baccarat", "blackjack", "teen-patti", "andar-bahar", "lucky-7"];

before(async () => {
  worker = new Worker(new URL("../../../dist/demo-worker.mjs", import.meta.url), {
    // Deliberately unusable: the built demo worker must never connect to PG.
    env: { NODE_ENV: "production", LOG_LEVEL: "silent", DATABASE_URL: "postgresql://invalid@127.0.0.1:1/forbidden" },
    execArgv: [], workerData: { secret, configs: codes.map(gameCode => ({ gameCode, enabled: true })) },
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Worker did not become ready")), 30_000);
    worker.on("error", reject);
    worker.on("message", message => {
      if (message.ready) { port = message.port; clearTimeout(timer); resolve(); }
      else if (message.reply) { callbacks.get(message.reply)?.(message); callbacks.delete(message.reply); }
    });
  });
});
after(async () => { await worker?.terminate(); });

async function command(action: string, data: object) {
  const requestId = randomUUID();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Worker ${action} timed out`)), 10_000);
    callbacks.set(requestId, message => { clearTimeout(timer); message.ok ? resolve() : reject(new Error(`Worker ${action} failed`)); });
    worker.postMessage({ requestId, action, ...data });
  });
}
async function visitor() {
  const session = sessions.create();
  await command("register", { session });
  return session;
}
async function request(session: DemoSession, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-demo-worker-key": secret, "x-demo-token": session.token, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 150); }
  return { status: response.status, data };
}
async function ok(session: DemoSession, path: string, body?: unknown, headers?: Record<string, string>) {
  const result = await request(session, path, body, headers);
  assert.equal(result.status, 200, `${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}

test("real instant bets settle, wallet stays unlimited, and accounts cannot read another hand", async () => {
  const a = await visitor(), b = await visitor();
  const dice = await ok(a, "dice/roll", { stakeAmount: "10000", target: 50, direction: "under" });
  assert.equal(typeof dice.didWin, "boolean");
  assert.match(dice.payoutAmount, /^\d+$/);
  const plinko = await ok(a, "plinko/drop", { stakeAmount: "10000", rows: 8, risk: "low" });
  assert.equal(plinko.path.length, 8);
  const mines = await ok(a, "mines/place", { stakeAmount: "10000", mineCount: 3 });
  assert.equal(mines.serverSeed, null);
  assert.equal(mines.mineIndexes, null);
  assert.equal((await request(b, `mines/${mines.id}`)).status, 404);
  const reveal = await ok(a, `mines/${mines.id}/reveal`, { cellIndex: 0 });
  if (reveal.status === "active") await ok(a, `mines/${mines.id}/cashout`, {});
  const balances = await ok(a, "wallet/balances");
  assert.ok(Object.values(balances.balances).every(value => value === String(DEMO_COINS)));
  assert.equal((await request(a, "dice/roll", { stakeAmount: "-1", target: 50, direction: "under" })).status, 400);
  await command("remove", { token: a.token });
  assert.equal((await request(a, "wallet/balances")).status, 401);
  // Re-registering the same synthetic identity must not resurrect old hands.
  await command("register", { session: a });
  assert.equal((await request(a, `mines/${mines.id}`)).status, 404);
});

test("all shared table engines accept actual demo wagers", { timeout: 90_000 }, async () => {
  const tableBets = [
    ["roulette", "spin", { type: "red", amountPaise: "10000" }],
    ["baccarat", "deal", { type: "player", amountPaise: "10000" }],
    ["teen-patti", "deal", { type: "playerA", amountPaise: "10000" }],
    ["teen-patti-live", "bet", { type: "playerA", amountPaise: "10000" }],
    ["andar-bahar", "deal", { type: "andar", amountPaise: "10000" }],
    ["lucky-7", "bet", { type: "under", amountPaise: "10000" }],
    ["lucky-7-live", "bet", { spot: "down", amountPaise: "10000" }],
    ["wheel-2-live", "bet", { spot: "1", amountPaise: "10000" }],
    ["7up7down", "bet", { spot: "up", amount: "10000" }],
    ["crazy-time", "bet", { type: "1", amountPaise: "10000" }],
    ["vegetable-bowl", "bet", { type: "normal", amountPaise: "10000" }],
    ["blackjack", "deal", null],
  ] as const;
  for (const [code, action, bet] of tableBets) {
    const session = await visitor();
    let round = await ok(session, `${code}/round`);
    const until = Date.now() + 65_000;
    while ((!round || round.phase !== "betting") && Date.now() < until) {
      await new Promise(r => setTimeout(r, 250)); round = await ok(session, `${code}/round`);
    }
    assert.equal(round?.phase, "betting", code);
    const body = bet ? { roundId: round.roundId, bets: [bet] } : { roundId: round.roundId, stakeAmount: "10000" };
    await ok(session, `${code}/${action}`, body);
    const after = await ok(session, `${code}/round`);
    assert.ok(JSON.stringify(after).includes(session.id) || after.myBets?.length || after.myBet, `${code}: accepted wager visible`);
  }
});

test("expired and untrusted sessions cannot play or use financial endpoints", async () => {
  const session = await visitor();
  for (const path of ["payments/withdrawals", "payments/deposits", "network/transfers", "admin/users", "profile", "kyc", "launcher"]) {
    assert.equal((await request(session, path, {})).status, 403, path);
  }
  assert.equal((await request(session, "wallet/balances", undefined, { "x-demo-worker-key": "forged" })).status, 403);
  const expiring = { ...sessions.create(), expiresAt: Date.now() + 300 };
  await command("register", { session: expiring });
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal((await request(expiring, "dice/roll", { stakeAmount: "10000", target: 50, direction: "under" })).status, 401);
});

test("every instant collection game and both crash games accept wagers", async () => {
  for (const game of INSTANT_COLLECTION.filter(g => g.code !== "7up7down")) {
    const session = await visitor();
    let round = await ok(session, `instant/${game.code}/place`, {
      requestId: randomUUID(), stakeAmount: "10000", clientSeed: "demo-test-client",
      options: { difficulty: "easy", mines: 3, choice: game.kind === "fishing" ? "cast" : "heads" },
    });
    assert.ok(round.id, game.code);
    if (progressive(game.kind)) {
      round = await ok(session, `instant/${game.code}/${round.id}/move`, {
        action: "reveal", expectedStep: 0, cell: 0, actionId: randomUUID(),
      });
      if (round.status === "active") await ok(session, `instant/${game.code}/${round.id}/move`, {
        action: "cashout", expectedStep: round.step, cell: 0, actionId: randomUUID(),
      });
    }
  }
  for (const gameCode of ["jetx", "fury"]) {
    const session = await visitor();
    const round = await ok(session, `crash/${gameCode}`);
    assert.equal(round.crashPoint, null);
    const bet = await ok(session, "bets/place", { gameCode, roundId: round.id, stakeAmount: "10000", autoCashOut: 1.01 });
    assert.ok(bet.id);
  }
  const session = await visitor();
  const chicken = await ok(session, "chicken-road/place", { requestId: randomUUID(), stakeAmount: "10000", clientSeed: "demo-test-client", difficulty: "easy" });
  assert.equal(chicken.serverSeed, null);
  const stepped = await ok(session, `chicken-road/${chicken.id}/step`, { expectedStep: 0 });
  assert.ok(stepped.id);
});

test("rummy, trading, lottery, dragon tables and racing remain playable", { timeout: 180_000 }, async () => {
  async function waitFor(session: DemoSession, path: string, ready: (value: any) => boolean, timeout = 90_000) {
    const deadline = Date.now() + timeout;
    do {
      const state = await ok(session, path);
      if (ready(state)) return state;
      await new Promise(r => setTimeout(r, 500));
    } while (Date.now() < deadline);
    throw new Error(`${path} did not open betting`);
  }
  const player = await visitor();
  const rummy = await ok(player, "rummy/table");
  const playing = await ok(player, "rummy/action", { version: rummy.version, action: { type: "start", stake: 50 } });
  assert.notEqual(playing.table.phase, "ready");
  const dragons = await waitFor(player, "dragon-tiger/table", s => s.round.phase === "betting");
  await ok(player, "dragon-tiger/bet", { roundId: dragons.round.id, spots: { dragon: 10, tiger: 0, tie: 0 } });
  const oneDay = await waitFor(player, "dragon-tiger-one-day/table", s => s.round.phase === "first");
  await ok(player, "dragon-tiger-one-day/bet", { roundId: oneDay.round.id, stage: "first", quoteId: oneDay.quoteId,
    selections: [{ market: "dragon", amountPaise: "10000" }] });
  for (const [game, venueId, selection] of [["horse-racing", "royal", "horseId"], ["bike-racing", "apex", "bikeId"]]) {
    const state = await waitFor(player, `${game}/game/live`, s => s.race.phase === "betting");
    await ok(player, `${game}/game/live`, { roundId: state.race.id, requestId: randomUUID(), venueId,
      bets: [{ [selection]: 1, amountPaise: "10000" }] });
  }
  const wingo = await waitFor(player, "wingo/state", s => s.round.ends - s.serverTime > s.lockSeconds * 1000 + 1000);
  await ok(player, "wingo/bets", { duration: 30, period: wingo.round.period, pick: "green", stake: 10000, request: randomUUID() });
  const forex = await waitFor(player, "forex/state", s => s.round.phase === "open");
  await ok(player, "forex/trades", { asset: "gold", side: "buy", amount: 100, roundId: forex.round.id, requestId: randomUUID() });
  const lottery = await ok(player, "lottery/bootstrap");
  const draw = lottery.draws.find((d: any) => d.status === "open" && d.closes > Date.now() + 10000);
  const ticket = await ok(player, "lottery/tickets", { drawId: draw.id, game: "2D", lines: [{ series: "JP10", number: "07", quantity: 1 }] }, { "idempotency-key": randomUUID() });
  assert.ok(ticket.id);
  const prizes = await ok(player, "prize-lotto/state");
  const prizeDraw = prizes.draws.find((d: any) => d.status === "open" && d.closes > Date.now() + 10000);
  const prize = await ok(player, "prize-lotto/tickets", { drawId: prizeDraw.id, reward: "cashback", amount: 100 }, { "idempotency-key": randomUUID() });
  assert.ok(prize.id);
});

test("all five virtual sports place bets using the required client headers", { timeout: 100_000 }, async () => {
  const player = await visitor();
  let state = await ok(player, "virtual-sports/state");
  const deadline = Date.now() + 85_000;
  while (state.rounds[0].phase !== "betting" && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500)); state = await ok(player, "virtual-sports/state");
  }
  for (const sport of ["football", "cricket", "basketball", "tennis", "formula"]) {
    const round = state.rounds.find((r: any) => r.sport === sport && r.phase === "betting");
    assert.ok(round, sport);
    await ok(player, "virtual-sports/bets", { roundId: round.id, sport, choice: 0, stake: 100, requestId: randomUUID() },
      { "x-sports-client": "1", "x-sports-wallet": "1" });
  }
});
