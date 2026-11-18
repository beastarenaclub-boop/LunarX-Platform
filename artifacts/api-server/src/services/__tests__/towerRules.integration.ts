// Run through tools/tower-assets/check_wallet.mjs: never connect this fixture to a real DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, usersTable, gameConfigTable, betsTable, walletLedgerTable } from "@workspace/db";
import { ready, memory } from "../../demo/database";
import { DEMO_RUNTIME } from "../../demo/runtime";
import { placeInstant, moveInstant, instantState } from "../instantCollection";
import { instantSafe, towerCrashFloor } from "../instantCollectionMath";
import { postEntry, getBalanceByUser } from "../wallet";
import { invalidateConfigCache, updateGameConfig } from "../rtp";
assert.equal(process.env.DATABASE_URL, "postgresql://invalid@127.0.0.1:1/forbidden");
await ready;
assert.equal(DEMO_RUNTIME, false);
const code="tower-rush", userId="tower-rules-test", other="tower-rules-other";
const options={difficulty:"easy" as const,mines:3,choice:"heads"};
try {
  await db.insert(usersTable).values([userId,other].map(id=>({id,email:`${id}@example.test`,emailNormalized:`${id}@example.test`,passwordHash:"test-only"})));
  await db.insert(gameConfigTable).values({gameCode:code,enabled:true,houseEdge:.03,minStakePaise:100n,maxStakePaise:100000n,maxMultiplier:1000});
  await postEntry({userId,type:"deposit",amount:1000000n});
  const balance=async()=>(await getBalanceByUser(userId)).balance;
  const input=()=>({towerPayoutVersion:2 as const,requestId:randomUUID(),stakeAmount:"10000",clientSeed:"test-client",options});
  const move=(id:string,step:number,action:"reveal"|"cashout"="reveal",cell=0)=>moveInstant(userId,code,id,{action,expectedStep:step,cell,actionId:randomUUID()});
  async function fixture(crash:number,legacy=false) {
    const receipt=await placeInstant(userId,code,input());
    const [bet]=await db.select().from(betsTable).where(eq(betsTable.id,receipt.id));
    const metadata={...bet.metadata as any};
    if(legacy) delete metadata.towerPayoutVersion;
    else {
      let seed="";
      for(let i=0;i<10000;i++) if(towerCrashFloor(`fixture-${i}`,metadata.clientSeed,metadata.rtp)===crash){seed=`fixture-${i}`;break;}
      assert(seed); metadata.serverSeed=seed;
    }
    await db.update(betsTable).set({metadata}).where(eq(betsTable.id,receipt.id));
    return {receipt,metadata};
  }
  await assert.rejects(placeInstant(userId,code,{...input(),towerPayoutVersion:undefined}),/rules have changed/i);
  assert.equal(await balance(),1000000n);
  const request=input(), start=await placeInstant(userId,code,request);
  assert.equal(start.towerPayoutVersion,2);
  assert.equal((await placeInstant(userId,code,request)).id,start.id);
  assert.equal((await placeInstant(userId,code,{...request,towerPayoutVersion:undefined})).id,start.id);
  assert.equal(await balance(),990000n);
  await assert.rejects(placeInstant(userId,code,input()),/current round/i);
  await assert.rejects(moveInstant(other,code,start.id,{action:"cashout",expectedStep:0,cell:0,actionId:randomUUID()}),/not found/i);
  const firstAction={action:"reveal" as const,expectedStep:0,cell:0,actionId:randomUUID()};
  const first=await moveInstant(userId,code,start.id,firstAction);
  assert.equal(first.multiplier,.001);assert.equal(first.cashoutAmount,"10");
  assert.equal((await moveInstant(userId,code,start.id,firstAction)).step,1);
  await assert.rejects(move(start.id,0),/changed/i);
  assert.equal((await move(start.id,1,"cashout")).payoutAmount,"10");
  await move(start.id,1,"cashout");assert.equal(await balance(),990010n);
  const refund=await placeInstant(userId,code,input());await move(refund.id,0,"cashout");assert.equal(await balance(),990010n);

  const {receipt:early}=await fixture(20);
  for(let step=0;step<19;step++) assert.equal((await move(early.id,step)).status,"active");
  assert.equal((await move(early.id,19)).status,"lost");
  assert.equal((await move(early.id,19,"cashout")).payoutAmount,"0");
  assert.equal(await balance(),980010n);

  const {receipt:late}=await fixture(35);
  await updateGameConfig(code,{houseEdge:.15},userId);
  let current=late;
  for(let step=0;step<30;step++){current=await move(late.id,step);assert.equal(current.status,"active");assert.equal(current.rtp,.97);}
  assert.equal(current.multiplier,1);assert.equal(current.cashoutAmount,"10000");assert.equal(await balance(),970010n);
  assert.equal((await move(late.id,30,"cashout")).payoutAmount,"10000");
  await move(late.id,30,"cashout");assert.equal(await balance(),980010n);
  const credits=await db.select().from(walletLedgerTable).where(and(eq(walletLedgerTable.refId,late.id),eq(walletLedgerTable.type,"win")));
  assert.equal(credits.length,1);

  const {receipt:edge}=await fixture(35);assert.equal(edge.rtp,.85);
  for(let step=0;step<34;step++) assert.equal((await move(edge.id,step)).status,"active");
  assert.equal((await move(edge.id,34)).status,"lost");
  assert.equal(await balance(),970010n);

  const {receipt:legacy,metadata}=await fixture(35,true);
  let old=legacy;
  for(let step=0;step<36;step++) {
    const cell=[0,1,2].find(c=>instantSafe("tower",metadata.serverSeed,metadata.clientSeed,code,step+1,c,options))!;
    old=await move(legacy.id,step,"reveal",cell);assert.equal(old.status,"active");assert.equal(old.towerPayoutVersion,1);
  }
  assert.equal(old.multiplier,1000);assert.equal((await move(legacy.id,36,"cashout")).payoutAmount,"10000000");
  assert.equal((await instantState(userId,code)).round,null);
  await assert.rejects(updateGameConfig(code,{houseEdge:.5},userId),/62.1%/);
  console.log(JSON.stringify({status:"passed",checks:["0.001x credits ten paise on a ₹100 stake exactly once","Zero-floor full refund","First 19 safe and crash at 20","Floor 30 returns 1x without automatic payout","Crash at 35, snapshot survives admin edit","Legacy rounds still cross 35 and retain old payout","Ownership, stale-step, replay and minimum-RTP guards"]}));
} finally {await memory.close();}
