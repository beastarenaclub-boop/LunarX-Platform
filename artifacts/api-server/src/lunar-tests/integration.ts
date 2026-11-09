import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, usersTable, gameConfigTable, tableRoundsTable, b2cRtpPoliciesTable } from '@workspace/db';
import { ready, memory } from '../demo/database';
import { ensureGameConfigDefaults } from '../lib/bootstrap';
import { getBalanceByUser, postEntry } from '../services/wallet';
import { deriveCrashPoint, invalidateConfigCache, sha256Hex } from '../services/rtp';
import { requirePlayerGameConfig } from '../services/masterRtp';
import gameRouter from '../routes/game';
import crashRouter from '../routes/crash';
import betsRouter from '../routes/bets';
import walletRouter from '../routes/wallet';
import { errorHandler } from '../middlewares/error';
import { browserChecks } from './browser';

after(async()=>{await memory.close();});
test('Lunar: migration, saved settings, committed rounds, ownership, wallet and idempotent auto settlement', {timeout:120000}, async()=>{
  await ready;
  await db.insert(gameConfigTable).values({gameCode:'lunar',enabled:false,houseEdge:.07,maxStakePaise:999900n});
  await memory.exec(await readFile(resolve('../../lib/db/drizzle/0066_lunar_aviator.sql'),'utf8'));
  await ensureGameConfigDefaults();
  let [cfg]=await db.select().from(gameConfigTable).where(eq(gameConfigTable.gameCode,'lunar'));
  assert.equal(cfg.enabled,true); assert.equal(cfg.houseEdge,.07); assert.equal(cfg.maxStakePaise,999900n);
  await db.update(gameConfigTable).set({enabled:false}).where(eq(gameConfigTable.gameCode,'lunar'));
  await ensureGameConfigDefaults();
  [cfg]=await db.select().from(gameConfigTable).where(eq(gameConfigTable.gameCode,'lunar'));
  assert.equal(cfg.enabled,false,'Admin disable must survive restart');
  await db.update(gameConfigTable).set({enabled:true,bettingWindowMs:15000,maxMultiplier:2,interRoundDelayMs:1000,houseEdge:.07, minStakePaise:100n}).where(eq(gameConfigTable.gameCode,'lunar'));
  invalidateConfigCache();
  const actors=['player','other','admin'];
  await db.insert(usersTable).values(actors.map(id=>({id,email:`${id}@lunar.test`,emailNormalized:`${id}@lunar.test`,passwordHash:'test',role:id==='admin'?'admin' as const:'player' as const,displayName:id,channel:'b2c' as const})));
  for(const userId of actors) await postEntry({userId,type:'deposit',amount:1000000n,refType:'test',refId:`fund-${userId}`});
  await db.insert(b2cRtpPoliciesTable).values({gameCode:'lunar',playerRtpBps:9500,revision:1});
  assert.equal((await requirePlayerGameConfig('lunar','player')).houseEdge,.05,'Lunar must inherit B2C RTP policy');
  const users=new Map((await db.select().from(usersTable)).map(u=>[u.id,u]));
  const app=express(); app.use(express.json());
  app.use((req,_res,next)=>{req.user=users.get(String(req.headers['x-actor']));next();});
  app.get('/api/auth/me',(req,res)=>req.user?res.json(req.user):res.sendStatus(401));
  app.get('/api/auth/site',(_req,res)=>res.json({channel:'b2c',signupEnabled:true}));
  app.get('/api/network/website',(_req,res)=>res.json(null));
  app.use('/api/game',gameRouter); app.use('/api/crash',crashRouter); app.use('/api/bets',betsRouter); app.use('/api/wallet',walletRouter);
  app.use(errorHandler);
  if(process.env.LUNAR_BROWSER){
    const web=resolve('../../tmp/lunar-release-web');
    app.use(express.static(web)); app.get(/^(?!\/api\/).*/ ,(_req,res)=>res.sendFile(resolve(web,'index.html')));
  }
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const request=async(path:string,body?:unknown,actor='player')=>{
    const response=await fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{'x-actor':actor,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json() as any};
  };
  try {
    const registry=await request('game/registry');
    assert.deepEqual(registry.data.find((g:any)=>g.gameCode==='lunar'),{gameCode:'lunar',title:'Aviator',route:'/aviator-pro',enabled:true,maxMultiplier:2,maxStakePaise:'999900'});
    assert.ok(!registry.data.some((g:any)=>g.gameCode==='aviator'));
    assert.equal((await request('crash/lunar',undefined,'')).status,401);
    const {data:round,status}=await request('crash/lunar'); assert.equal(status,200);
    assert.equal(round.serverSeed,null); assert.equal(round.crashPoint,null); assert.equal(round.houseEdge,.05);
    assert.equal((await request(`crash/lunar?roundId=${round.id}`,undefined,'other')).status,404);
    const before=(await getBalanceByUser('player')).balance;
    const invalid=await request('bets/place',{gameCode:'lunar',roundId:round.id,stakeAmount:'1000000',panel:0}); assert.equal(invalid.status,400);
    const placed=await request('bets/place',{gameCode:'lunar',roundId:round.id,stakeAmount:'10000',autoCashOut:1.01,panel:0});
    assert.equal(placed.status,200,JSON.stringify(placed.data));
    assert.equal((await getBalanceByUser('player')).balance,before-10000n);
    assert.equal((await request(`bets/${placed.data.id}/cashout`,{multiplier:1.01})).status,400,'Cannot cash out before flight');
    assert.equal((await request(`bets/${placed.data.id}/cashout`,{multiplier:1.01},'other')).status,404);
    // Advance only the isolated SQL clock, keeping the original seed/outcome
    // and snapshotted prices. No mutation or bet touches production.
    const [saved]=await db.select().from(tableRoundsTable).where(eq(tableRoundsTable.id,round.id));
    const point=(saved.outcome as {crashPoint:number}).crashPoint;
    await db.update(gameConfigTable).set({houseEdge:.30}).where(eq(gameConfigTable.gameCode,'lunar')); invalidateConfigCache();
    await db.update(tableRoundsTable).set({bettingEndsAt:new Date(Date.now()-20000),revealEndsAt:new Date(Date.now()-1000),settleEndsAt:new Date(Date.now()+10000)}).where(eq(tableRoundsTable.id,round.id));
    const settled=await request(`crash/lunar?roundId=${round.id}`); assert.equal(settled.status,200);
    assert.equal(sha256Hex(settled.data.serverSeed),round.serverSeedHash);
    assert.equal(deriveCrashPoint(settled.data.serverSeed,round.clientSeed,round.nonce,round.houseEdge,round.maxMultiplier,3),point);
    const winner=point>1.01, payout=winner?10100n:0n;
    assert.equal(settled.data.bets[0].status,winner?'cashed_out':'lost'); assert.equal(settled.data.bets[0].payoutAmount,payout.toString());
    assert.equal((await getBalanceByUser('player')).balance,before-10000n+payout);
    await request(`crash/lunar?roundId=${round.id}`);
    await request(`bets/${placed.data.id}/cashout`,{multiplier:1000});
    assert.equal((await getBalanceByUser('player')).balance,before-10000n+payout,'Retries cannot double-credit');
    assert.equal((await request('bets/place',{gameCode:'lunar',roundId:round.id,stakeAmount:'10000',panel:1})).status,400);
    for(const game of ['jetx','fury']) assert.equal((await request(`crash/${game}`)).status,200);
    if(process.env.LUNAR_BROWSER) await browserChecks(base);
  } finally {server.close();server.closeAllConnections();}
});
