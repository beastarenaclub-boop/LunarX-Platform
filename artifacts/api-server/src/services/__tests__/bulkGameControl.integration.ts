import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, networkNodesTable, gameConfigTable, gameEngineConfigTable, engineBankBudgetTable, b2cRtpPoliciesTable, auditLogTable, minesRoundsTable, type User } from "@workspace/db";
import { ready, memory } from "../../demo/database";
import { listBulkControls, previewBulkControls, applyBulkControls, type BulkControlInput } from "../bulkGameControl";
import { listB2cRtp, updateB2cRtp } from "../b2cRtp";
import { getPlayerGameConfig, playerMasterPolicy } from "../masterRtp";
import { RESULT_ENGINE_GAMES } from "../resultEngine/scope";
import { RTP_POLICY_GAMES } from "../rtpPolicyGames";
import { engineStateFor, settleBank } from "../resultEngine/engine";
import { effectiveFloorFor } from "../resultEngine/bankBudget";
import { createRound, reveal, cashout } from "../mines";
import { postEntry, getBalanceByUser } from "../wallet";
import { hashPassword } from "../../lib/password";
import router from "../../routes/gameControl";
import { errorHandler } from "../../middlewares/error";

let admin: User, otherAdmin: User, b2c: User, b2b: User, support: User;
const password = "bulk-test-password";
let masterIds: string[] = [];
async function makeUser(role: User["role"] = "player", agentId?: string) {
  const id = randomUUID();
  const [user] = await db.insert(usersTable).values({ id, email: `${id}@test.invalid`, emailNormalized: `${id}@test.invalid`, role,
    channel: agentId ? "b2b" : "b2c", b2bAgentId: agentId, passwordHash: role === "admin" ? await hashPassword(password) : "unused" }).returning();
  return user;
}
before(async () => {
  await ready;
  admin = await makeUser("admin"); otherAdmin = await makeUser("admin"); support = await makeUser("support"); b2c = await makeUser();
  for (let i = 0; i < 2; i++) {
    const masterUser = await makeUser("agent");
    const [master] = await db.insert(networkNodesTable).values({ userId: masterUser.id, name: `Master ${i + 1}`, kind: "master", createdBy: admin.id }).returning();
    masterIds.push(master.id);
    if (!i) {
      const agentUser = await makeUser("agent");
      const [agent] = await db.insert(networkNodesTable).values({ userId: agentUser.id, name: "Agent", kind: "agent", parentId: master.id, createdBy: admin.id }).returning();
      b2b = await makeUser("player", agent.id);
    }
  }
  for (const code of new Set([...RTP_POLICY_GAMES.filter(code => code !== "wingo"), ...RESULT_ENGINE_GAMES, "blackjack", "rummy-royale"]))
    await db.insert(gameConfigTable).values({ gameCode: code, enabled: code !== "rummy-royale", houseEdge: .15, maxMultiplier: 100000 });
  await postEntry({ userId: b2c.id, type: "adjustment", amount: 1000000n, memo: "Isolated bulk-control test" });
});
after(async () => { await memory.close(); });
async function prepare(operation: BulkControlInput) {
  const preview = await previewBulkControls(admin, operation);
  return { operation, previewToken: preview.previewToken, requestId: randomUUID() };
}
async function apply(operation: BulkControlInput) { return applyBulkControls(admin, await prepare(operation)); }
async function settings() {
  return { policies: await db.select().from(b2cRtpPoliciesTable).orderBy(b2cRtpPoliciesTable.gameCode),
    engines: await db.select().from(gameEngineConfigTable).orderBy(gameEngineConfigTable.streamKey),
    masters: await db.select().from(networkNodesTable).orderBy(networkNodesTable.id),
    budget: await db.select().from(engineBankBudgetTable), audit: await db.select().from(auditLogTable) };
}

test("overview and previews are read-only; defaults come from actual payout versions", async () => {
  const before = await settings(), overview = await listBulkControls(admin);
  assert.equal(overview.playerRtpGames.length, 15); assert.equal(overview.tableGames.length, 17);
  const get = (code: string) => overview.games.find(game => game.code === code)!;
  assert.equal(get("coin-flip").defaultRtp.minPercent, 99);
  assert.ok(Math.abs(get("7up7down").defaultRtp.minPercent! - 5.5) < 1e-8);
  assert.ok(Math.abs(get("7up7down").defaultRtp.maxPercent! - 82.5) < 1e-8);
  assert.equal(get("chicken-road").defaultRtp.minPercent, 85);
  assert.ok(Math.abs(get("wingo").defaultRtp.minPercent! - 19.8) < 1e-8);
  assert.equal(get("blackjack").defaultRtp.minPercent, null);
  assert.equal(get("rummy-royale").retired, true);
  const preview = await previewBulkControls(admin, { kind: "rtp", channel: "both", playerRtpBps: 8800, includeTables: true });
  assert.equal(preview.b2cGames.length, 15); assert.equal(preview.masters.length, 2); assert.equal(preview.tableGames.length, 17);
  assert.ok(preview.excludedGames.some(game => game.code === "blackjack"));
  assert.deepEqual(await settings(), before);
  assert.equal((await listB2cRtp(admin)).find(p => p.gameCode === "coin-flip")!.defaultRtp.minPercent, 99);
});

test("one RTP save reaches both channels and all tables while accepted bets and other settings survive", async () => {
  await engineStateFor("roulette-american", null);
  await db.update(gameEngineConfigTable).set({ params: { windowRounds: 71, noiseRate: .2 }, minBankFloorPaise: -3210n }).where(eq(gameEngineConfigTable.streamKey, "roulette-american"));
  const configs = await db.select().from(gameConfigTable), balance = (await getBalanceByUser(b2c.id)).balance;
  const hand = await createRound({ userId: b2c.id, stakeAmount: 10000n, mineCount: 3 });
  await apply({ kind: "rtp", channel: "both", playerRtpBps: 8800, includeTables: true });
  for (const code of RTP_POLICY_GAMES) {
    assert.equal((await playerMasterPolicy(code, b2c.id)).masterRtpBps, 8800, `B2C ${code}`);
    assert.equal((await playerMasterPolicy(code, b2b.id)).masterRtpBps, 8800, `B2B ${code}`);
  }
  for (const code of RESULT_ENGINE_GAMES) {
    const state = await engineStateFor(code, null); assert.equal(state.mode, "rtp"); assert.equal(state.params.rtpHoldBps, 1200);
  }
  const american = await engineStateFor("roulette-american", null);
  assert.equal(american.params.windowRounds, 71); assert.equal(american.params.noiseRate, .2); assert.equal(american.minBankFloorPaise, -3210n);
  assert.deepEqual(await db.select().from(gameConfigTable), configs);
  const [stored] = await db.select().from(minesRoundsTable).where(eq(minesRoundsTable.id, hand.id));
  assert.equal(stored.houseEdge, .15); assert.equal((await getPlayerGameConfig("mines", b2c.id))!.houseEdge, .12);
  const safe = Array.from({ length: 25 }, (_, i) => i).find(i => !(stored.mineIndexes as number[]).includes(i))!;
  await reveal({ roundId: hand.id, userId: b2c.id, cellIndex: safe });
  const paid = await cashout({ roundId: hand.id, userId: b2c.id });
  assert.equal(paid.multiplier, hand.nextMultiplier);
  assert.equal((await getBalanceByUser(b2c.id)).balance, balance - 10000n + BigInt(paid.payoutAmount!));
});

test("B2C-only and B2B-only bulk policies preserve the other channel and table modes", async () => {
  await apply({ kind: "rtp", channel: "b2c", playerRtpBps: 7500, includeTables: false });
  assert.equal((await playerMasterPolicy("dice", b2c.id)).masterRtpBps, 7500);
  assert.equal((await playerMasterPolicy("dice", b2b.id)).masterRtpBps, 8800);
  await apply({ kind: "rtp", channel: "b2b", playerRtpBps: 6500, includeTables: false });
  assert.equal((await playerMasterPolicy("dice", b2c.id)).masterRtpBps, 7500);
  assert.equal((await playerMasterPolicy("dice", b2b.id)).masterRtpBps, 6500);
  assert.equal((await engineStateFor("roulette-american", null)).params.rtpHoldBps, 1200);
});

test("every table changes mode together; Auto target changes without resetting budgets", async () => {
  await apply({ kind: "table-mode", mode: "collect" });
  for (const code of RESULT_ENGINE_GAMES) assert.equal((await engineStateFor(code, null)).mode, "collect");
  await apply({ kind: "table-mode", mode: "auto", targetRtpBps: 9200 });
  for (const code of RESULT_ENGINE_GAMES) {
    const state = await engineStateFor(code, null); assert.equal(state.mode, "auto"); assert.equal(state.params.targetHoldPct, .08);
  }
  assert.equal((await engineStateFor("roulette-american", null)).minBankFloorPaise, -3210n);
});

test("stale settings, changed request, wrong actor and expired previews cannot partially apply", async () => {
  const request = await prepare({ kind: "rtp", channel: "both", playerRtpBps: 9000, includeTables: true });
  const p = (await listB2cRtp(admin)).find(p => p.gameCode === "dice")!;
  await updateB2cRtp(admin, "dice", { playerRtpBps: 7600, revision: p.revision });
  const before = await settings();
  await assert.rejects(applyBulkControls(admin, request), (error: any) => error.status === 409);
  assert.deepEqual(await settings(), before);
  const fresh = await prepare({ kind: "budget", mode: "combined", budgetPaise: "10000" });
  await assert.rejects(applyBulkControls(otherAdmin, fresh), (error: any) => error.status === 409);
  await assert.rejects(applyBulkControls(admin, { ...fresh, operation: { ...fresh.operation, budgetPaise: "90000" } }), (error: any) => error.status === 409);
  await assert.rejects(applyBulkControls(admin, { ...fresh, previewToken: fresh.previewToken + "changed" }), (error: any) => error.status === 409);
  const now = Date.now;
  try { Date.now = () => now() + 11 * 60_000; await assert.rejects(applyBulkControls(admin, fresh), (error: any) => error.status === 409); } finally { Date.now = now; }
  assert.deepEqual(await settings(), before);
});

test("combined budget freezes against current bank; retries never replenish it", async () => {
  const request = await prepare({ kind: "budget", mode: "combined", budgetPaise: "10000" });
  await settleBank({ gameCode: "roulette-american", partnerId: null, roundId: randomUUID(), totalStakePaise: 2000n, totalPayoutPaise: 0n });
  const first = await applyBulkControls(admin, request);
  assert.deepEqual(await effectiveFloorFor(null), { budgetBankPaise: 2000n, budgetFloorPaise: -8000n });
  await settleBank({ gameCode: "roulette-american", partnerId: null, roundId: randomUUID(), totalStakePaise: 0n, totalPayoutPaise: 1000n });
  assert.deepEqual(await applyBulkControls(admin, request), first);
  assert.deepEqual(await effectiveFloorFor(null), { budgetBankPaise: 1000n, budgetFloorPaise: -8000n });
  assert.equal((await db.select().from(auditLogTable).where(eq(auditLogTable.id, `bulk-game-control:${request.requestId}`))).length, 1);
  const now = Date.now;
  try { Date.now = () => now() + 11 * 60_000; assert.deepEqual(await applyBulkControls(admin, request), first); } finally { Date.now = now; }
  await assert.rejects(applyBulkControls(admin, { ...request, operation: { ...request.operation, budgetPaise: "90000" } }), (error: any) => error.status === 409);
});

test("same-each freezes every floor; separate mode preserves them; concurrent retries apply once", async () => {
  const request = await prepare({ kind: "budget", mode: "same_each", budgetPaise: "3000" });
  const results = await Promise.all([applyBulkControls(admin, request), applyBulkControls(admin, request)]);
  assert.deepEqual(results[0], results[1]);
  for (const code of RESULT_ENGINE_GAMES) {
    const state = await engineStateFor(code, null); assert.equal(state.bankPaise - state.minBankFloorPaise, 3000n);
  }
  const floors = (await db.select().from(gameEngineConfigTable)).map(e => e.minBankFloorPaise);
  await apply({ kind: "budget", mode: "per_game" });
  assert.deepEqual((await db.select().from(gameEngineConfigTable)).map(e => e.minBankFloorPaise), floors);
  assert.deepEqual(await effectiveFloorFor(null), {});
});

test("invalid inputs and non-admin roles cannot preview or change all-game settings", async () => {
  for (const actor of [support, b2c, b2b]) {
    await assert.rejects(listBulkControls(actor), (error: any) => error.status === 403);
    await assert.rejects(previewBulkControls(actor, { kind: "table-mode", mode: "normal" }), (error: any) => error.status === 403);
  }
  for (const body of [
    { kind: "rtp", channel: "both", playerRtpBps: 10001, includeTables: true },
    { kind: "rtp", channel: "both", playerRtpBps: 0, includeTables: true },
    { kind: "table-mode", mode: "auto" }, { kind: "budget", mode: "combined" },
    { kind: "budget", mode: "combined", budgetPaise: "-100" },
    { kind: "table-mode", mode: "normal", surprise: true },
  ]) await assert.rejects(previewBulkControls(admin, body));
});

test("HTTP preview is read-only and apply requires admin password confirmation", async () => {
  const app = express(); app.use(express.json()); let actor = support;
  app.use((req, _res, next) => { req.user = actor; next(); }); app.use("/api/admin/game-control", router); app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/admin/game-control/bulk`;
  try {
    assert.equal((await fetch(url)).status, 403); actor = admin;
    const operation = { kind: "table-mode", mode: "normal" };
    const response = await fetch(url + "/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation) });
    assert.equal(response.status, 200); const preview = await response.json() as any;
    const request = { operation, previewToken: preview.previewToken, requestId: randomUUID() };
    const before = await settings();
    for (const confirmation of [undefined, "incorrect"]) {
      const result = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", ...(confirmation ? { "X-Confirm-Password": confirmation } : {}) }, body: JSON.stringify(request) });
      assert.equal(result.status, 403);
    }
    assert.deepEqual(await settings(), before);
    const applied = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", "X-Confirm-Password": password }, body: JSON.stringify(request) });
    assert.equal(applied.status, 200); assert.equal((await applied.json() as any).tableGames.length, 17);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
