import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, gameEngineConfigTable, gameBankLedgerTable, roundDecisionTable, tableRoundsTable, gameConfigTable } from "@workspace/db";
import { ADAPTERS, TABLE_GAME_CODES, createTableRound, revealTableRound, settleTableRound, finishTableRound, placeTableBets, recoverTableRound, type RoundConfigSnapshot } from "../services/tableRounds";
import { engineStateFor, setForcedResult, decideOutcomeFor } from "../services/resultEngine/engine";
import { tableOutcomeSpace } from "../services/resultEngine/tableSpace";
import { megaBallCards } from "../services/megaBallMath";
import { placeJokerBets } from "../services/teenPattiJoker";
import { placeL7Live } from "../services/lucky7Live";
import { placeW20Live } from "../services/wheel20Live";
import { placeCoinLive } from "../services/coinFlipLive";
import { placeSevenLive } from "../services/sevenUpDownLive";
import { RECONNECTED_ENGINE_GAMES, usesResultEngine } from "../services/resultEngine/scope";
import { RETIRED_GAME_CODES } from "../lib/retiredGames";
import { invalidateConfigCache } from "../services/rtp";
import { getBalanceByUser } from "../services/wallet";

export async function legacyChecks(request: (path: string, actor?: string, method?: string, body?: unknown) => Promise<Response>) {
  const legacy = RECONNECTED_ENGINE_GAMES;
  assert.equal(legacy.length, 14);
  assert.deepEqual(TABLE_GAME_CODES.filter(code => code !== "blackjack" && !RETIRED_GAME_CODES.has(code)).sort(),
    TABLE_GAME_CODES.filter(code => usesResultEngine(code)).sort());
  for (const code of legacy) {
    const round = await createTableRound(code);
    const cfg = round.config as RoundConfigSnapshot;
    const stake = BigInt(cfg.minStakePaise) > 1000n ? BigInt(cfg.minStakePaise) : 1000n;
    const amount = stake.toString();
    assert.equal(cfg.legacyRulesVersion, undefined, `${code}: new round must use kit pricing`);
    const adapter = ADAPTERS[code];
    const derive = (seed: typeof round) => adapter.derive(seed.serverSeed, seed.clientSeed, seed.nonce, cfg);
    const natural = derive(round);
    const space = tableOutcomeSpace(code, seed => adapter.derive(seed.serverSeed, seed.clientSeed, seed.nonce, cfg));
    const other = space.choices().find(choice => choice.id !== space.classify(natural) && space.forChoice(round, choice.id) !== null);
    assert.ok(other, code);
    const expected = space.forChoice(round, other.id);
    const fixtures: Record<string, unknown[]> = {
      roulette: [{type:"straight",numbers:[Number(other.id)],amountPaise:amount}],
      baccarat: [{type:"player",amountPaise:amount}],
      "teen-patti": [{type:"playerA",amountPaise:amount}],
      "teen-patti-live": [{type:"playerA",amountPaise:amount}],
      "teen-patti-joker": [{spot:"playerA",amountPaise:amount}],
      "andar-bahar": [{type:"andar",amountPaise:amount}],
      "lucky-7": [{type:"under",amountPaise:amount}],
      "lucky-7-live": [{spot:"up",amountPaise:amount}],
      "wheel-2-live": [{spot:"1",amountPaise:amount}],
      "coin-flip": [{side:"heads",amount}],
      "7up7down": [{spot:"up",amount}],
      "vegetable-bowl": [{type:"normal",amountPaise:amount}],
      "crazy-time": [{type:"1",amountPaise:amount}],
      "mega-ball": megaBallCards(round.serverSeedHash,"player",1,amount),
    };
    const bets = fixtures[code];
    const expectedPayout = adapter.settle(bets, expected, cfg.maxMultiplier, cfg.houseEdge, cfg).totalPayout;
    await db.update(gameEngineConfigTable).set({bankPaise:123456n}).where(eq(gameEngineConfigTable.streamKey,code));
    for (const mode of ["normal","distribute","auto","rtp","collect"]) {
      const [state] = await db.select().from(gameEngineConfigTable).where(eq(gameEngineConfigTable.streamKey,code));
      assert.equal((await request(`/api/admin/game-control/${code}`,"admin","PUT",{revision:state.updatedAt.toISOString(),mode})).status,200, `${code}: ${mode}`);
      assert.equal((await engineStateFor(code,null)).mode, mode);
    }
    assert.equal((await request(`/api/admin/game-control/${code}/force`,"admin","POST",{choiceId:other.id})).status,200);
    const balance = (await getBalanceByUser("player")).balance;
    if(code === "teen-patti-joker") await placeJokerBets("player",round.id,bets as Parameters<typeof placeJokerBets>[2]);
    else if(code === "lucky-7-live") await placeL7Live("player",round.id,bets as Parameters<typeof placeL7Live>[2]);
    else if(code === "wheel-2-live") await placeW20Live("player",round.id,bets as Parameters<typeof placeW20Live>[2]);
    else if(code === "coin-flip") await placeCoinLive("player",{roundId:round.id,side:"heads",stakeAmount:amount});
    else if(code === "7up7down") await placeSevenLive("player",round.id,bets as Parameters<typeof placeSevenLive>[2]);
    else await placeTableBets({gameCode:code,userId:"player",roundId:round.id,bets});
    const revealed = await revealTableRound(round);
    assert.deepEqual(revealed.outcome, expected, `${code}: imported result engine was bypassed`);
    assert.equal(revealed.resultSource, "admin");
    const [liveConfig] = await db.select().from(gameConfigTable).where(eq(gameConfigTable.gameCode,code));
    await db.update(gameConfigTable).set({maxMultiplier:1}).where(eq(gameConfigTable.gameCode,code));
    invalidateConfigCache(code);
    await settleTableRound(revealed);
    const done = await finishTableRound(revealed);
    assert.ok(done);
    assert.equal(done.totalPayout, expectedPayout, `${code}: accepted price changed`);
    assert.equal((await getBalanceByUser("player")).balance, balance - stake + expectedPayout, code);
    assert.equal((await db.select().from(roundDecisionTable).where(eq(roundDecisionTable.roundId,round.id))).length,1);
    assert.equal((await db.select().from(gameBankLedgerTable).where(eq(gameBankLedgerTable.roundId,round.id))).length,1);
    assert.equal((await engineStateFor(code,null)).bankPaise,123456n + stake - expectedPayout);
    await settleTableRound(revealed);
    assert.equal(await finishTableRound(revealed),null);
    assert.equal((await getBalanceByUser("player")).balance,balance - stake + expectedPayout);
    await db.update(gameConfigTable).set({maxMultiplier:liveConfig.maxMultiplier}).where(eq(gameConfigTable.gameCode,code));
    invalidateConfigCache(code);
    // Normal keeps the original draw; connecting the engine must not flatten
    // different game probabilities into a uniform choice of result classes.
    await db.update(gameEngineConfigTable).set({mode:"normal"}).where(eq(gameEngineConfigTable.streamKey,code));
    const normal = await createTableRound(code);
    const drawn = await revealTableRound(normal);
    assert.deepEqual(drawn.outcome,adapter.derive(normal.serverSeed,normal.clientSeed,normal.nonce,normal.config as RoundConfigSnapshot));
    assert.equal(drawn.resultSource,"drawn");
    await settleTableRound(drawn); await finishTableRound(drawn);
  }
  // A round accepted before reconnection must keep its natural draw and old
  // pricing even while the newly available engine has an armed result.
  const old = await createTableRound("roulette");
  const [accepted] = await db.update(tableRoundsTable).set({config:{...(old.config as RoundConfigSnapshot),legacyRulesVersion:1}}).where(eq(tableRoundsTable.id,old.id)).returning();
  const honest = ADAPTERS.roulette.derive(old.serverSeed,old.clientSeed,old.nonce,accepted.config as RoundConfigSnapshot) as {pocket:number};
  await setForcedResult({gameCode:"roulette",partnerId:null,choiceId:String((honest.pocket+1)%37),space:tableOutcomeSpace("roulette",()=>honest)});
  const balanceBeforeOld = (await getBalanceByUser("player")).balance;
  await placeTableBets({gameCode:"roulette",userId:"player",roundId:old.id,bets:[{type:"straight",numbers:[honest.pocket],amountPaise:"1000"}]});
  const oldRevealed = await revealTableRound(accepted);
  assert.deepEqual(oldRevealed.outcome,honest);assert.equal(oldRevealed.resultSource,"drawn");
  await settleTableRound(oldRevealed);await finishTableRound(oldRevealed);
  assert.equal((await getBalanceByUser("player")).balance,balanceBeforeOld+35000n);
  assert.equal((await db.select().from(roundDecisionTable).where(eq(roundDecisionTable.roundId,old.id))).length,0);
  assert.equal((await db.select().from(gameBankLedgerTable).where(eq(gameBankLedgerTable.roundId,old.id))).length,0);
  await request("/api/admin/game-control/roulette/force","admin","POST",{choiceId:null});

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
