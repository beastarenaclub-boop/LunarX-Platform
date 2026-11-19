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
  const input=()=>({towerPayoutVersion:4 as const,requestId:randomUUID(),stakeAmount:"10000",clientSeed:"test-client",options});
  const move=(id:string,step:number,action:"reveal"|"cashout"="reveal",cell=0)=>moveInstant(userId,code,id,{action,expectedStep:step,cell,actionId:randomUUID()});
  async function fixture(crash:number,legacy=false) {
    const receipt=await placeInstant(userId,code,input());
    const [bet]=await db.select().from(betsTable).where(eq(betsTable.id,receipt.id));
    const metadata={...bet.metadata as any};
    metadata.maxMultiplier=1000;
    if(legacy) delete metadata.towerPayoutVersion;
    else {
      metadata.towerPayoutVersion=2;
      let seed="";
      for(let i=0;i<10000;i++) if(towerCrashFloor(`fixture-${i}`,metadata.clientSeed,metadata.rtp)===crash){seed=`fixture-${i}`;break;}
      assert(seed); metadata.serverSeed=seed;
    }
    await db.update(betsTable).set({metadata}).where(eq(betsTable.id,receipt.id));
    return {receipt,metadata};
  }
  await assert.rejects(placeInstant(userId,code,{...input(),towerPayoutVersion:undefined}),/rules have changed/i);
  await assert.rejects(placeInstant(userId,code,{...input(),towerPayoutVersion:2}),/rules have changed/i);
  await assert.rejects(placeInstant(userId,code,{...input(),towerPayoutVersion:3}),/rules have changed/i);
  assert.equal(await balance(),1000000n);
  const request=input(), start=await placeInstant(userId,code,request);
  assert.equal(start.towerPayoutVersion,4);
  assert.equal((await placeInstant(userId,code,request)).id,start.id);
  assert.equal((await placeInstant(userId,code,{...request,towerPayoutVersion:undefined})).id,start.id);
  assert.equal(await balance(),990000n);
  await assert.rejects(placeInstant(userId,code,input()),/current round/i);
  await assert.rejects(moveInstant(other,code,start.id,{action:"cashout",expectedStep:0,cell:0,actionId:randomUUID()}),/not found/i);
  const [startedBet]=await db.select().from(betsTable).where(eq(betsTable.id,start.id));
  const startedMetadata={...startedBet.metadata as any};
  for(let i=0;;i++) if(instantSafe("tower",`first-${i}`,startedMetadata.clientSeed,code,1,0,options,4,.97)){startedMetadata.serverSeed=`first-${i}`;break;}
  await db.update(betsTable).set({metadata:startedMetadata}).where(eq(betsTable.id,start.id));
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
  await updateGameConfig(code,{houseEdge:.5},userId);
  const low=await placeInstant(userId,code,input());assert.equal(low.rtp,.5);await move(low.id,0,"cashout");
  await updateGameConfig(code,{houseEdge:.03},userId);
  async function endlessFixture(crash:number,version:3|4=3) {
    const receipt=await placeInstant(userId,code,input());
    const [bet]=await db.select().from(betsTable).where(eq(betsTable.id,receipt.id));
    const metadata={...bet.metadata as any};
    metadata.towerPayoutVersion=version;metadata.maxMultiplier=version===3?1000:1.9;
    let seed="";
    for(let i=0;i<100000;i++) {
      let floor=1;
      while(floor<=crash&&instantSafe("tower",`endless-${i}`,metadata.clientSeed,code,floor,0,options,version,metadata.rtp))floor++;
      if(floor===crash){seed=`endless-${i}`;break;}
    }
    assert(seed);metadata.serverSeed=seed;
    await db.update(betsTable).set({metadata}).where(eq(betsTable.id,receipt.id));
    return receipt;
  }
  const beforeLoss=await balance(),firstLoss=await endlessFixture(1);
  const losingMove={action:"reveal" as const,expectedStep:0,cell:0,actionId:randomUUID()};
  assert.equal((await moveInstant(userId,code,firstLoss.id,losingMove)).status,"lost");
  assert.equal((await moveInstant(userId,code,firstLoss.id,losingMove)).payoutAmount,"0");
  assert.equal(await balance(),beforeLoss-10000n);
  const beforeLong=await balance(),long=await endlessFixture(101);
  await updateGameConfig(code,{houseEdge:.5},userId);
  let latest=long;
  for(let step=0;step<100;step++) {
    latest=await move(long.id,step);assert.equal(latest.status,"active");assert.equal(latest.rtp,.97);
    if(step===0)assert.equal(latest.cashoutAmount,"10");
    if(step===29)assert.equal(latest.cashoutAmount,"10000");
  }
  assert.equal(latest.multiplier,3.411);
  assert.equal((await move(long.id,100,"cashout")).payoutAmount,"34110");
  await move(long.id,100,"cashout");assert.equal(await balance(),beforeLong-10000n+34110n);
  const longCredits=await db.select().from(walletLedgerTable).where(and(eq(walletLedgerTable.refId,long.id),eq(walletLedgerTable.type,"win")));
  assert.equal(longCredits.length,1);
  assert.equal((await instantState(userId,code)).round,null);
  await updateGameConfig(code,{houseEdge:.03},userId);
  for(const [floor,expected] of [[5,15000n],[10,16000n],[15,17000n],[20,18000n],[25,19000n],[30,19000n]] as const) {
    const before=await balance(),receipt=await endlessFixture(31,4);
    let result=receipt;
    for(let step=0;step<floor;step++)result=await move(receipt.id,step);
    assert.equal(result.status,"active");assert.equal(result.maxMultiplier,1.9);assert.equal(result.cashoutAmount,String(expected));
    const action={action:"cashout" as const,expectedStep:floor,cell:0,actionId:randomUUID()};
    assert.equal((await moveInstant(userId,code,receipt.id,action)).payoutAmount,String(expected));
    await moveInstant(userId,code,receipt.id,action);assert.equal(await balance(),before-10000n+expected);
    const credits=await db.select().from(walletLedgerTable).where(and(eq(walletLedgerTable.refId,receipt.id),eq(walletLedgerTable.type,"win")));
    assert.equal(credits.length,1);
  }
  console.log(JSON.stringify({status:"passed",checks:["0.001x credits ten paise on a ₹100 stake exactly once","Zero-floor full refund","First 19 safe and crash at 20","Floor 30 returns 1x without automatic payout","Crash at 35, snapshot survives admin edit","Legacy rounds still cross 35 and retain old payout","Ownership, stale-step and old-page guards","V3 floor-one loss and deterministic replay","V3 crosses 35 and cashes out at 100 once","V3 supports lower admin RTP; active rounds retain snapshot","V4 five-floor milestones credit 150/160/170/180/190 rupees once","V4 can continue past the payout plateau without automatic settlement"]}));
} finally {await memory.close();}
