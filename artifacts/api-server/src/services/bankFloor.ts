import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, networkNodesTable, networkBankEntriesTable, networkProfitDistributionsTable, networkProfitRecipientsTable,
  networkSettlementsTable, walletLedgerTable, auditLogTable, type User } from "@workspace/db";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { networkIdentity } from "./network";
import { publishWalletBalance, type TxClient } from "./wallet";

const amountSchema = z.string().regex(/^[1-9]\d{0,14}$/, "Enter a positive amount in paise");
export const bankActionInput = z.object({ amountPaise: amountSchema, requestId: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/) }).strict();
export const bankDistributeInput = bankActionInput.extend({ cutoffAt: z.string().datetime(), previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Reader = Pick<typeof db, "execute">;
type BankTotals = { settledStakePaise:string;playerPayoutPaise:string;branchProfitPaise:string;masterEarnedPaise:string;settledOrReservedPaise:string;
  unallocatedProfitPaise:string;availableProfitPaise:string;bankBalancePaise:string;reservedPaise:string;returnedPaise:string;distributedPaise:string };
type Recipient = { userId: string; name: string; stakePaise: string; amountPaise: string };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const serialEntry = (row: typeof networkBankEntriesTable.$inferSelect) => ({ ...row, amount: row.amount.toString(), balanceAfter: row.balanceAfter.toString() });

export async function bankAccess(user: User, masterId: string, write = false) {
  const actor = await networkIdentity(user);
  if (write && actor.role !== "admin") throw forbidden("Only admin can reserve or distribute profit bonuses");
  if (actor.role === "agent" || (actor.role === "master" && actor.node.id !== masterId)) throw forbidden("This profit bank is outside your access");
  return actor;
}

export async function bankMasters(user: User) {
  const actor = await networkIdentity(user);
  if (actor.role === "agent") throw forbidden("Master profit bank access required");
  const masters = await db.select({ id: networkNodesTable.id, name: networkNodesTable.name }).from(networkNodesTable)
    .where(actor.role === "admin" ? eq(networkNodesTable.kind, "master") : eq(networkNodesTable.id, actor.node.id));
  return { role: actor.role, canDistribute: actor.role === "admin", masters };
}

async function summary(masterId: string, reader: Reader = db) {
  const result = await reader.execute(sql`WITH earnings AS (
    SELECT COALESCE(sum(gross_stake),0) stake,COALESCE(sum(gross_payout),0) payout,COALESCE(sum(amount),0) earned
    FROM network_ledger WHERE account_id=${masterId} AND account_kind='master'
  ), settled AS (SELECT COALESCE(sum(amount),0) amount FROM network_settlements WHERE node_id=${masterId}),
  bank AS (SELECT COALESCE(sum(amount),0) balance,
    COALESCE(sum(amount) FILTER(WHERE kind='reserve'),0) reserved,
    -COALESCE(sum(amount) FILTER(WHERE kind='return'),0) returned,
    -COALESCE(sum(amount) FILTER(WHERE kind='distribute'),0) distributed FROM network_bank_entries WHERE master_id=${masterId})
  SELECT stake::text AS "settledStakePaise",payout::text AS "playerPayoutPaise",(stake-payout)::text AS "branchProfitPaise",
    earned::text AS "masterEarnedPaise",settled.amount::text AS "settledOrReservedPaise",
    (earned-settled.amount)::text AS "unallocatedProfitPaise",greatest(earned-settled.amount,0)::text AS "availableProfitPaise",
    balance::text AS "bankBalancePaise",reserved::text AS "reservedPaise",returned::text AS "returnedPaise",distributed::text AS "distributedPaise"
    FROM earnings,settled,bank`);
  const row = result.rows[0] as BankTotals;
  const stake = BigInt(row.settledStakePaise);
  return { ...row, actualMarginPercent: stake > 0n ? (Number(BigInt(row.branchProfitPaise) * 10000n / stake) / 100).toFixed(2) : null };
}

export async function bankDetail(user: User, masterId: string) {
  const actor = await bankAccess(user, masterId);
  const [master] = await db.select().from(networkNodesTable).where(and(eq(networkNodesTable.id, masterId), eq(networkNodesTable.kind, "master")));
  if (!master) throw notFound("Master not found");
  const [totals, history] = await Promise.all([summary(masterId), db.execute(sql`SELECT e.id,e.kind,e.amount::text,e.balance_after::text AS "balanceAfter",e.created_at AS "createdAt",u.email AS "createdBy",
    d.recipient_count AS "recipientCount",d.total_stake::text AS "totalStakePaise",d.cutoff_at AS "cutoffAt"
    FROM network_bank_entries e JOIN users u ON u.id=e.created_by LEFT JOIN network_profit_distributions d ON d.id=e.id
    WHERE e.master_id=${masterId} ORDER BY e.created_at DESC,e.id DESC LIMIT 100`)]);
  return { master: { id: master.id, name: master.name, playerRtpBps: master.playerRtpBps }, canDistribute: actor.role === "admin", totals, history: history.rows };
}

/** Largest remainders allocate every paise, independent of win/loss and game. */
export function proportionalShares(amount: bigint, weights: { userId: string; name: string; stakePaise: string }[]): Recipient[] {
  if (amount <= 0n || !weights.length || new Set(weights.map(r => r.userId)).size !== weights.length) throw badRequest("No eligible settled stakes");
  const total = weights.reduce((sum,r) => sum + BigInt(r.stakePaise), 0n);
  if (weights.some(r => BigInt(r.stakePaise) <= 0n)) throw badRequest("Invalid settled stake");
  const rows = weights.map(r => ({ ...r, amount: amount * BigInt(r.stakePaise) / total, remainder: amount * BigInt(r.stakePaise) % total }));
  let rest = amount - rows.reduce((sum,r) => sum + r.amount,0n);
  const ordered = [...rows].sort((a,b) => a.remainder === b.remainder ? a.userId.localeCompare(b.userId, "en") : a.remainder > b.remainder ? -1 : 1);
  for (const row of ordered) { if (!rest) break; row.amount++; rest--; }
  return rows.sort((a,b) => a.userId.localeCompare(b.userId,"en")).map(r => ({ userId:r.userId,name:r.name,stakePaise:r.stakePaise,amountPaise:r.amount.toString() }));
}

async function preview(masterId: string, amountPaise: string, cutoffAt: string, reader: Reader = db) {
  const totals = await summary(masterId,reader);
  if (BigInt(amountPaise) > BigInt(totals.bankBalancePaise)) throw badRequest("Amount exceeds the reserved bank floor balance");
  const weights = await reader.execute(sql`SELECT w.user_id AS "userId",COALESCE(u.display_name,u.email) AS name,sum(w.stake)::text AS "stakePaise"
    FROM network_wagers w JOIN users u ON u.id=w.user_id JOIN network_nodes a ON a.id=w.agent_id JOIN users au ON au.id=a.user_id
    WHERE w.master_id=${masterId} AND w.channel='b2b' AND w.settled=true AND w.stake>0 AND w.settled_at<=${cutoffAt}::timestamptz
      AND u.channel='b2b' AND u.role='player' AND u.status='active' AND u.b2b_agent_id=a.id AND a.parent_id=${masterId} AND a.status='active' AND au.status='active'
    GROUP BY w.user_id,u.display_name,u.email ORDER BY w.user_id`);
  const recipients = proportionalShares(BigInt(amountPaise),weights.rows as { userId:string;name:string;stakePaise:string }[]);
  const totalStakePaise = recipients.reduce((s,r) => s+BigInt(r.stakePaise),0n).toString();
  const previewHash = hash([masterId,amountPaise,cutoffAt,totals.bankBalancePaise,recipients]);
  return { amountPaise, cutoffAt, previewHash, bankBalancePaise:totals.bankBalancePaise, totalStakePaise, recipients,
    recipientCount:recipients.filter(r=>BigInt(r.amountPaise)>0n).length, eligibleCount:recipients.length };
}

export async function bankPreview(user: User, masterId: string, amountPaise: string) {
  await bankAccess(user,masterId,true);amountSchema.parse(amountPaise);
  const [master] = await db.select().from(networkNodesTable).where(eq(networkNodesTable.id,masterId));
  if (!master || master.kind!=="master") throw notFound("Master not found");
  if (master.status!=="active") throw badRequest("Master is suspended");
  return preview(masterId,amountPaise,new Date().toISOString());
}

async function lockMaster(tx: TxClient, masterId: string, requestId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"bank-floor:"+requestId},0))`);
  const [master] = await tx.select().from(networkNodesTable).where(eq(networkNodesTable.id,masterId)).for("update");
  if (!master || master.kind!=="master") throw notFound("Master not found");
  return master;
}
async function priorEntry(tx: TxClient, user: User, masterId: string, kind: string, input: { requestId:string;amountPaise:string;previewHash?:string }) {
  const [prior] = await tx.select().from(networkBankEntriesTable).where(eq(networkBankEntriesTable.requestId,input.requestId));
  if (!prior) return null;
  if (prior.masterId!==masterId || prior.kind!==kind || prior.createdBy!==user.id || (prior.amount<0n?-prior.amount:prior.amount).toString()!==input.amountPaise ||
      (kind==="distribute" && prior.details.previewHash!==input.previewHash)) throw conflict("Request ID already used for another operation");
  return prior;
}
async function audit(tx: TxClient,user: User,entry: typeof networkBankEntriesTable.$inferSelect) {
  await tx.insert(auditLogTable).values({actorId:user.id,actorRole:user.role,action:"network.bank_floor."+entry.kind,targetType:"network",targetId:entry.masterId,after:serialEntry(entry)});
}

export async function moveProfitToBank(user: User, masterId: string, kind: "reserve" | "return", body: unknown) {
  await bankAccess(user,masterId,true);const input=bankActionInput.parse(body), amount=BigInt(input.amountPaise);
  return db.transaction(async tx=>{
    const master=await lockMaster(tx,masterId,input.requestId);
    const prior=await priorEntry(tx,user,masterId,kind,input);if(prior)return serialEntry(prior);
    if(master.status!=="active" && kind==="reserve")throw badRequest("Master is suspended");
    const totals=await summary(masterId,tx), balance=BigInt(totals.bankBalancePaise);
    if(kind==="reserve" && amount>BigInt(totals.availableProfitPaise))throw badRequest("Amount exceeds this master's available settled profit");
    if(kind==="return" && amount>balance)throw badRequest("Amount exceeds the unused bank floor balance");
    const signed=kind==="reserve"?amount:-amount,id=nanoid(),settlementId=nanoid();
    // Reserving profit consumes the same outstanding balance as a settlement.
    // The node lock also serializes the existing settlement route.
    await tx.insert(networkSettlementsTable).values({id:settlementId,nodeId:masterId,amount:signed,reference:`Bank floor ${kind}: ${id}`,requestId:`bank:${input.requestId}`,createdBy:user.id});
    const [entry]=await tx.insert(networkBankEntriesTable).values({id,masterId,kind,amount:signed,balanceAfter:balance+signed,requestId:input.requestId,createdBy:user.id,settlementId}).returning();
    await audit(tx,user,entry);return serialEntry(entry);
  });
}

async function creditRecipients(tx: TxClient, rows: Recipient[], distributionId: string, actorId: string) {
  const paying=rows.filter(r=>BigInt(r.amountPaise)>0n);
  const payload=JSON.stringify(paying.map(r=>({id:nanoid(),userId:r.userId,amount:r.amountPaise})));
  await tx.execute(sql`INSERT INTO wallets(id,user_id,currency,scope)
    SELECT x.id,x."userId",'INR','lunar' FROM jsonb_to_recordset(${payload}::jsonb) AS x(id text,"userId" text,amount text)
    ON CONFLICT(user_id,currency,scope) DO NOTHING`);
  // All wallet locks are acquired in a stable order before calculating balances.
  const locked=await tx.execute(sql`SELECT id,user_id AS "userId" FROM wallets WHERE currency='INR' AND scope='lunar'
    AND user_id IN(SELECT x."userId" FROM jsonb_to_recordset(${payload}::jsonb) AS x("userId" text)) ORDER BY id FOR UPDATE`);
  const balances=await tx.execute(sql`SELECT w.id,w.user_id AS "userId",COALESCE(sum(l.amount),0)::text balance
    FROM wallets w LEFT JOIN wallet_ledger l ON l.wallet_id=w.id WHERE w.currency='INR' AND w.scope='lunar'
      AND w.user_id IN(SELECT x."userId" FROM jsonb_to_recordset(${payload}::jsonb) AS x("userId" text)) GROUP BY w.id`);
  if(locked.rows.length!==paying.length)throw new Error("Missing distribution wallet");
  const byUser=new Map(balances.rows.map(r=>[String(r.userId),r]));
  const credits=paying.map(r=>{const wallet=byUser.get(r.userId)!;return {id:nanoid(),walletId:String(wallet.id),userId:r.userId,type:"bonus" as const,amount:BigInt(r.amountPaise),balanceAfter:BigInt(String(wallet.balance))+BigInt(r.amountPaise),refType:"profit_distribution",refId:distributionId,memo:"Profit bonus - proportional share of settled stakes",createdBy:actorId};});
  for(let i=0;i<credits.length;i+=500)await tx.insert(walletLedgerTable).values(credits.slice(i,i+500));
  return credits;
}

export async function distributeBank(user: User, masterId: string, body: unknown) {
  await bankAccess(user,masterId,true);const input=bankDistributeInput.parse(body),amount=BigInt(input.amountPaise);
  const result=await db.transaction(async tx=>{
    const master=await lockMaster(tx,masterId,input.requestId);
    const prior=await priorEntry(tx,user,masterId,"distribute",input);if(prior)return {entry:prior,credits:[]};
    if(master.status!=="active")throw badRequest("Master is suspended");
    const age=Date.now()-new Date(input.cutoffAt).getTime();
    if(age<0 || age>600000)throw conflict("Preview expired. Review the distribution again.");
    const plan=await preview(masterId,input.amountPaise,input.cutoffAt,tx);
    if(plan.previewHash!==input.previewHash)throw conflict("Profit bank or eligible stakes changed. Review a new preview.");
    const id=nanoid(),[entry]=await tx.insert(networkBankEntriesTable).values({id,masterId,kind:"distribute",amount:-amount,
      balanceAfter:BigInt(plan.bankBalancePaise)-amount,requestId:input.requestId,createdBy:user.id,
      details:{previewHash:input.previewHash,cutoffAt:input.cutoffAt,recipientCount:plan.recipientCount}}).returning();
    await tx.insert(networkProfitDistributionsTable).values({id,cutoffAt:new Date(input.cutoffAt),totalStake:BigInt(plan.totalStakePaise),recipientCount:plan.recipientCount,previewHash:input.previewHash});
    const credits=await creditRecipients(tx,plan.recipients,id,user.id),creditIds=new Map(credits.map(c=>[c.userId,c.id]));
    const recipients=plan.recipients.map(r=>({distributionId:id,userId:r.userId,stake:BigInt(r.stakePaise),amount:BigInt(r.amountPaise),walletEntryId:creditIds.get(r.userId)??null}));
    for(let i=0;i<recipients.length;i+=500)await tx.insert(networkProfitRecipientsTable).values(recipients.slice(i,i+500));
    await audit(tx,user,entry);return {entry,credits};
  });
  for(const credit of result.credits)publishWalletBalance({userId:credit.userId,balance:credit.balanceAfter,entryType:"bonus",amount:credit.amount});
  return serialEntry(result.entry);
}

export async function distributionReceipt(user: User, masterId: string, id: string) {
  await bankAccess(user,masterId);
  const [entry]=await db.select().from(networkBankEntriesTable).where(and(eq(networkBankEntriesTable.id,id),eq(networkBankEntriesTable.masterId,masterId),eq(networkBankEntriesTable.kind,"distribute")));
  if(!entry)throw notFound("Distribution not found");
  const rows=await db.execute(sql`SELECT r.user_id AS "userId",COALESCE(u.display_name,u.email) AS name,r.stake::text AS "stakePaise",r.amount::text AS "amountPaise"
    FROM network_profit_recipients r JOIN users u ON u.id=r.user_id WHERE r.distribution_id=${id} ORDER BY r.user_id`);
  return {entry:serialEntry(entry),recipients:rows.rows};
}
