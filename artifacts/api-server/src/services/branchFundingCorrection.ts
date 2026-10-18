import { and, eq, sql } from "drizzle-orm";
import { db, usersTable, networkNodesTable, paymentRequestsTable, walletLedgerTable, auditLogTable, type User } from "@workspace/db";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { isNetworkAdmin } from "./network";
import { postEntry, publishWalletBalance } from "./wallet";

// An explicit, idempotent correction preserves the original approval and player
// credit. Never rewrite ledger history or credit the customer a second time.
export async function correctBranchFunding(user: User, masterId: string, id: string, reason: string) {
  if (!isNetworkAdmin(user)) throw forbidden("Only admin can correct historical funding");
  const changes: Parameters<typeof publishWalletBalance>[0][] = [];
  try {
    const result = await db.transaction(async tx => {
      const [master] = await tx.select().from(networkNodesTable).where(and(eq(networkNodesTable.id, masterId), eq(networkNodesTable.kind, "master"))).for("share");
      if (!master) throw notFound();
      const [deposit] = await tx.select().from(paymentRequestsTable).where(and(eq(paymentRequestsTable.id, id), eq(paymentRequestsTable.collectionMasterId, masterId))).for("update");
      if (!deposit || deposit.kind !== "deposit" || deposit.method !== "manual" || deposit.status !== "approved") throw badRequest("Only approved branch manual deposits can be corrected");
      const [customer] = await tx.select().from(usersTable).where(eq(usersTable.id, deposit.userId)).for("share");
      const agentId = deposit.fundingAgentId ?? customer?.b2bAgentId;
      const [agent] = agentId ? await tx.select().from(networkNodesTable).where(eq(networkNodesTable.id, agentId)).for("share") : [];
      if (!agent || agent.kind !== "agent" || agent.parentId !== masterId || customer?.b2bAgentId !== agent.id || customer.channel !== "b2b")
        throw conflict("Customer branch changed; review funding manually");
      const entries = await tx.select().from(walletLedgerTable).where(eq(walletLedgerTable.refId, id));
      const old = entries.filter(e => e.refType === "master_deposit_funding");
      if (old.length !== 1 || old[0]!.userId !== master.userId || old[0]!.amount !== -deposit.amount)
        throw conflict("Original master funding does not match this deposit");
      const originalCredit = entries.filter(e => e.refType === "deposit" && e.userId === customer.id);
      if (originalCredit.length !== 1 || originalCredit[0]!.id !== deposit.ledgerEntryId || originalCredit[0]!.amount !== deposit.amount)
        throw conflict("Original customer credit needs reconciliation");
      const refunded = entries.filter(e => e.refType === "master_deposit_funding_correction");
      const funded = entries.filter(e => e.refType === "agent_deposit_funding");
      if (refunded.length || funded.length) {
        if (refunded.length === 1 && funded.length === 1 && refunded[0]!.userId === master.userId && refunded[0]!.amount === deposit.amount && funded[0]!.userId === agent.userId && funded[0]!.amount === -deposit.amount)
          return { id, corrected: true, alreadyCorrected: true, amountPaise: deposit.amount.toString() };
        throw conflict("Existing funding correction needs reconciliation");
      }
      for (const uid of [master.userId, agent.userId].sort())
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`network-funds:${uid}`},0))`);
      // Match the existing transfer lock order before posting either side.
      const debit = await postEntry({ userId: agent.userId, type: "adjustment", amount: -deposit.amount, refType: "agent_deposit_funding", refId: id, memo: reason, createdBy: user.id }, tx);
      const credit = await postEntry({ userId: master.userId, type: "adjustment", amount: deposit.amount, refType: "master_deposit_funding_correction", refId: id, memo: reason, createdBy: user.id }, tx);
      await tx.update(paymentRequestsTable).set({ fundingAgentId: agent.id }).where(eq(paymentRequestsTable.id, id));
      await tx.insert(auditLogTable).values({ actorId: user.id, actorRole: user.role, action: "network.deposit.correct_funding", targetType: "deposit", targetId: id,
        before: { fundingUserId: master.userId, originalEntryId: old[0]!.id },
        after: { fundingAgentId: agent.id, amountPaise: deposit.amount.toString(), agentEntryId: debit.entry.id, masterEntryId: credit.entry.id, reason },
      });
      changes.push({ userId: agent.userId, entryType: "adjustment", amount: -deposit.amount, balance: debit.entry.balanceAfter }, { userId: master.userId, entryType: "adjustment", amount: deposit.amount, balance: credit.entry.balanceAfter });
      return { id, corrected: true, alreadyCorrected: false, amountPaise: deposit.amount.toString() };
    });
    for (const change of changes) publishWalletBalance(change);
    return result;
  } catch (e) {
    if ((e as Error).message === "INSUFFICIENT_FUNDS") throw badRequest("Agent balance is insufficient for correction; no balances were changed");
    throw e;
  }
}
