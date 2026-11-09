import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, usersTable, networkNodesTable, gameConfigTable, auditLogTable, minesRoundsTable, tableRoundsTable, type User } from "@workspace/db";
import { ready, memory } from "../../demo/database";
import { getPlayerGameConfig, requirePlayerGameConfig, updateMasterRtp, MASTER_RTP_GAMES } from "../masterRtp";
import { getGameConfig, invalidateConfigCache, minesMultiplier, plinkoMultiplierTable, diceMultiplier } from "../rtp";
import { createRound, reveal, cashout } from "../mines";
import { dropBall } from "../plinko";
import { rollDice } from "../dice";
import { currentCrashRound } from "../crashRounds";
import { postEntry, getBalanceByUser } from "../wallet";

let admin: User, masterA: User, masterB: User, agentA: User, agentB: User, playerA: User, playerB: User, b2c: User;
let a: string, b: string;
async function user(role: User["role"] = "player", agentId?: string) {
  const id = randomUUID();
  const [user] = await db.insert(usersTable).values({ id, email: `${id}@test.invalid`, emailNormalized: `${id}@test.invalid`, passwordHash: "unused", role, channel: agentId ? "b2b" : "b2c", b2bAgentId: agentId ?? null }).returning();
  await postEntry({ userId: id, type: "adjustment", amount: 1000000n, memo: "Volatile RTP test" });
  return user;
}
async function node(owner: User, kind: "master" | "agent", parentId?: string) {
  const [node] = await db.insert(networkNodesTable).values({ userId: owner.id, kind, parentId, name: kind, createdBy: admin.id }).returning();
  return node.id;
}
before(async () => {
  await ready;
  admin = await user("admin"); masterA = await user("agent"); masterB = await user("agent"); agentA = await user("agent"); agentB = await user("agent");
  a = await node(masterA, "master"); b = await node(masterB, "master");
  playerA = await user("player", await node(agentA, "agent", a)); playerB = await user("player", await node(agentB, "agent", b)); b2c = await user();
  for (const gameCode of [...MASTER_RTP_GAMES, "coin-flip", "ludo"]) await db.insert(gameConfigTable).values({ gameCode, houseEdge: .03, maxStakePaise: 5000000n, maxMultiplier: 100000, enabled: true }).onConflictDoNothing();
  invalidateConfigCache();
});
after(async () => { await memory.close(); });

test("company defaults, master isolation, B2C and fixed game rules", async () => {
  assert.equal((await getPlayerGameConfig("mines", playerA.id))!.houseEdge, .03);
  await updateMasterRtp(admin, a, { playerRtpBps: 7000, revision: 0 });
  for (const game of MASTER_RTP_GAMES) {
    assert.equal((await getPlayerGameConfig(game, playerA.id))!.houseEdge, .3);
    assert.equal((await getPlayerGameConfig(game, playerB.id))!.houseEdge, .03);
    assert.equal((await getPlayerGameConfig(game, b2c.id))!.houseEdge, .03);
    assert.equal((await getGameConfig(game))!.houseEdge, .03, "shared cache remains unchanged");
  }
  assert.equal((await getPlayerGameConfig("coin-flip", playerA.id))!.houseEdge, .3);
  assert.equal(await getPlayerGameConfig("unknown-game", playerA.id), null);
});

test("only admin and owning master may edit; validate input and concurrent revisions", async () => {
  for (const actor of [masterB, agentA, playerA, b2c]) await assert.rejects(updateMasterRtp(actor, a, { playerRtpBps: 8000, revision: 1 }), (e: any) => e.status === 403);
  for (const value of [-1, 0, 99, 10001, 7000.1]) await assert.rejects(updateMasterRtp(masterA, a, { playerRtpBps: value, revision: 1 }));
  const before = (await getPlayerGameConfig("mines", playerA.id))!;
  await updateMasterRtp(masterA, a, { playerRtpBps: 8000, revision: 1 });
  await assert.rejects(updateMasterRtp(admin, a, { playerRtpBps: 6000, revision: 1 }), (e: any) => e.status === 409);
  await assert.rejects(requirePlayerGameConfig("mines", playerA.id, before.pricingVersion, true), (e: any) => e.status === 409);
  const audit = await db.select().from(auditLogTable).where(eq(auditLogTable.action, "network.rtp_update"));
  assert.equal(audit.length, 2); assert.equal(audit[1].actorId, masterA.id);
  assert.deepEqual(audit[1].before, {playerRtpBps: 7000, revision: 1});
});

test("stale/missing quotes never debit; real mines round stores accepted RTP across updates", async () => {
  const quote = (await getPlayerGameConfig("mines", playerA.id))!;
  const balance = (await getBalanceByUser(playerA.id)).balance;
  await assert.rejects(createRound({ userId: playerA.id, stakeAmount: 10000n, mineCount: 3 }), (e: any) => e.status === 409);
  assert.equal((await getBalanceByUser(playerA.id)).balance, balance);
  const round = await createRound({ userId: playerA.id, stakeAmount: 10000n, mineCount: 3, pricingVersion: quote.pricingVersion });
  assert.equal(round.houseEdge, .2); assert.equal(round.serverSeed, null); assert.equal(round.mineIndexes, null);
  await updateMasterRtp(masterA, a, { playerRtpBps: 7000, revision: 2 });
  const [saved] = await db.select().from(minesRoundsTable).where(eq(minesRoundsTable.id, round.id));
  assert.equal(saved.houseEdge, .2); assert.equal(saved.payoutVersion, 2);
  const safe = Array.from({length:25},(_,i)=>i).find(i => !(saved.mineIndexes as number[]).includes(i))!;
  await reveal({roundId:round.id,userId:playerA.id,cellIndex:safe});
  const paid = await cashout({roundId:round.id,userId:playerA.id});
  assert.equal(paid.multiplier,round.nextMultiplier);
  assert.equal((await getBalanceByUser(playerA.id)).balance,balance-10000n+BigInt(paid.payoutAmount!));
  assert.equal(round.nextMultiplier, minesMultiplier({gridSize:25,mineCount:3,revealedSafe:1,houseEdge:.2,maxMultiplier:100000}));
  await assert.rejects(requirePlayerGameConfig("mines", playerA.id, quote.pricingVersion, true), (e: any) => e.status === 409);
});

test("Plinko and Dice use branch pricing in actual funded settlements", async () => {
  const plinko = (await getPlayerGameConfig("plinko", playerA.id))!;
  const before = (await getBalanceByUser(playerA.id)).balance;
  const drop = await dropBall({userId: playerA.id, stakeAmount:10000n, rows:12, risk:"medium", pricingVersion:plinko.pricingVersion});
  assert.equal(drop.houseEdge,.3); assert.equal(drop.serverSeed,null);
  assert.equal(drop.multiplier,plinkoMultiplierTable(12,"medium",.3,100000)[drop.bucket]);
  assert.equal((await getBalanceByUser(playerA.id)).balance,before-10000n+BigInt(drop.payoutAmount));
  const dice = (await getPlayerGameConfig("dice", playerA.id))!;
  const roll = await rollDice({userId:playerA.id,stakeAmount:10000n,target:50,direction:"under",pricingVersion:dice.pricingVersion});
  assert.equal(roll.houseEdge,.3); assert.equal(roll.multiplier,roll.didWin ? 1.4 : 0); assert.equal(roll.serverSeed,null);
});

test("new crash rounds use the branch policy; existing round stays immutable", async () => {
  const first = await currentCrashRound(playerA.id,"jetx");
  assert.equal(first.houseEdge,.3); assert.equal(first.crashPoint,null); assert.equal(first.serverSeed,null);
  await updateMasterRtp(admin,a,{playerRtpBps:9000,revision:3});
  const ongoing = await currentCrashRound(playerA.id,"jetx",first.id);
  assert.equal(ongoing.id,first.id); assert.equal(ongoing.houseEdge,.3);
  const other = await currentCrashRound(playerB.id,"jetx");
  assert.equal(other.houseEdge,.03);
  const [stored] = await db.select().from(tableRoundsTable).where(eq(tableRoundsTable.id,first.id));
  assert.equal((stored.config as any).rtpPolicy.playerRtpBps,7000);
});

test("reverting to company rules preserves revision and rejects old quotes",async()=>{
  const quote=(await getPlayerGameConfig("dice",playerA.id))!;
  await updateMasterRtp(masterA,a,{playerRtpBps:null,revision:4});
  const inherited=(await getPlayerGameConfig("dice",playerA.id))!;
  assert.equal(inherited.houseEdge,.03); assert.equal(inherited.rtpPolicy.source,"company"); assert.equal(inherited.rtpPolicy.revision,5);
  await assert.rejects(requirePlayerGameConfig("dice",playerA.id,quote.pricingVersion,true),(e:any)=>e.status===409);
  await requirePlayerGameConfig("dice",playerA.id,inherited.pricingVersion,true);
});

test("70% target has correct expectation before disclosed rounding/caps",()=>{
  for(const rows of [8,12,16]) for(const risk of ["low","medium","high"] as const){
    const table=plinkoMultiplierTable(rows,risk,.3,100000); let ev=0,comb=1;
    for(let k=0;k<=rows;k++){ if(k)comb=comb*(rows-k+1)/k; ev+=comb/(2**rows)*table[k]; }
    assert.ok(ev<=.70000001 && ev>=.69, `${rows}/${risk}: ${ev}`);
  }
  assert.equal(minesMultiplier({gridSize:25,mineCount:1,revealedSafe:1,houseEdge:.3,maxMultiplier:100000}),.72);
});


import { playerTableConfig, playerMasterPolicy } from "../masterRtp";
import { createTableRound, getTableRoundSnapshot, placeTableBets, settleTableRound, type RoundConfigSnapshot } from "../tableRounds";
import { placeCoinLive, settleCoinLive } from "../coinFlipLive";
import { placeL7Live, settleL7Live } from "../lucky7Live";
import { placeW20Live, settleW20Live } from "../wheel20Live";
import { placeSevenLive, settleSevenLive } from "../sevenUpDownLive";
import { l7Payout, L7_SPOTS, L7_SUITS } from "@workspace/api-zod/lucky7-live";
import { w20Payout, W20_SPOTS, W20_WHEEL, W20_BOOSTS } from "@workspace/api-zod/wheel20-live";
import { sevenMultiplier } from "@workspace/api-zod/instant-collection";
import { CHICKEN_MODES, chickenSurvival } from "@workspace/api-zod/chicken-road-game";
import { chickenConfig, startChicken } from "../chickenRoad";
import { masterPokerQuotes, payout as pokerPayout } from "../pokerMath";
import { pokerTable } from "../poker";
import { wingoState, placeWingoBet, tickWingo } from "../wingo";
import { ludoTable, joinLudo } from "../ludo";
import { tableRoundBetsTable, wingoRoundsTable, wingoBetsTable, pokerBets, betsTable } from "@workspace/db";

async function target(bps: number | null) {
  const [m] = await db.select().from(networkNodesTable).where(eq(networkNodesTable.id,a));
  return updateMasterRtp(admin,a,{playerRtpBps:bps,revision:m.rtpRevision});
}
test("fixed table quotes preserve common outcome and isolate 70% master payouts", async()=>{
  await target(7000);
  const cases = [
    {code:"coin-flip", bet: (u:string,id:string,q?:string)=>placeCoinLive(u,{roundId:id,side:"heads",stakeAmount:"10000",pricingVersion:q}), outcome:{side:"heads",value:0}, settle:settleCoinLive, custom:14000n, base:19800n},
    {code:"lucky-7-live",bet:(u:string,id:string,q?:string)=>placeL7Live(u,id,[{spot:"red",amountPaise:"10000"}],q),outcome:{rank:8,suit:"hearts"},settle:settleL7Live,custom:14000n,base:19000n},
    {code:"wheel-2-live",bet:(u:string,id:string,q?:string)=>placeW20Live(u,id,[{spot:"1",amountPaise:"10000"}],q),outcome:{version:1,segment:0,winner:"1",boostSpot:"2",boost:2},settle:settleW20Live,custom:w20Payout([{spot:"1",amountPaise:"10000"}],{version:1,segment:0,winner:"1",boostSpot:"2",boost:2},1,7000),base:20000n},
    {code:"7up7down",bet:(u:string,id:string,q?:string)=>placeSevenLive(u,id,[{spot:"up",amount:"10000"}],q),outcome:{dice:[4,5],total:9},settle:settleSevenLive,custom:16800n,base:19800n},
  ];
  for(const c of cases){
    const round=await createTableRound(c.code as any);
    const view=await getTableRoundSnapshot(c.code as any,playerA.id);
    const quote=view!.config.pricingVersion!;
    assert.equal(view!.config.masterRtpBps,7000); assert.equal(view!.outcome,null);
    await assert.rejects(c.bet(playerA.id,round.id), (e:any)=>e.status===409);
    const balanceA=(await getBalanceByUser(playerA.id)).balance, balanceB=(await getBalanceByUser(playerB.id)).balance;
    await c.bet(playerA.id,round.id,quote); await c.bet(playerB.id,round.id);
    await target(8000);
    await c.bet(playerA.id,round.id,quote); // idempotent replay after policy change
    const [revealed]=await db.update(tableRoundsTable).set({outcome:c.outcome,phase:"settling"}).where(eq(tableRoundsTable.id,round.id)).returning();
    await c.settle(revealed); await c.settle(revealed);
    assert.equal((await getBalanceByUser(playerA.id)).balance,balanceA-10000n+c.custom,c.code);
    assert.equal((await getBalanceByUser(playerB.id)).balance,balanceB-10000n+c.base,c.code+" other master");
    await db.update(tableRoundsTable).set({phase:"settled"}).where(eq(tableRoundsTable.id,round.id));
    await target(7000);
  }
});

test("every fixed-card/dice/wheel selection targets 70% before integer rounding",()=>{
  for(const spot of L7_SPOTS){
    let sum=0;
    for(let rank=1;rank<=13;rank++) for(const suit of L7_SUITS)sum+=Number(l7Payout([{spot,amountPaise:"1000000"}],{rank,suit},1,7000));
    const ev=sum/52/1000000; assert.ok(ev<=.700001 && ev>=.6999,spot+":"+ev);
  }
  for(const spot of W20_SPOTS){
    let ev=0;
    for(let segment=0;segment<W20_WHEEL.length;segment++)for(const boostSpot of W20_SPOTS)for(let i=0;i<W20_BOOSTS.length;i++){
      ev+=Number(w20Payout([{spot,amountPaise:"1000000"}],{version:1,segment,winner:W20_WHEEL[segment],boostSpot,boost:W20_BOOSTS[i]},1,7000))*[.75,.2,.04,.01][i]/54/9/1000000;
    }
    assert.ok(ev<=.700001 && ev>=.6999,spot+":"+ev);
  }
  assert.equal(sevenMultiplier("seven",.7,1000,1),4.2);
  assert.equal(sevenMultiplier("2",.7,1000,1),25.2);
});

test("Chicken saves v4 policy, rejects stale quotes, and has 70% EV at each lane",async()=>{
  await target(7000); const cfg=await chickenConfig(playerA.id);
  assert.equal(cfg.version,4); assert.equal(cfg.rtp,.7);
  const input={requestId:randomUUID(),clientSeed:"test-client",difficulty:"easy" as const,stakeAmount:"10000",pricingVersion:cfg.pricingVersion};
  const round=await startChicken(playerA.id,input);
  assert.equal(round.rtp,.7); assert.equal(round.serverSeed,null);
  await target(8000); assert.equal((await startChicken(playerA.id,input)).id,round.id);
  assert.equal((await chickenConfig(playerB.id)).version===4,false);
  for(const difficulty of Object.keys(CHICKEN_MODES) as (keyof typeof CHICKEN_MODES)[]){let survival=1;
    CHICKEN_MODES[difficulty].returns.forEach((n,i)=>{survival*=chickenSurvival(difficulty,i+1,4,.7); assert.ok(Math.abs(survival*n/100-.7)<1e-10);});
  }
});

test("Colour locks per-bet rates, keeps common digit, and settles retry once",async()=>{
  await target(7000);
  const state=await wingoState(playerA.id); const other=await wingoState(playerB.id);
  assert.equal(state.round.period,other.round.period); assert.equal(state.returns!.red,1.4); assert.equal(state.returns!["1"],7); assert.equal(other.returns,undefined);
  await db.update(wingoRoundsTable).set({ends:Date.now()+30000}).where(eq(wingoRoundsTable.period,state.round.period));
  const input={duration:30,period:state.round.period,pick:"red",stake:10000,request:randomUUID(),payoutVersion:state.round.payoutVersion,pricingVersion:state.pricingVersion};
  const balance=(await getBalanceByUser(playerA.id)).balance;
  await assert.rejects(placeWingoBet(playerA.id,{...input,pricingVersion:"0".repeat(32)}),(e:any)=>e.status===409);
  await placeWingoBet(playerA.id,input); await target(8000); await placeWingoBet(playerA.id,input);
  await db.update(wingoRoundsTable).set({number:2,ends:Date.now()-100}).where(eq(wingoRoundsTable.period,state.round.period));
  await tickWingo();await tickWingo();
  assert.equal((await getBalanceByUser(playerA.id)).balance,balance+4000n);
  const [bet]=await db.select().from(wingoBetsTable).where(eq(wingoBetsTable.request,input.request));assert.equal(bet.returnBps,14000);
});

test("Poker main and category quotes are isolated; ties split master stakes at accepted odds",async()=>{
  await target(7000);
  const state=await pokerTable(playerA.id,"poker-20-20"); const other=await pokerTable(playerB.id,"poker-20-20");
  assert.equal(state.quotes[0].odds,140);assert.equal(other.quotes[0].odds,198);
  const input={roundId:state.round.id,quoteId:state.quoteId,requestId:randomUUID(),selections:[{market:state.quotes[0].id,amountPaise:"10000"}]};
  await pokerTable(playerA.id,"poker-20-20",input); await target(8000); await pokerTable(playerA.id,"poker-20-20",input);
  const locked={market:"p0-back",amountPaise:"10000",debitPaise:"10000",quote:state.quotes[0]};
  // Board royal flush: both players share the winning hand.
  assert.equal(pokerPayout([locked],[[1,2],[3,4]],[9,10,11,12,0]),7000n);
  assert.equal(pokerPayout([{...locked,quote:other.quotes[0]}],[[1,2],[3,4]],[9,10,11,12,0]),10000n);
});

test("Ludo uses 30% commission only within the master pool and keeps existing rooms",async()=>{
  await target(7000); const state=await ludoTable(playerA.id); const other=await ludoTable(playerB.id);
  assert.equal(state.commissionBps,3000);assert.equal(other.commissionBps,1000);
  const input={requestId:randomUUID(),capacity:2 as const,entryPaise:10000,mode:"private" as const,pricingVersion:state.pricingVersion};
  const joined=await joinLudo(playerA.id,input); assert.equal(joined.match!.commissionBps,3000);assert.equal(joined.match!.prizePaise,"14000");
  await target(8000); const ongoing=await ludoTable(playerA.id); assert.equal(ongoing.match!.commissionBps,3000);
  assert.equal(ongoing.commissionBps,2000); assert.equal((await joinLudo(playerA.id,input)).match!.id,joined.match!.id);
});

import { settleCrazyTimeBets } from "../crazyTimeMath";
test("Crazy Time pays the accepted master rates after the policy changes",async()=>{
  await target(7000);
  const round=await createTableRound("crazy-time");
  const view=(await getTableRoundSnapshot("crazy-time",playerA.id))!;
  const bets=[{type:"1",amountPaise:"10000"}];
  await assert.rejects(placeTableBets({gameCode:"crazy-time",roundId:round.id,userId:playerA.id,bets}),(e:any)=>e.status===409);
  const balance=(await getBalanceByUser(playerA.id)).balance;
  await placeTableBets({gameCode:"crazy-time",roundId:round.id,userId:playerA.id,bets,pricingVersion:view.config.pricingVersion});
  await target(9000);
  const outcome={version:1 as const,segment:0,winner:"1" as const,topSlot:{spot:"2" as const,multiplier:2},bonus:null};
  const [revealed]=await db.update(tableRoundsTable).set({phase:"reveal",outcome}).where(eq(tableRoundsTable.id,round.id)).returning();
  await settleTableRound(revealed);await settleTableRound(revealed);
  const expected=settleCrazyTimeBets([{type:"1",amountPaise:10000n}],outcome,view.config.payoutVersion,.7).totalPayout;
  assert.equal((await getBalanceByUser(playerA.id)).balance,balance-10000n+expected);
});

test("admin and master edits from 30 to 5 percent reach every game's new prices",async()=>{
  for (const [actor,bps] of [[admin,3000],[masterA,500],[admin,8250]] as const) {
    const [previous] = await db.select().from(networkNodesTable).where(eq(networkNodesTable.id,a));
    const saved = await updateMasterRtp(actor,a,{playerRtpBps:bps,revision:previous.rtpRevision});
    assert.equal(saved.playerRtpBps,bps);
    const edge = (10000-bps)/10000;
    for (const game of MASTER_RTP_GAMES) {
      const cfg = (await getPlayerGameConfig(game,playerA.id))!;
      assert.equal(cfg.rtpPolicy.playerRtpBps,bps,game);
      assert.equal(cfg.houseEdge,edge,game);
      assert.equal((await getPlayerGameConfig(game,playerB.id))!.houseEdge,.03,game+" other master");
    }
    for (const code of ['coin-flip','7up7down','lucky-7-live','wheel-2-live','crazy-time'] as const) {
      await createTableRound(code);
      const view = (await getTableRoundSnapshot(code,playerA.id))!;
      assert.equal(view.config.masterRtpBps,bps,code); assert.equal(view.config.houseEdge,edge,code);
    }
    assert.ok(Math.abs((await chickenConfig(playerA.id)).rtp-bps/10000)<1e-12);
    assert.equal((await wingoState(playerA.id)).returns!.red,bps/5000);
    assert.equal((await pokerTable(playerA.id,'poker-20-20')).quotes[0].odds,bps/50);
    assert.equal((await ludoTable(playerA.id)).commissionBps,10000-bps);
    if (bps === 500) {
      const cfg = (await getPlayerGameConfig('plinko',playerA.id))!;
      const drop = await dropBall({userId:playerA.id,stakeAmount:10000n,rows:12,risk:'medium',pricingVersion:cfg.pricingVersion});
      assert.equal(drop.houseEdge,.95);
      assert.equal(drop.multiplier,plinkoMultiplierTable(12,'medium',.95,100000)[drop.bucket]);
      const dice = (await getPlayerGameConfig('dice',playerA.id))!;
      const roll = await rollDice({userId:playerA.id,stakeAmount:10000n,target:50,direction:'under',pricingVersion:dice.pricingVersion});
      assert.equal(roll.houseEdge,.95); assert.equal(roll.multiplier,roll.didWin ? .1 : 0);
    }
  }
});
