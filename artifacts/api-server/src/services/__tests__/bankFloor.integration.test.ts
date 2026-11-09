import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, networkNodesTable, networkBankEntriesTable, networkSettlementsTable, walletLedgerTable, type User } from "@workspace/db";
import { memory, ready } from "../../demo/database";
import { bankMasters, bankDetail, bankPreview, moveProfitToBank, distributeBank, distributionReceipt, proportionalShares } from "../bankFloor";
import { getBalanceByUser } from "../wallet";

let admin:User,masterA:User,masterB:User,agentA:User,p1:User,p2:User,other:User,b2c:User;
let a:string,b:string,agentId:string;
const id=()=>randomUUID();
async function user(role:User["role"]="player",agent?:string){const uid=id();const [row]=await db.insert(usersTable).values({id:uid,email:uid+"@test.invalid",emailNormalized:uid+"@test.invalid",passwordHash:"unused",role,channel:agent?"b2b":"b2c",b2bAgentId:agent}).returning();return row;}
async function node(owner:User,kind:"master"|"agent",parentId?:string){const [row]=await db.insert(networkNodesTable).values({userId:owner.id,name:kind,kind,parentId,createdBy:admin.id,companyFeeBps:2000,shareBps:kind==="master"?10000:0}).returning();return row.id;}
async function wager(player:User,stake:bigint,code="coin-flip"){
 const ref=id();await db.execute(sql`SELECT network_open_wager('bank-test',${ref},${player.id},${code},${stake.toString()}::bigint)`);
 await db.execute(sql`SELECT network_close_wager('bank-test',${ref},${stake.toString()}::bigint,${(stake/2n).toString()}::bigint,true)`);return ref;
}
before(async()=>{
 await ready;
 // Only this volatile PGlite instance is reset; every production migration and
 // network accounting trigger is then exercised, not simulated accounting.
 await memory.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
 const folder=path.resolve('../../lib/db/drizzle');const journal=JSON.parse(await readFile(path.join(folder,'meta/_journal.json'),'utf8'));
 for(const entry of journal.entries)await memory.exec(await readFile(path.join(folder,entry.tag+'.sql'),'utf8'));
 admin=await user('admin');masterA=await user('agent');masterB=await user('agent');agentA=await user('agent');
 a=await node(masterA,'master');b=await node(masterB,'master');agentId=await node(agentA,'agent',a);
 p1=await user('player',agentId);p2=await user('player',agentId);other=await user('player',await node(await user('agent'),'agent',b));b2c=await user();
 await wager(p1,12500000n);await wager(p2,37500000n,'poker-20-20');await wager(other,10000000n);await wager(b2c,100000000n);
});
after(()=>memory.close());

test('full migration chain and real profit splits expose only each master bank',async()=>{
 const data=await bankDetail(masterA,a);
 assert.equal(data.canDistribute,false);assert.equal(data.totals.settledStakePaise,'50000000');assert.equal(data.totals.branchProfitPaise,'25000000');
 assert.equal(data.totals.masterEarnedPaise,'20000000');assert.equal(data.totals.availableProfitPaise,'20000000');assert.equal(data.totals.actualMarginPercent,'50.00');
 assert.deepEqual((await bankMasters(masterA)).masters.map(m=>m.id),[a]);assert.equal((await bankMasters(admin)).masters.length,2);
 await assert.rejects(bankDetail(masterA,b),(e:any)=>e.status===403);await assert.rejects(bankMasters(agentA),(e:any)=>e.status===403);
});
test('only admin can reserve, return, preview or distribute; excess cannot mint money',async()=>{
 for(const actor of [masterA,masterB,agentA,p1,b2c]){
  await assert.rejects(moveProfitToBank(actor,a,'reserve',{amountPaise:'10000000',requestId:id()}),(e:any)=>e.status===403);
  await assert.rejects(moveProfitToBank(actor,a,'return',{amountPaise:'100',requestId:id()}),(e:any)=>e.status===403);
  await assert.rejects(bankPreview(actor,a,'100'),(e:any)=>e.status===403);
  await assert.rejects(distributeBank(actor,a,{}),(e:any)=>e.status===403);
 }
 await assert.rejects(moveProfitToBank(admin,a,'reserve',{amountPaise:'20000001',requestId:id()}),(e:any)=>e.status===400);
 assert.equal((await bankDetail(admin,a)).totals.bankBalancePaise,'0');
});
test('reserving 1 lakh from 2 lakh profit leaves 1 lakh and cannot reserve twice on retry',async()=>{
 const input={amountPaise:'10000000',requestId:id()};const [one,two]=await Promise.all([moveProfitToBank(admin,a,'reserve',input),moveProfitToBank(admin,a,'reserve',input)]);
 assert.equal(one.id,two.id);const data=await bankDetail(admin,a);assert.equal(data.totals.availableProfitPaise,'10000000');assert.equal(data.totals.bankBalancePaise,'10000000');
 const settlements=await db.select().from(networkSettlementsTable).where(eq(networkSettlementsTable.nodeId,a));assert.equal(settlements.length,1);
 await assert.rejects(moveProfitToBank(admin,a,'reserve',{...input,amountPaise:'10000001'}),(e:any)=>e.status===409);
});
test('preview weights all settled games 1:3 and excludes other branches and B2C',async()=>{
 const plan=await bankPreview(admin,a,'10000000');assert.equal(plan.recipientCount,2);assert.equal(plan.totalStakePaise,'50000000');
 const shares=new Map(plan.recipients.map(r=>[r.userId,r.amountPaise]));assert.equal(shares.get(p1.id),'2500000');assert.equal(shares.get(p2.id),'7500000');assert.equal(shares.has(other.id),false);assert.equal(shares.has(b2c.id),false);
 assert.equal((await getBalanceByUser(p1.id)).balance,0n);
});
test('distribution credits exact cash bonuses once and never edits wagers',async()=>{
 const plan=await bankPreview(admin,a,'10000000');const input={amountPaise:plan.amountPaise,cutoffAt:plan.cutoffAt,previewHash:plan.previewHash,requestId:id()};
 const before=await db.execute(sql`SELECT source,source_id,stake::text,payout::text,revision FROM network_wagers ORDER BY source_id`);
 const [one,two]=await Promise.all([distributeBank(admin,a,input),distributeBank(admin,a,input)]);assert.equal(one.id,two.id);
 assert.equal((await getBalanceByUser(p1.id)).balance,2500000n);assert.equal((await getBalanceByUser(p2.id)).balance,7500000n);assert.equal((await getBalanceByUser(other.id)).balance,0n);
 assert.equal((await bankDetail(masterA,a)).totals.bankBalancePaise,'0');assert.equal((await bankDetail(masterA,a)).totals.distributedPaise,'10000000');
 const after=await db.execute(sql`SELECT source,source_id,stake::text,payout::text,revision FROM network_wagers ORDER BY source_id`);assert.deepEqual(after.rows,before.rows);
 const receipt=await distributionReceipt(masterA,a,one.id);assert.equal(receipt.recipients.length,2);await assert.rejects(distributionReceipt(masterB,b,one.id),(e:any)=>e.status===404);
 const credits=await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.refId,one.id));assert.equal(credits.length,2);assert.ok(credits.every(c=>c.type==='bonus'&&c.memo?.startsWith('Profit bonus')));
});
test('returning unused funds restores outstanding profit and cannot return spent funds',async()=>{
 await assert.rejects(moveProfitToBank(admin,a,'return',{amountPaise:'1',requestId:id()}),(e:any)=>e.status===400);
 await moveProfitToBank(admin,a,'reserve',{amountPaise:'1000000',requestId:id()});const input={amountPaise:'200000',requestId:id()};
 const first=await moveProfitToBank(admin,a,'return',input);assert.equal((await moveProfitToBank(admin,a,'return',input)).id,first.id);
 const data=await bankDetail(admin,a);assert.equal(data.totals.bankBalancePaise,'800000');assert.equal(data.totals.availableProfitPaise,'9200000');
});
test('suspended recipients excluded and stale or expired previews cannot credit',async()=>{
 const plan=await bankPreview(admin,a,'100000');await db.update(usersTable).set({status:'suspended'}).where(eq(usersTable.id,p1.id));
 const eligible=await bankPreview(admin,a,'100000');assert.equal(eligible.recipientCount,1);assert.equal(eligible.recipients[0].userId,p2.id);
 const balance=(await getBalanceByUser(p2.id)).balance;
 await assert.rejects(distributeBank(admin,a,{amountPaise:plan.amountPaise,cutoffAt:plan.cutoffAt,previewHash:plan.previewHash,requestId:id()}),(e:any)=>e.status===409);
 await assert.rejects(distributeBank(admin,a,{amountPaise:eligible.amountPaise,cutoffAt:new Date(Date.now()-700000).toISOString(),previewHash:eligible.previewHash,requestId:id()}),(e:any)=>e.status===409);
 assert.equal((await getBalanceByUser(p2.id)).balance,balance);await db.update(usersTable).set({status:'active'}).where(eq(usersTable.id,p1.id));
});
test('concurrent overspend and changed bank balance reject without partial credits',async()=>{
 const plan=await bankPreview(admin,a,'800000');await moveProfitToBank(admin,a,'return',{amountPaise:'100000',requestId:id()});
 await assert.rejects(distributeBank(admin,a,{amountPaise:plan.amountPaise,cutoffAt:plan.cutoffAt,previewHash:plan.previewHash,requestId:id()}),(e:any)=>e.status===400);
 const results=await Promise.allSettled([moveProfitToBank(admin,a,'return',{amountPaise:'600000',requestId:id()}),moveProfitToBank(admin,a,'return',{amountPaise:'600000',requestId:id()})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await bankDetail(admin,a)).totals.bankBalancePaise,'100000');
});
test('every paise is allocated deterministically including zero-credit recipients',()=>{
 const weights=[{userId:'a',name:'A',stakePaise:'1'},{userId:'b',name:'B',stakePaise:'1'},{userId:'c',name:'C',stakePaise:'1'}];
 assert.deepEqual(proportionalShares(2n,weights).map(r=>r.amountPaise),['1','1','0']);
 for(const amount of [1n,101n,10000001n])assert.equal(proportionalShares(amount,weights).reduce((s,r)=>s+BigInt(r.amountPaise),0n),amount);
 assert.deepEqual(proportionalShares(2n,[...weights].reverse()),proportionalShares(2n,weights));
});
test('a wallet failure rolls back the complete distribution and bank debit',async()=>{
 const plan=await bankPreview(admin,a,'100000'),input={amountPaise:plan.amountPaise,cutoffAt:plan.cutoffAt,previewHash:plan.previewHash,requestId:id()};
 await memory.exec(`CREATE FUNCTION bank_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.ref_type='profit_distribution' THEN RAISE EXCEPTION 'forced credit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER bank_test_fail BEFORE INSERT ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION bank_test_fail();`);
 const before=(await getBalanceByUser(p1.id)).balance;
 await assert.rejects(distributeBank(admin,a,input));assert.equal((await bankDetail(admin,a)).totals.bankBalancePaise,'100000');assert.equal((await getBalanceByUser(p1.id)).balance,before);
 assert.equal((await db.select().from(networkBankEntriesTable).where(eq(networkBankEntriesTable.requestId,input.requestId))).length,0);
 await memory.exec('DROP TRIGGER bank_test_fail ON wallet_ledger; DROP FUNCTION bank_test_fail();');
 const retry=await distributeBank(admin,a,input);assert.equal(retry.kind,'distribute');assert.equal((await bankDetail(admin,a)).totals.bankBalancePaise,'0');
});

test('large distributions create wallets and credit every recipient across batches',async()=>{
 const master=await user('agent'),mid=await node(master,'master'),aid=await node(await user('agent'),'agent',mid);
 const rows=Array.from({length:600},()=>{const uid=id();return {id:uid,email:uid+'@test.invalid',emailNormalized:uid+'@test.invalid',passwordHash:'unused',role:'player' as const,channel:'b2b' as const,b2bAgentId:aid};});
 await db.insert(usersTable).values(rows);
 await db.execute(sql`SELECT network_open_wager('bank-test',id,id,'mines',10000) FROM users WHERE b2b_agent_id=${aid}`);
 await db.execute(sql`SELECT network_close_wager('bank-test',id,10000,0,true) FROM users WHERE b2b_agent_id=${aid}`);
 await moveProfitToBank(admin,mid,'reserve',{amountPaise:'60000',requestId:id()});
 const plan=await bankPreview(admin,mid,'60000');assert.equal(plan.recipientCount,600);assert.ok(plan.recipients.every(r=>r.amountPaise==='100'));
 const entry=await distributeBank(admin,mid,{amountPaise:plan.amountPaise,cutoffAt:plan.cutoffAt,previewHash:plan.previewHash,requestId:id()});
 const credits=await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.refId,entry.id));assert.equal(credits.length,600);assert.equal(credits.reduce((s,c)=>s+c.amount,0n),60000n);assert.ok(credits.every(c=>c.balanceAfter===100n));
});
