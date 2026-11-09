import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, gameEngineConfigTable, gameBankLedgerTable, roundDecisionTable, tableRoundsTable, gameConfigTable } from "@workspace/db";
import { ADAPTERS, TABLE_GAME_CODES, createTableRound, revealTableRound, settleTableRound, finishTableRound, placeTableBets, recoverTableRound, type RoundConfigSnapshot } from "../services/tableRounds";
import { engineStateFor, setForcedResult, decideOutcomeFor } from "../services/resultEngine/engine";
import { tableOutcomeSpace } from "../services/resultEngine/tableSpace";
import { usesResultEngine } from "../services/resultEngine/scope";
import { RETIRED_GAME_CODES } from "../lib/retiredGames";
import { invalidateConfigCache } from "../services/rtp";
import { getBalanceByUser } from "../services/wallet";

export async function legacyChecks(request: (path: string, actor?: string, method?: string, body?: unknown) => Promise<Response>) {
  const legacy = TABLE_GAME_CODES.filter(code => code !== "blackjack" && !usesResultEngine(code) && !RETIRED_GAME_CODES.has(code));
  assert.equal(legacy.length, 14);
  for (const code of legacy) {
    if (code === "blackjack") continue;
    const round = await createTableRound(code);
    const cfg = round.config as RoundConfigSnapshot;
    assert.equal(cfg.legacyRulesVersion, 1);
    const adapter = ADAPTERS[code];
    const derive = (seed: typeof round) => adapter.derive(seed.serverSeed, seed.clientSeed, seed.nonce, cfg);
    const expected = derive(round);
    const space = tableOutcomeSpace(code, seed => adapter.derive(seed.serverSeed, seed.clientSeed, seed.nonce, cfg));
    const other = space.choices().find(choice => choice.id !== space.classify(expected));
    assert.ok(other, code);
    await engineStateFor(code, null);
    await db.update(gameEngineConfigTable).set({ mode: "collect", bankPaise: 123456n }).where(eq(gameEngineConfigTable.streamKey, code));
    await setForcedResult({ gameCode: code, partnerId: null, choiceId: other.id, space });
    const balance = (await getBalanceByUser("player")).balance;
    if (code === "roulette") await placeTableBets({ gameCode: code, userId: "player", roundId: round.id, bets: [{ type: "straight", numbers: [(expected as {pocket:number}).pocket], amountPaise: "1000" }] });
    const revealed = await revealTableRound(round);
    assert.deepEqual(revealed.outcome, expected, `${code} must use its original seed draw despite old Collect/forced settings`);
    assert.equal(revealed.resultSource, "drawn");
    await settleTableRound(revealed);
    const done = await finishTableRound(revealed);
    assert.ok(done);
    assert.equal((await db.select().from(roundDecisionTable).where(eq(roundDecisionTable.roundId, round.id))).length, 0);
    assert.equal((await db.select().from(gameBankLedgerTable).where(eq(gameBankLedgerTable.roundId, round.id))).length, 0);
    assert.equal((await engineStateFor(code, null)).bankPaise, 123456n);
    if (code === "roulette") assert.equal((await getBalanceByUser("player")).balance, balance + 35000n);
    assert.equal((await request(`/api/admin/game-control/${code}`, "admin", "PUT", { revision: "old", mode: "collect" })).status, 400);
    assert.equal((await request(`/api/admin/game-control/${code}/force`, "admin", "POST", { choiceId: other.id })).status, 400);
  }

  // A paid, already revealed Speed round from the previous release still
  // recovers, credits exactly once and completes its historical bank entry.
  const code = "speed-auto-roulette";
  (RETIRED_GAME_CODES as Set<string>).delete(code);
  await db.update(gameConfigTable).set({ enabled: true }).where(eq(gameConfigTable.gameCode, code));
  invalidateConfigCache(code);
  const round = await createTableRound(code);
  const cfg = { ...(round.config as RoundConfigSnapshot) };
  delete cfg.legacyRulesVersion;
  await db.update(tableRoundsTable).set({config: cfg}).where(eq(tableRoundsTable.id, round.id));
  const balance = (await getBalanceByUser("player")).balance;
  try {
    await placeTableBets({gameCode:code,userId:"player",roundId:round.id,bets:[{type:"straight",numbers:[5],amountPaise:"1000"}]});
  } finally {
    (RETIRED_GAME_CODES as Set<string>).add(code);
    await db.update(gameConfigTable).set({enabled:false}).where(eq(gameConfigTable.gameCode, code));
    invalidateConfigCache(code);
  }
  const space = tableOutcomeSpace(code, () => ({ pocket: 0 }));
  await setForcedResult({gameCode:code,partnerId:null,choiceId:"5",space});
  const decision = await decideOutcomeFor({gameCode:code,partnerId:null,roundId:round.id,seed:round,space,drawHonest:()=>({pocket:0}),payoutFor:()=>36000n});
  const [revealed] = await db.update(tableRoundsTable).set({phase:"reveal",outcome:decision.outcome,resultSource:decision.source}).where(eq(tableRoundsTable.id,round.id)).returning();
  await decision.commit();
  decision.afterCommit?.();
  await assert.rejects(placeTableBets({gameCode:code,userId:"player",roundId:round.id,bets:[{type:"straight",numbers:[5],amountPaise:"1000"}]}), /GAME_DISABLED/);
  await recoverTableRound(revealed, revealed.settleEndsAt.getTime() + 1);
  await recoverTableRound(revealed, revealed.settleEndsAt.getTime() + 1);
  assert.equal((await getBalanceByUser("player")).balance, balance + 35000n);
  assert.equal((await db.select().from(gameBankLedgerTable).where(eq(gameBankLedgerTable.roundId, round.id))).length, 1);
}
