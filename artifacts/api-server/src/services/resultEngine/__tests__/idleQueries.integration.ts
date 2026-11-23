import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {db,gameEngineConfigTable,roundDecisionTable} from '@workspace/db';
import {ready,memory} from '../../../demo/database';
import {decideOutcomeFor,settleBank,cumulativeFor} from '../engine';
import type {OutcomeSpace} from '../../tableAdapter';

await ready;
after(()=>memory.close());
const space:OutcomeSpace={
 choices:()=>[{id:'a',label:'A'},{id:'b',label:'B'}],
 candidates:()=>[{choiceId:'a',outcome:'a'},{choiceId:'b',outcome:'b'}],
 forChoice:(_seed,id)=>id,classify:outcome=>String(outcome),
};
const base={gameCode:'roulette-mini',partnerId:null,seed:{serverSeed:'test',clientSeed:'test',nonce:0},space,
 drawHonest:()=> 'honest-draw',payoutFor:(_bets:unknown,outcome:unknown)=>outcome==='a'?200n:0n};
const observed:string[]=[];
const original=memory.query.bind(memory);
memory.query=((query:string,...args:unknown[])=>{observed.push(query);return (original as Function)(query,...args);}) as typeof memory.query;
const contextQueries=()=>observed.filter(q=>/game_bank_ledger|engine_bank_budget/.test(q));

test('idle rounds retain honest draw and audit without scanning bank history in any mode',async()=>{
 for(const mode of ['normal','collect','distribute','auto','rtp']){
  await db.insert(gameEngineConfigTable).values({streamKey:'roulette-mini',gameCode:'roulette-mini',mode,bankPaise:50000n})
   .onConflictDoUpdate({target:gameEngineConfigTable.streamKey,set:{mode}});
  observed.length=0;
  const roundId='idle-perf-'+mode;
  const result=await decideOutcomeFor({...base,roundId,book:[]});
  assert.equal(result.outcome,'honest-draw');assert.equal(result.source,'drawn');
  assert(!result.decision?.alerts.includes('ENGINE_FAILED'));
  assert.deepEqual(contextQueries(),[],mode+' must not read unused bank context');
  await result.commit();
  const [audit]=await db.select().from(roundDecisionTable).where(eq(roundDecisionTable.roundId,roundId));
  assert(audit,'idle round still has its normal audit');
 }
});

test('funded RTP rounds still read exact committed ledger totals and shared budget',async()=>{
 await db.update(gameEngineConfigTable).set({mode:'rtp'}).where(eq(gameEngineConfigTable.streamKey,'roulette-mini'));
 await settleBank({gameCode:'roulette-mini',partnerId:null,roundId:'funded-history',totalStakePaise:1000n,totalPayoutPaise:500n});
 // An idempotent recovery must not change the totals.
 await settleBank({gameCode:'roulette-mini',partnerId:null,roundId:'funded-history',totalStakePaise:1000n,totalPayoutPaise:500n});
 assert.deepEqual(await cumulativeFor('roulette-mini'),{stakedPaise:1000n,payoutPaise:500n});
 observed.length=0;
 const result=await decideOutcomeFor({...base,roundId:'funded-decision',book:[{userId:'test-player',stakePaise:100n,bets:{}}]});
 assert(observed.some(q=>q.includes('sum(')&&q.includes('game_bank_ledger')));
 assert(observed.some(q=>q.includes('engine_bank_budget')));
 assert(!result.decision?.alerts.includes('ENGINE_FAILED'));
});

test('funded auto rounds retain rolling history and normal mode never needs it',async()=>{
 for(const mode of ['auto','normal']){
  await db.update(gameEngineConfigTable).set({mode}).where(eq(gameEngineConfigTable.streamKey,'roulette-mini'));
  observed.length=0;
  const result=await decideOutcomeFor({...base,roundId:'funded-'+mode,book:[{userId:'test-player',stakePaise:100n,bets:{}}]});
  assert(!result.decision?.alerts.includes('ENGINE_FAILED'));
  if(mode==='auto')assert(observed.some(q=>q.includes('game_bank_ledger')));
  else {assert.deepEqual(contextQueries(),[]);assert.equal(result.outcome,'honest-draw');}
 }
});
