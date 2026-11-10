import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, ready, memory, gameConfigTable, gameEngineConfigTable, engineBankBudgetTable, b2cRtpPoliciesTable, usersTable } from "../database";
import { captureDemoConfiguration } from "../configurationSnapshot";
import { demoConfigurator } from "../configuration";
import { RESULT_ENGINE_GAMES } from "../../services/resultEngine/scope";
import { RTP_POLICY_GAMES } from "../../services/rtpPolicyGames";
import { engineStateFor } from "../../services/resultEngine/engine";
import { effectiveFloorFor } from "../../services/resultEngine/bankBudget";
import { getPlayerGameConfig, requirePlayerGameConfig } from "../../services/masterRtp";
import { createRound, reveal, cashout } from "../../services/mines";
import { minesRoundsTable } from "../database";
import { postEntry } from "../../services/wallet";

after(async () => { await memory.close(); });

test("capture and refresh every engine and B2C policy without copying production state", async () => {
  await ready;
  await db.insert(usersTable).values({ id: "operator", email: "operator@test.invalid", emailNormalized: "operator@test.invalid", passwordHash: "unused", role: "admin" });
  const modes = ["normal", "collect", "distribute", "auto", "rtp"];
  for (const gameCode of new Set([...RTP_POLICY_GAMES, ...RESULT_ENGINE_GAMES])) {
    await db.insert(gameConfigTable).values({ gameCode, houseEdge: .15, maxMultiplier: 100000, updatedBy: "operator" });
  }
  for (const [i, gameCode] of RESULT_ENGINE_GAMES.entries()) {
    await db.insert(gameEngineConfigTable).values({ streamKey: gameCode, gameCode, mode: modes[i % modes.length],
      bankPaise: 100000n, minBankFloorPaise: 95000n, zeroBetStreak: 7, recentPockets: ["production-history"],
      params: { rtpHoldBps: 800, targetHoldPct: .08, targetBankPaise: "110000" }, updatedBy: "operator" });
  }
  await db.insert(engineBankBudgetTable).values({ scope: "local", mode: "combined", floorPaise: BigInt(RESULT_ENGINE_GAMES.length) * 100000n - 10000n, updatedBy: "operator" });
  await db.insert(b2cRtpPoliciesTable).values(RTP_POLICY_GAMES.map(gameCode => ({ gameCode, playerRtpBps: 9200, revision: 1, updatedBy: "operator" })));
  const snapshot = await captureDemoConfiguration();
  assert.equal(snapshot.engines!.length, RESULT_ENGINE_GAMES.length);
  assert.equal(snapshot.policies!.length, RTP_POLICY_GAMES.length);
  assert.equal(snapshot.budget!.amountPaise, 10000n);
  const serialized = JSON.stringify(snapshot, (_, value) => typeof value === "bigint" ? value.toString() : value);
  for (const forbidden of ["updatedBy", "operator", "bankPaise", "production-history", "partnerId", "passwordHash"]) assert.ok(!serialized.includes(forbidden), forbidden);
  await db.delete(gameEngineConfigTable); await db.delete(engineBankBudgetTable); await db.delete(b2cRtpPoliciesTable);
  await db.delete(gameConfigTable); await db.delete(usersTable);
  const configure = demoConfigurator();
  await configure(snapshot);
  await db.insert(usersTable).values({ id: "visitor", email: "visitor@test.invalid", emailNormalized: "visitor@test.invalid", passwordHash: "unused", role: "player", channel: "b2c" });
  await postEntry({ userId: "visitor", type: "adjustment", amount: 1000000n, memo: "Isolated regression test" });
  for (const [i, code] of RESULT_ENGINE_GAMES.entries()) {
    const state = await engineStateFor(code, null);
    assert.equal(state.mode, modes[i % modes.length], code);
    assert.equal(state.params.rtpHoldBps, 800); assert.equal(state.params.targetHoldPct, .08);
    assert.equal(state.bankPaise, 0n); assert.equal(state.minBankFloorPaise, -5000n);
    assert.equal(state.params.targetBankPaise, 10000n);
    assert.equal(state.zeroBetStreak, 0); assert.deepEqual(state.recentChoiceIds, []);
  }
  for (const code of RTP_POLICY_GAMES) {
    const config = (await getPlayerGameConfig(code, "visitor"))!;
    assert.equal(config.houseEdge, .08, code); assert.equal(config.rtpPolicy.source, "b2c");
  }
  assert.deepEqual(await effectiveFloorFor(null), { budgetBankPaise: 0n, budgetFloorPaise: -10000n });

  // Simulate demo progress and Auto handback; ordinary polling must preserve both.
  const code = RESULT_ENGINE_GAMES[0];
  await db.update(gameEngineConfigTable).set({ bankPaise: -1000n, mode: "auto", zeroBetStreak: 3, recentPockets: ["demo-history"] }).where(eq(gameEngineConfigTable.streamKey, code));
  const polled = structuredClone(snapshot);
  polled.engines![0].remainingBudgetPaise = 999999n;
  polled.engines![0].targetDeltaPaise = 999999n;
  polled.budget!.amountPaise = 999999n;
  await configure(polled); await configure(polled);
  let state = await engineStateFor(code, null);
  assert.equal(state.mode, "auto"); assert.equal(state.bankPaise, -1000n);
  assert.equal(state.minBankFloorPaise, -5000n); assert.equal(state.params.targetBankPaise, 10000n);
  assert.equal(state.zeroBetStreak, 3); assert.deepEqual(state.recentChoiceIds, ["demo-history"]);
  assert.deepEqual(await effectiveFloorFor(null), { budgetBankPaise: -1000n, budgetFloorPaise: -10000n });

  // A policy refresh affects new quotes, never an already accepted Mines hand.
  const oldQuote = (await getPlayerGameConfig("mines", "visitor"))!;
  const hand = await createRound({ userId: "visitor", stakeAmount: 10000n, mineCount: 3, pricingVersion: oldQuote.pricingVersion });
  const changed = structuredClone(snapshot);
  changed.policies = snapshot.policies!.map(policy => ({ ...policy, playerRtpBps: 8800, revision: 2 }));
  changed.engines![0] = { ...changed.engines![0], revision: "revision-2", mode: "collect", remainingBudgetPaise: 3000n, targetDeltaPaise: 2000n };
  changed.budget = { revision: "revision-2", mode: "combined", amountPaise: 6000n };
  await configure(changed);
  state = await engineStateFor(code, null);
  assert.equal(state.mode, "collect"); assert.equal(state.bankPaise, -1000n);
  assert.equal(state.minBankFloorPaise, -4000n); assert.equal(state.params.targetBankPaise, 1000n);
  assert.deepEqual(await effectiveFloorFor(null), { budgetBankPaise: -1000n, budgetFloorPaise: -7000n });
  await assert.rejects(requirePlayerGameConfig("mines", "visitor", oldQuote.pricingVersion, true), (error: any) => error.status === 409);
  const [stored] = await db.select().from(minesRoundsTable).where(eq(minesRoundsTable.id, hand.id));
  assert.equal(stored.houseEdge, .08);
  const safe = Array.from({ length: 25 }, (_, i) => i).find(i => !(stored.mineIndexes as number[]).includes(i))!;
  await reveal({ roundId: hand.id, userId: "visitor", cellIndex: safe });
  assert.equal((await cashout({ roundId: hand.id, userId: "visitor" })).multiplier, hand.nextMultiplier);

  // A failed snapshot rolls back settings and leaves its revision retryable.
  const retry = structuredClone(changed);
  retry.engines![0].revision = "revision-3"; retry.engines![0].mode = "rtp";
  retry.budget = { revision: "revision-3", mode: "same_each", amountPaise: 3000n };
  retry.policies![0].playerRtpBps = 10001;
  await assert.rejects(configure(retry));
  assert.equal((await engineStateFor(code, null)).mode, "collect");
  retry.policies![0].playerRtpBps = null;
  await configure(retry);
  assert.equal((await engineStateFor(code, null)).mode, "rtp");
  assert.deepEqual(await effectiveFloorFor(null), {});
  assert.equal((await getPlayerGameConfig("lunar", "visitor"))!.houseEdge, .15);
  await configure({ ...retry, policies: [] });
  for (const game of RTP_POLICY_GAMES) assert.equal((await getPlayerGameConfig(game, "visitor"))!.houseEdge, .15);

  // Missing source rows return to shipped defaults, rather than leaving stale modes.
  await db.delete(gameEngineConfigTable); await db.delete(engineBankBudgetTable);
  const defaults = await captureDemoConfiguration();
  await configure(defaults);
  for (const game of RESULT_ENGINE_GAMES) assert.equal((await engineStateFor(game, null)).mode, "normal");
  assert.equal((await captureDemoConfiguration()).budget!.mode, "per_game");
});
