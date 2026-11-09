import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { DemoSessions } from "../sessions";

test("Speed Auto Roulette: isolated rounds, limits, hidden outcomes and exact settlement", { timeout: 90000 }, async () => {
  const secret = randomUUID(), sessions = new DemoSessions(), session = sessions.create();
  const worker = new Worker(new URL("../../../dist/demo-worker.mjs", import.meta.url), {
    env: { NODE_ENV: "production", LOG_LEVEL: "silent", DATABASE_URL: "postgresql://invalid@127.0.0.1:1/forbidden" }, execArgv: [],
    workerData: { secret, configs: [{ gameCode: "speed-auto-roulette", enabled: true, bettingWindowMs: 8000, revealDurationMs: 5000, settleDurationMs: 8000 }] },
  });
  try {
    const port = await new Promise<number>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Demo worker startup timed out")), 40000); worker.once("error", reject); worker.on("message", m => { if (m.ready) { clearTimeout(timer); resolve(m.port); } }); });
    await new Promise<void>((resolve, reject) => { const requestId = randomUUID(); const timer = setTimeout(() => reject(new Error("Demo registration timed out")), 10000); worker.on("message", m => { if (m.reply === requestId) { clearTimeout(timer); m.ok ? resolve() : reject(new Error("Registration failed")); } }); worker.postMessage({ requestId, action: "register", session }); });
    const request = async (path: string, body?: unknown) => { const response = await fetch(`http://127.0.0.1:${port}/api/${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-demo-worker-key": secret, "x-demo-token": session.token }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) }); return { status: response.status, data: await response.json() as any }; };
    const getRound = async () => { const r = await request("speed-auto-roulette/round"); assert.equal(r.status, 200); return r.data; };
    const cfg = await request("speed-auto-roulette/config"); assert.equal(cfg.status, 200); assert.equal(cfg.data.payoutBase, 36);
    let round = await getRound(); const until = Date.now() + 30000;
    while ((!round || round.phase !== "betting" || round.bettingEndsAt - round.now < 4500) && Date.now() < until) { await new Promise(r => setTimeout(r, 250)); round = await getRound(); }
    assert.equal(round.gameCode, "speed-auto-roulette"); assert.equal(round.phase, "betting"); assert.equal(round.outcome, null); assert.equal(round.serverSeed, null);
    const original = await request("roulette/round"); assert.notEqual(original.data?.roundId, round.roundId);
    const invalid = await request("speed-auto-roulette/spin", { roundId: round.roundId, bets: [{ type: "split", numbers: [1, 36], amountPaise: "1000" }] }); assert.equal(invalid.status, 400);
    const receipt = await request("speed-auto-roulette/spin", { roundId: round.roundId, bets: Array.from({ length: 37 }, (_, n) => ({ type: "straight", numbers: [n], amountPaise: "1000" })) });
    assert.equal(receipt.status, 200, JSON.stringify(receipt.data)); assert.equal(receipt.data.totalStake, "37000");
    const overCap = await request("speed-auto-roulette/spin", { roundId: round.roundId, bets: [{ type: "straight", numbers: [0], amountPaise: "2000000" }] }); assert.equal(overCap.status, 400);
    const stale = await request("speed-auto-roulette/spin", { roundId: "wrong-round", bets: [{ type: "red", amountPaise: "1000" }] }); assert.equal(stale.status, 400);
    const earlyCashout = await request(`bets/${receipt.data.betId}/cashout`, { multiplier: 36 }); assert.equal(earlyCashout.status, 400);
    const earlyLoss = await request(`bets/${receipt.data.betId}/lose`, { multiplier: 1 }); assert.equal(earlyLoss.status, 400);
    const id = round.roundId, deadline = Date.now() + 30000; let settled;
    while (Date.now() < deadline) { round = await getRound(); if (round.roundId === id) { settled = round.myBets.find((b: any) => b.slipId === receipt.data.slipId && b.status === "settled"); if (settled) break; } await new Promise(r => setTimeout(r, 250)); }
    assert.ok(settled, "Accepted slip must settle automatically"); assert.equal(settled.payoutAmount, "36000"); assert.ok(Number.isInteger(round.outcome.pocket));
    assert.equal((await request("speed-auto-roulette/spin", { roundId: id, bets: [{ type: "red", amountPaise: "1000" }] })).status, 400);
  } finally { await worker.terminate(); }
});
