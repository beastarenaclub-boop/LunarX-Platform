import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db, usersTable, wingoRoundsTable as rounds, wingoBetsTable as bets, walletLedgerTable } from '@workspace/db';
import { ready, memory } from '../../demo/database';
import { wingoState, placeWingoBet, tickWingo } from '../wingo';
import { postEntry, getBalanceByUser } from '../wallet';
import { commitmentFor } from '../../../../3d-game/wingo-server/rules.mjs';
before(async()=>{await ready;});
after(async()=>{await memory.close();});

test('30-second wallet bets use 1.98 returns, reject other durations and preserve legacy settlement',async()=>{
  const userId=randomUUID();
  await db.insert(usersTable).values({id:userId,email:`${userId}@test.invalid`,emailNormalized:`${userId}@test.invalid`,passwordHash:'test',displayName:'Colour test'});
  await postEntry({userId,type:'adjustment',amount:10000n});
  for(const duration of [60,180,300]) {
    await assert.rejects(async()=>wingoState(userId,duration));
    await assert.rejects(async()=>placeWingoBet(userId,{duration,period:`${duration}-1`,pick:'5',stake:100,request:randomUUID()}));
  }
  const state=await wingoState(userId);
  assert.equal(state.round.duration,30);
  assert.equal(state.round.ends-state.round.start,30000);
  assert.equal(state.round.payoutVersion,3);
  assert.ok(!('number' in state.round) && !('secret' in state.round));
  await db.update(rounds).set({ends:Date.now()+60000,number:5,secret:'test-secret',commitment:commitmentFor(state.round.period,5,'test-secret')}).where(eq(rounds.period,state.round.period));
  const input={duration:30,period:state.round.period,pick:'5',stake:100,request:randomUUID(),payoutVersion:3};
  await assert.rejects(placeWingoBet(userId,{...input,payoutVersion:undefined}),/rates have changed/);
  await assert.rejects(placeWingoBet(userId,{...input,payoutVersion:2}),/rates have changed/);
  assert.equal((await getBalanceByUser(userId)).balance,10000n);
  await Promise.all([placeWingoBet(userId,input),placeWingoBet(userId,input)]);
  assert.equal((await getBalanceByUser(userId)).balance,9900n);
  // A pending longer round accepted before this release keeps its recorded price.
  const legacyPeriod=`300-${Date.now()}`;
  await db.insert(rounds).values({period:legacyPeriod,duration:300,start:Date.now()-300000,ends:Date.now()-1,number:5,secret:'legacy',commitment:commitmentFor(legacyPeriod,5,'legacy'),payoutVersion:2});
  const [legacy]=await db.insert(bets).values({userId,period:legacyPeriod,pick:'5',stake:100,request:randomUUID(),created:Date.now()-10000}).returning();
  await postEntry({userId,scope:'wingo',type:'bet',amount:-100n,refType:'wingo_bet',refId:legacy.id});
  await db.update(rounds).set({ends:Date.now()-1}).where(eq(rounds.period,state.round.period));
  await Promise.all([tickWingo(),tickWingo()]);
  assert.equal((await getBalanceByUser(userId)).balance,10848n);
  const settled=await db.select().from(bets).where(eq(bets.userId,userId));
  assert.equal(settled.find(b=>b.period===state.round.period)?.payout,198);
  assert.equal(settled.find(b=>b.period===legacyPeriod)?.payout,850);
  const wins=await db.select().from(walletLedgerTable).where(and(eq(walletLedgerTable.userId,userId),eq(walletLedgerTable.refType,'wingo_payout')));
  assert.equal(wins.length,2);
  await placeWingoBet(userId,input);
  assert.equal((await getBalanceByUser(userId)).balance,10848n);
});
