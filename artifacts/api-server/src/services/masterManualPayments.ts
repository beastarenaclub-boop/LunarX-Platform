import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  auditLogTable,
  masterPaymentAccountsTable,
  networkNodesTable,
  paymentRequestsTable,
  usersTable,
  type User,
} from "@workspace/db";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { networkIdentity, assertNetworkActive, isNetworkAdmin } from "./network";
import { postEntry, publishWalletBalance } from "./wallet";
import { type CreatePaymentInput } from "./payments";

export async function collectionMaster(user: User) {
  if (user.channel !== "b2b") return null;
  if (user.role !== "player" || !user.b2bAgentId)
    throw forbidden("Player account required");
  await assertNetworkActive(user);
  const [agent] = await db
    .select()
    .from(networkNodesTable)
    .where(eq(networkNodesTable.id, user.b2bAgentId));
  if (!agent || agent.kind !== "agent" || !agent.parentId)
    throw forbidden("Payment account unavailable");
  return agent.parentId;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function authorizeCollection(user: User, masterId: string, tx?: Transaction) {
  // Writers validate the active network identity before opening their transaction.
  // Recheck ownership and permission using that same transaction connection.
  if (!tx) await networkIdentity(user);
  const query = (tx ?? db)
    .select()
    .from(networkNodesTable)
    .where(
      and(
        eq(networkNodesTable.id, masterId),
        eq(networkNodesTable.kind, "master"),
      ),
    );
  const [master] = await (tx ? query.for("share") : query);
  if (!master) throw notFound("Master not found");
  if (!isNetworkAdmin(user) && !master.manualPaymentsEnabled)
    throw forbidden("Manual payment access has not been assigned by admin");
  let reviewAgentId: string | null = null;
  if (!isNetworkAdmin(user) && master.userId !== user.id) {
    const agentQuery = (tx ?? db).select().from(networkNodesTable).where(and(
      eq(networkNodesTable.userId, user.id), eq(networkNodesTable.kind, "agent"), eq(networkNodesTable.parentId, masterId),
    ));
    const [agent] = await (tx ? agentQuery.for("share") : agentQuery);
    if (user.role !== "agent" || !agent?.manualPaymentsEnabled || agent.status !== "active")
      throw forbidden("Only the master or an assigned agent can review these payments");
    reviewAgentId = agent.id;
  }
  return { ...master, reviewAgentId };
}

export async function masterAccount(masterId: string) {
  const [account] = await db
    .select()
    .from(masterPaymentAccountsTable)
    .where(eq(masterPaymentAccountsTable.masterId, masterId));
  return account ?? null;
}

export async function playerCollectionAccounts(user: User) {
  const masterId = await collectionMaster(user);
  if (!masterId) return null;
  const [master] = await db.select().from(networkNodesTable).where(eq(networkNodesTable.id, masterId));
  if (!master?.manualPaymentsEnabled) return [];
  const account = await masterAccount(masterId);
  return account?.active
    ? [
        {
          id: masterId,
          label: account.label,
          upiId: account.upiId,
          qrUrl: account.qrData,
          accountVersion: account.version,
        },
      ]
    : [];
}

// The recipient and account version come from the authenticated membership.
// Lock the account while taking the snapshot so a simultaneous QR edit cannot
// silently route a payment to a different recipient.
export async function createMasterDeposit(
  user: User,
  input: CreatePaymentInput,
  accountId?: string,
  accountVersion?: number,
) {
  const masterId = await collectionMaster(user);
  if (!masterId) throw forbidden();
  if (!/^[A-Za-z0-9]{4,64}$/.test(input.upiRef?.trim() ?? ""))
    throw badRequest("Enter the UTR using only letters and digits");
  try {
    return await db.transaction(async (tx) => {
      // Serialize collection with an admin revoking this master's permission.
      const [master] = await tx.select().from(networkNodesTable).where(eq(networkNodesTable.id, masterId)).for("share");
      if (!master?.manualPaymentsEnabled)
        throw forbidden("Manual payments are unavailable. Contact support.");
      const [customer] = await tx.select().from(usersTable).where(eq(usersTable.id, user.id)).for("share");
      const [agent] = customer?.b2bAgentId ? await tx.select().from(networkNodesTable).where(eq(networkNodesTable.id, customer.b2bAgentId)).for("share") : [];
      if (!agent || agent.kind !== "agent" || agent.parentId !== masterId || agent.status !== "active" || customer?.status !== "active")
        throw conflict("Customer branch changed. Refresh payment details.");
      const [account] = await tx
        .select()
        .from(masterPaymentAccountsTable)
        .where(eq(masterPaymentAccountsTable.masterId, masterId))
        .for("share");
      if (!account?.active)
        throw badRequest("Manual payments are unavailable. Contact support.");
      if (accountId !== masterId || accountVersion !== account.version)
        throw conflict(
          "Payment details changed. Refresh the QR before submitting; contact support if already paid.",
        );
      const [deposit] = await tx
        .insert(paymentRequestsTable)
        .values({
          ...input,
          userId: user.id,
          kind: "deposit",
          method: "manual",
          status: "pending",
          upiRef: input.upiRef!.trim().toUpperCase(),
          upiId: account.upiId,
          collectionMasterId: masterId,
          fundingAgentId: agent.id,
          collectionAccountVersion: account.version,
        })
        .returning();
      return deposit!;
    });
  } catch (e) {
    const error = e as { code?: string; cause?: { code?: string } };
    if (error.code === "23505" || error.cause?.code === "23505")
      throw conflict(
        "This UTR has already been submitted. Check your deposit history.",
      );
    throw e;
  }
}

export async function listMasterDeposits(
  masterId: string,
  limit: number,
  offset: number,
  status?: "pending" | "approved" | "rejected",
  agentId?: string | null,
) {
  return db
    .select({ deposit: paymentRequestsTable, customer: usersTable.email })
    .from(paymentRequestsTable)
    .innerJoin(usersTable, eq(usersTable.id, paymentRequestsTable.userId))
    .where(
      and(
        eq(paymentRequestsTable.collectionMasterId, masterId),
        eq(paymentRequestsTable.kind, "deposit"),
        eq(paymentRequestsTable.method, "manual"),
        status ? eq(paymentRequestsTable.status, status) : undefined,
        agentId ? sql`COALESCE(${paymentRequestsTable.fundingAgentId}, ${usersTable.b2bAgentId}) = ${agentId}` : undefined,
      ),
    )
    .orderBy(
      desc(paymentRequestsTable.createdAt),
      desc(paymentRequestsTable.id),
    )
    .limit(limit)
    .offset(offset);
}

export async function decideMasterDeposit(
  user: User,
  masterId: string,
  id: string,
  decision: "approve" | "reject",
  reason?: string,
) {
  await authorizeCollection(user, masterId);
  if (decision === "reject" && !reason?.trim())
    throw badRequest("Enter a rejection reason");
  const updates: Parameters<typeof publishWalletBalance>[0][] = [];
  try {
    const result = await db.transaction(async (tx) => {
      const access = await authorizeCollection(user, masterId, tx);
      const [deposit] = await tx
        .select()
        .from(paymentRequestsTable)
        .where(
          and(
            eq(paymentRequestsTable.id, id),
            eq(paymentRequestsTable.collectionMasterId, masterId),
            eq(paymentRequestsTable.kind, "deposit"),
            eq(paymentRequestsTable.method, "manual"),
            access.reviewAgentId ? sql`COALESCE(${paymentRequestsTable.fundingAgentId}, (SELECT b2b_agent_id FROM users WHERE id=${paymentRequestsTable.userId})) = ${access.reviewAgentId}` : undefined,
          ),
        )
        .for("update");
      if (!deposit) throw notFound("Deposit not found");
      if (deposit.status !== "pending")
        throw conflict("This deposit has already been reviewed");
      let ledgerEntryId: string | null = null;
      let fundingAgentId = deposit.fundingAgentId;
      if (decision === "approve") {
        const [master] = await tx
          .select()
          .from(networkNodesTable)
          .where(eq(networkNodesTable.id, masterId))
          .for("share");
        const [customer] = await tx
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, deposit.userId))
          .for("share");
        if (
          !master ||
          master.status !== "active" ||
          !customer ||
          customer.status !== "active" ||
          customer.channel !== "b2b"
        )
          throw badRequest("Payment account is unavailable");
        const [agent] = customer.b2bAgentId
          ? await tx
              .select()
              .from(networkNodesTable)
              .where(eq(networkNodesTable.id, customer.b2bAgentId))
              .for("share")
          : [];
        if (!agent || agent.parentId !== masterId || agent.status !== "active" || (deposit.fundingAgentId && deposit.fundingAgentId !== agent.id))
          throw badRequest(
            "Customer branch has changed. Contact the administrator.",
          );
        await assertNetworkActive(customer);
        fundingAgentId = agent.id;
        for (const uid of [agent.userId, customer.id].sort()) {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`network-funds:${uid}`},0))`,
          );
        }
        const debit = await postEntry(
          {
            userId: agent.userId,
            type: "adjustment",
            amount: -deposit.amount,
            refType: "agent_deposit_funding",
            refId: id,
            memo: `Manual deposit ${id}`,
            createdBy: user.id,
          },
          tx,
        );
        const credit = await postEntry(
          {
            userId: customer.id,
            type: "deposit",
            amount: deposit.amount,
            refType: "deposit",
            refId: id,
            memo: `Deposit ${id} approved`,
            createdBy: user.id,
          },
          tx,
        );
        ledgerEntryId = credit.entry.id;
        updates.push(
          {
            userId: agent.userId,
            entryType: "adjustment",
            amount: -deposit.amount,
            balance: debit.entry.balanceAfter,
          },
          {
            userId: customer.id,
            entryType: "deposit",
            amount: deposit.amount,
            balance: credit.entry.balanceAfter,
          },
        );
      }
      const status = decision === "approve" ? "approved" : "rejected";
      const [updated] = await tx
        .update(paymentRequestsTable)
        .set({
          status,
          processedBy: user.id,
          processedAt: new Date(),
          rejectionReason: decision === "reject" ? reason!.trim() : null,
          ledgerEntryId,
          fundingAgentId,
        })
        .where(eq(paymentRequestsTable.id, id))
        .returning();
      await tx
        .insert(auditLogTable)
        .values({
          actorId: user.id,
          actorRole: user.role,
          action: `network.deposit.${decision}`,
          targetType: "deposit",
          targetId: id,
          before: { status: deposit.status },
          after: {
            status,
            masterId,
            fundingAgentId,
            amount: deposit.amount.toString(),
            reason: reason ?? null,
          },
        });
      return updated!;
    });
    for (const update of updates) publishWalletBalance(update);
    return result;
  } catch (e) {
    if ((e as Error).message === "INSUFFICIENT_FUNDS")
      throw badRequest(
        "Insufficient customer agent wallet balance. Add funds to the agent before approving.",
      );
    throw e;
  }
}
