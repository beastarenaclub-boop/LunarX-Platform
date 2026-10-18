import { demoPresence } from "../demo/bridge";
import {parseTransactionQuery,transactionConditions} from '../services/transactionFilters';
import { isRetiredGame } from "../lib/retiredGames";
import express, { Router, type IRouter } from "express";
import {
  db,
  kycSubmissionsTable,
  usersTable,
  walletsTable,
  walletLedgerTable,
  betsTable,
  withdrawalsTable,
  fraudFlagsTable,
  walletStatusTable,
  auditLogTable,
  appLogsTable,
  paymentRequestsTable,
  depositSettingsTable,
  agentsTable,
  commissionsTable,
  reconciliationEntriesTable,
  upiAccountsTable,
  roundSettlementsTable,
  roundSettlementEntriesTable,
} from "@workspace/db";
import { settlementTotals } from "../services/roundSettlement";
import {
  and,
  desc,
  eq,
  gte,
  lte,
  ilike,
  not,
  or,
  sql,
  count,
  inArray,
  ne,
} from "drizzle-orm";
import {
  AdminReviewKycBody,
  AdminAdjustWalletBody,
  AdminSetUserStatusBody,
  AdminFreezeWalletBody,
  AdminDecideWithdrawalBody,
  AdminIssueBonusBody,
  AdminCleanupDemoAccountsBody,
} from "@workspace/api-zod";
import { cleanupIdleDemoAccounts } from "../services/demo-cleanup";
import { requireRole } from "../middlewares/auth";
import { requireStepUp } from "../middlewares/stepUp";
import {
  kycSubmission,
  ledgerEntry,
  publicUser,
  paymentRequest as serializePaymentRequest,
  upiAccount as serializeUpiAccount,
  DEMO_EMAIL_DOMAIN,
  DEMO_EMAIL_PREFIX,
} from "../lib/serialize";
import { storeUpiQrObject, deleteUpiQrObject } from "../services/upiQrStorage";
import { HttpError } from "../lib/errors";
import { recordAuditFromReq } from "../lib/audit";
import { notFound, badRequest } from "../lib/errors";
import {
  postEntry,
  ensureWallet,
  getBalance,
  getAllScopeBalances,
  listEntries,
  publishWalletBalance,
  toWalletScope,
} from "../services/wallet";
import { detectMultiAccounts } from "../services/fraud";
import { writeAppLog } from "../services/appLog";
import { createNotification, createBulkNotifications } from "../services/notifications";
import { getDepositSettings } from "../services/payments";
import { nanoid } from "nanoid";
import { hashPassword } from "../lib/password";
import { computeCommissions } from "../services/commission";
import { bus } from "../realtime/eventBus";
import { getPaymentProvider, isGatewayEnabled } from "../services/payment-gateway";
import {
  applyDepositBonus,
  getPromotionAnalytics,
  listBonusEvents,
} from "../services/promotions";
import {
  getPromotionSettings,
  updatePromotionSettings,
  revokeBonus,
} from "../services/bonusWallet";
import { runReconciliation, listReconciliationEntries } from "../services/reconciliation";
import { z } from "zod";

const router: IRouter = Router();
router.get("/demo-presence", requireRole("admin", "super_admin"), demoPresence);

/**
 * Single helper used by every exit branch of the withdrawal-decision
 * handler so admin live queue/counters update consistently regardless of
 * gateway success, requeue, manual approve/reject, or gateway error.
 */
function publishWithdrawalDecided(
  id: string,
  userId: string,
  amount: bigint,
  status: string,
): void {
  try {
    bus.publish({
      topic: "withdrawals:admin",
      type: "decided",
      id,
      userId,
      amount: amount.toString(),
      status,
      ts: Date.now(),
    });
    bus.publish({
      topic: "admin:metrics",
      type: "bump",
      reason: "withdrawal_decided",
      ts: Date.now(),
    });
  } catch {
    // best-effort
  }
}

const adminOnly = requireRole("admin", "super_admin", "support");
const adminWrite = requireRole("admin", "super_admin");

// ---- KYC --------------------------------------------------------------------

const KYC_STATUSES = ["pending", "approved", "rejected"] as const;
type KycStatusQ = (typeof KYC_STATUSES)[number];

router.get("/kyc", adminOnly, async (req, res, next) => {
  try {
    const raw = req.query.status;
    let status: KycStatusQ | undefined;
    if (typeof raw === "string" && raw.length > 0) {
      if (!(KYC_STATUSES as readonly string[]).includes(raw)) {
        throw badRequest("Invalid status filter");
      }
      status = raw as KycStatusQ;
    }
    const rows = status
      ? await db
          .select()
          .from(kycSubmissionsTable)
          .where(eq(kycSubmissionsTable.status, status))
          .orderBy(desc(kycSubmissionsTable.submittedAt))
      : await db
          .select()
          .from(kycSubmissionsTable)
          .orderBy(desc(kycSubmissionsTable.submittedAt));
    res.json(rows.map(kycSubmission));
  } catch (err) {
    next(err);
  }
});

router.post("/kyc/:id/review", adminWrite, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = AdminReviewKycBody.parse(req.body);
    const rows = await db
      .select()
      .from(kycSubmissionsTable)
      .where(eq(kycSubmissionsTable.id, id))
      .limit(1);
    const existing = rows[0];
    if (!existing) throw notFound("KYC submission not found");
    if (existing.status !== "pending") {
      throw badRequest("Submission is already reviewed");
    }
    const newStatus = input.decision === "approve" ? "approved" : "rejected";
    const [updated] = await db
      .update(kycSubmissionsTable)
      .set({
        status: newStatus,
        rejectionReason:
          input.decision === "reject" ? (input.reason ?? null) : null,
        reviewedBy: req.user!.id,
        reviewedAt: new Date(),
      })
      .where(eq(kycSubmissionsTable.id, id))
      .returning();
    await recordAuditFromReq(req, {
      action: `kyc.${input.decision}`,
      targetType: "kyc_submission",
      targetId: id,
      before: { status: existing.status },
      after: { status: newStatus, reason: input.reason ?? null },
    });
    await createNotification({
      userId: existing.userId,
      type: newStatus === "approved" ? "kyc_approved" : "kyc_rejected",
      title: newStatus === "approved" ? "KYC Approved" : "KYC Rejected",
      message:
        newStatus === "approved"
          ? "Your identity verification has been approved."
          : `Your identity verification was rejected.${input.reason ? ` Reason: ${input.reason}` : ""}`,
      linkUrl: "/profile",
    });
    res.json(kycSubmission(updated!));
  } catch (err) {
    next(err);
  }
});

// ---- Wallet adjust ----------------------------------------------------------

router.post("/wallet/adjust", adminWrite, requireStepUp, async (req, res, next) => {
  try {
    const input = AdminAdjustWalletBody.parse(req.body);
    if (!/^-?\d{1,18}$/.test(input.amount)) {
      throw badRequest("amount must be a signed integer string");
    }
    let amount: bigint;
    try {
      amount = BigInt(input.amount);
    } catch {
      throw badRequest("Invalid amount");
    }
    if (amount === 0n) throw badRequest("Amount must be non-zero");

    const scope = toWalletScope(input.game);

    const targetUserRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, input.userId))
      .limit(1);
    if (!targetUserRows[0]) throw notFound("Target user not found");

    const wallet = await ensureWallet(input.userId, scope);
    const beforeBalance = await getBalance(wallet.id);

    const { entry } = await postEntry({
      userId: input.userId,
      scope,
      type: input.type ?? "adjustment",
      amount,
      memo: input.memo,
      createdBy: req.user!.id,
      refType: "admin_adjustment",
    });
    await recordAuditFromReq(req, {
      action: "wallet.adjust",
      targetType: "user",
      targetId: input.userId,
      before: { walletId: wallet.id, balance: beforeBalance.toString() },
      after: {
        walletId: wallet.id,
        balance: entry.balanceAfter.toString(),
        amount: amount.toString(),
        type: input.type ?? "adjustment",
        memo: input.memo,
        ledgerEntryId: entry.id,
      },
    });
    await writeAppLog({
      kind: "admin",
      message: `Wallet adjusted for ${input.userId}: ${amount.toString()} paise`,
      actorId: req.user!.id,
    });
    res.json(ledgerEntry(entry));
  } catch (err) {
    next(err);
  }
});

// ---- Helpers ----------------------------------------------------------------

function serializeBet(b: typeof betsTable.$inferSelect) {
  return {
    id: b.id,
    userId: b.userId,
    gameCode: b.gameCode,
    roundId: b.roundId,
    stakeAmount: b.stakeAmount.toString(),
    payoutAmount: b.payoutAmount.toString(),
    multiplier: b.multiplier,
    status: b.status,
    placedAt: b.placedAt.toISOString(),
    settledAt: b.settledAt ? b.settledAt.toISOString() : null,
  };
}

function serializeWithdrawal(w: typeof withdrawalsTable.$inferSelect) {
  return {
    id: w.id,
    userId: w.userId,
    amount: w.amount.toString(),
    currency: w.currency,
    method: w.method,
    destination: w.destination,
    kind: w.kind,
    status: w.status,
    rejectionReason: w.rejectionReason,
    gatewayPayoutId: w.gatewayPayoutId ?? null,
    gatewayStatus: w.gatewayStatus ?? null,
    utr: w.utr ?? null,
    manualSettlement: w.manualSettlement,
    reviewedBy: w.reviewedBy,
    reviewedAt: w.reviewedAt ? w.reviewedAt.toISOString() : null,
    paidAt: w.paidAt ? w.paidAt.toISOString() : null,
    requestedAt: w.requestedAt.toISOString(),
  };
}

function serializeReconEntry(r: typeof reconciliationEntriesTable.$inferSelect) {
  return {
    id: r.id,
    runDate: r.runDate.toISOString(),
    gatewayOrderId: r.gatewayOrderId,
    ledgerEntryId: r.ledgerEntryId,
    paymentRequestId: r.paymentRequestId,
    withdrawalId: r.withdrawalId,
    direction: r.direction,
    gatewayAmount: r.gatewayAmount?.toString() ?? null,
    ledgerAmount: r.ledgerAmount?.toString() ?? null,
    status: r.status,
    details: r.details,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    resolvedBy: r.resolvedBy,
    createdAt: r.createdAt.toISOString(),
  };
}

function serializeAudit(a: typeof auditLogTable.$inferSelect) {
  return {
    id: a.id,
    actorId: a.actorId,
    actorRole: a.actorRole,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    before: a.before,
    after: a.after,
    ip: a.ip,
    userAgent: a.userAgent,
    createdAt: a.createdAt.toISOString(),
  };
}

function serializeFlag(f: typeof fraudFlagsTable.$inferSelect) {
  return {
    id: f.id,
    userId: f.userId,
    rule: f.rule,
    severity: f.severity,
    description: f.description,
    metadata: f.metadata,
    resolved: f.resolved,
    resolvedBy: f.resolvedBy,
    resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
    createdAt: f.createdAt.toISOString(),
  };
}

function serializeWalletStatus(s: typeof walletStatusTable.$inferSelect) {
  return {
    userId: s.userId,
    status: s.status,
    reason: s.reason,
    updatedBy: s.updatedBy,
    updatedAt: s.updatedAt.toISOString(),
  };
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = parseInt(String(v ?? def), 10);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

// ---- Users ------------------------------------------------------------------

router.get("/users", adminOnly, async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const role = typeof req.query.role === "string" ? req.query.role : "";
    const status =
      typeof req.query.status === "string" ? req.query.status : "";
    const includeDemo = req.query.includeDemo === "true";

    const conds = [] as ReturnType<typeof eq>[];
    if (!includeDemo) {
      conds.push(
        not(
          and(
            eq(usersTable.role, "player"),
            ilike(
              usersTable.emailNormalized,
              `${DEMO_EMAIL_PREFIX}%${DEMO_EMAIL_DOMAIN}`,
            ),
          )!,
        )!,
      );
    }
    if (q) {
      const like = `%${q.toLowerCase()}%`;
      conds.push(
        or(
          ilike(usersTable.emailNormalized, like),
          ilike(usersTable.displayName, like),
          eq(usersTable.id, q),
        )!,
      );
    }
    if (role) {
      conds.push(eq(usersTable.role, role as never));
    }
    if (status) {
      conds.push(eq(usersTable.status, status as never));
    }

    const where = conds.length ? and(...conds) : undefined;

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(usersTable)
        .where(where)
        .orderBy(desc(usersTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ c: count() })
        .from(usersTable)
        .where(where),
    ]);
    res.json({
      users: rows.map(publicUser),
      total: Number(totalRow[0]?.c ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/users/:userId", adminOnly, async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const userRows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const user = userRows[0];
    if (!user) throw notFound("User not found");

    const [kycRows, statusRows, walletRows, recentBets, flagRows] =
      await Promise.all([
        db
          .select()
          .from(kycSubmissionsTable)
          .where(eq(kycSubmissionsTable.userId, userId))
          .orderBy(desc(kycSubmissionsTable.submittedAt))
          .limit(1),
        db
          .select()
          .from(walletStatusTable)
          .where(eq(walletStatusTable.userId, userId))
          .limit(1),
        db
          .select()
          .from(walletsTable)
          .where(and(eq(walletsTable.userId, userId), eq(walletsTable.scope, "lunar")))
          .limit(1),
        db
          .select()
          .from(betsTable)
          .where(eq(betsTable.userId, userId))
          .orderBy(desc(betsTable.placedAt))
          .limit(20),
        db
          .select()
          .from(fraudFlagsTable)
          .where(eq(fraudFlagsTable.userId, userId))
          .orderBy(desc(fraudFlagsTable.createdAt))
          .limit(20),
      ]);

    let walletInfo: {
      walletId: string;
      currency: string;
      scope: string;
      balance: string;
    } | null = null;
    let recentLedger: ReturnType<typeof ledgerEntry>[] = [];
    if (walletRows[0]) {
      const w = walletRows[0];
      const balance = await getBalance(w.id);
      walletInfo = {
        walletId: w.id,
        currency: w.currency,
        scope: toWalletScope(w.scope),
        balance: balance.toString(),
      };
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.walletId, w.id))
        .orderBy(desc(walletLedgerTable.createdAt))
        .limit(20);
      recentLedger = ledger.map(ledgerEntry);
    }

    const balances = await getAllScopeBalances(userId);

    res.json({
      user: publicUser(user),
      kyc: kycRows[0] ? kycSubmission(kycRows[0]) : null,
      walletStatus: statusRows[0] ? serializeWalletStatus(statusRows[0]) : null,
      wallet: walletInfo,
      balances: { currency: "INR", balances },
      recentBets: recentBets.map(serializeBet),
      recentLedger,
      flags: flagRows.map(serializeFlag),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/users/:userId/status", adminWrite, async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const input = AdminSetUserStatusBody.parse(req.body);
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!existing[0]) throw notFound("User not found");
    if (existing[0].id === req.user!.id) {
      throw badRequest("Cannot change your own status");
    }
    const [updated] = await db
      .update(usersTable)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning();
    await recordAuditFromReq(req, {
      action: `user.${input.status}`,
      targetType: "user",
      targetId: userId,
      before: { status: existing[0].status },
      after: { status: input.status, reason: input.reason ?? null },
    });
    res.json(publicUser(updated!));
  } catch (err) {
    next(err);
  }
});

router.get("/users/:userId/wallet", adminOnly, async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const userRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!userRows[0]) throw notFound("User not found");
    const scope = toWalletScope(
      typeof req.query.game === "string" ? req.query.game : undefined,
    );
    const wallet = await ensureWallet(userId, scope);
    const balance = await getBalance(wallet.id);
    const { entries, nextCursor } = await listEntries({
      walletId: wallet.id,
      limit: 50,
    });
    const balances = await getAllScopeBalances(userId);
    const statusRows = await db
      .select()
      .from(walletStatusTable)
      .where(eq(walletStatusTable.userId, userId))
      .limit(1);
    res.json({
      wallet: {
        walletId: wallet.id,
        currency: wallet.currency,
        scope: toWalletScope(wallet.scope),
        balance: balance.toString(),
      },
      balance: balance.toString(),
      balances: { currency: "INR", balances },
      status: statusRows[0] ? serializeWalletStatus(statusRows[0]) : null,
      transactions: {
        entries: entries.map(ledgerEntry),
        nextCursor,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/users/:userId/audit", adminOnly, async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const rows = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.targetType, "user"),
          eq(auditLogTable.targetId, userId),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt))
      .limit(100);
    res.json(rows.map(serializeAudit));
  } catch (err) {
    next(err);
  }
});

router.post("/users/:userId/wallet/freeze", adminWrite, requireStepUp, async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const input = AdminFreezeWalletBody.parse(req.body);
    const userRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!userRows[0]) throw notFound("User not found");

    const existing = await db
      .select()
      .from(walletStatusTable)
      .where(eq(walletStatusTable.userId, userId))
      .limit(1);

    const [row] = await db
      .insert(walletStatusTable)
      .values({
        userId,
        status: input.status,
        reason: input.reason ?? null,
        updatedBy: req.user!.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: walletStatusTable.userId,
        set: {
          status: input.status,
          reason: input.reason ?? null,
          updatedBy: req.user!.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    await recordAuditFromReq(req, {
      action: `wallet.${input.status === "frozen" ? "freeze" : "unfreeze"}`,
      targetType: "user",
      targetId: userId,
      before: existing[0]
        ? { status: existing[0].status, reason: existing[0].reason }
        : null,
      after: { status: input.status, reason: input.reason ?? null },
    });
    res.json(serializeWalletStatus(row!));
  } catch (err) {
    next(err);
  }
});

// ---- Demo accounts ---------------------------------------------------------

router.post("/demo-accounts/cleanup", adminWrite, async (req, res, next) => {
  try {
    const input = AdminCleanupDemoAccountsBody.parse(req.body);
    const result = await cleanupIdleDemoAccounts(input.thresholdHours);
    await recordAuditFromReq(req, {
      action: "demo_accounts.cleanup",
      targetType: "demo_accounts",
      targetId: null,
      after: {
        deleted: result.deleted,
        thresholdHours: input.thresholdHours,
      },
    });
    await writeAppLog({
      kind: "admin",
      message: `Demo cleanup purged ${result.deleted} account(s) (threshold ${input.thresholdHours}h)`,
      actorId: req.user!.id,
    });
    res.json({ deleted: result.deleted, thresholdHours: input.thresholdHours });
  } catch (err) {
    next(err);
  }
});

router.get("/demo-accounts/cleanup-history", adminOnly, async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 10, 1, 50);
    const rows = await db
      .select({
        id: auditLogTable.id,
        createdAt: auditLogTable.createdAt,
        actorId: auditLogTable.actorId,
        after: auditLogTable.after,
        actorEmail: usersTable.email,
      })
      .from(auditLogTable)
      .leftJoin(usersTable, eq(usersTable.id, auditLogTable.actorId))
      .where(eq(auditLogTable.action, "demo_accounts.cleanup"))
      .orderBy(desc(auditLogTable.createdAt))
      .limit(limit);
    res.json(
      rows.map((r) => {
        const after = (r.after ?? {}) as {
          deleted?: unknown;
          thresholdHours?: unknown;
        };
        const safeInt = (v: unknown): number => {
          const n = Number(v);
          return Number.isFinite(n) ? Math.trunc(n) : 0;
        };
        return {
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          actorId: r.actorId,
          actorEmail: r.actorId ? (r.actorEmail ?? null) : null,
          deleted: safeInt(after.deleted),
          thresholdHours: safeInt(after.thresholdHours),
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

// ---- Bets -------------------------------------------------------------------

router.get("/bets", adminOnly, async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    const conds = [] as ReturnType<typeof eq>[];
    if (typeof req.query.userId === "string" && req.query.userId)
      conds.push(eq(betsTable.userId, req.query.userId));
    if (typeof req.query.roundId === "string" && req.query.roundId)
      conds.push(eq(betsTable.roundId, req.query.roundId));
    if (typeof req.query.status === "string" && req.query.status)
      conds.push(eq(betsTable.status, req.query.status as never));
    if (typeof req.query.from === "string" && req.query.from) {
      const d = new Date(req.query.from);
      if (!Number.isNaN(d.getTime())) conds.push(gte(betsTable.placedAt, d));
    }
    if (typeof req.query.to === "string" && req.query.to) {
      const d = new Date(req.query.to);
      if (!Number.isNaN(d.getTime())) conds.push(lte(betsTable.placedAt, d));
    }
    const where = conds.length ? and(...conds) : undefined;
    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(betsTable)
        .where(where)
        .orderBy(desc(betsTable.placedAt))
        .limit(limit)
        .offset(offset),
      db.select({ c: count() }).from(betsTable).where(where),
    ]);
    res.json({
      bets: rows.map(serializeBet),
      total: Number(totalRow[0]?.c ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/bets/round/:roundId", adminOnly, async (req, res, next) => {
  try {
    const roundId = String(req.params.roundId);
    const rows = await db
      .select()
      .from(betsTable)
      .where(eq(betsTable.roundId, roundId))
      .orderBy(desc(betsTable.placedAt));
    let stake = 0n;
    let payout = 0n;
    for (const r of rows) {
      stake += r.stakeAmount;
      payout += r.payoutAmount;
    }
    res.json({
      roundId,
      bets: rows.map(serializeBet),
      totals: {
        count: rows.length,
        stakeAmount: stake.toString(),
        payoutAmount: payout.toString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---- Withdrawals ------------------------------------------------------------

router.get("/withdrawals", adminOnly, async (req, res, next) => {
  try {
    const filter=parseTransactionQuery(req.query);
    const {limit,offset}=filter;
    const status =
      typeof req.query.status === "string" ? req.query.status : "";
    if(status&&!['pending','approved','rejected','paid','failed'].includes(status))throw badRequest('Invalid status filter');
    const conditions=transactionConditions(filter,{time:sql`${withdrawalsTable.requestedAt}`,amount:sql`${withdrawalsTable.amount}`,text:[sql`${withdrawalsTable.id}`,sql`${withdrawalsTable.userId}`,sql`${withdrawalsTable.utr}`,sql`${withdrawalsTable.destination}`,sql`(SELECT email FROM users WHERE id=${withdrawalsTable.userId})`]});
    if(status)conditions.push(eq(withdrawalsTable.status,status as never));
    if(filter.userId)conditions.push(eq(withdrawalsTable.userId,filter.userId));
    const where=and(...conditions);
    const rows = await db
      .select()
      .from(withdrawalsTable)
      .where(where)
      .orderBy(desc(withdrawalsTable.requestedAt),desc(withdrawalsTable.id))
      .limit(limit)
      .offset(offset);
    if(req.query.paged==='1'){
      const [summary]=await db.select({total:count(),amount:sql<string>`COALESCE(sum(${withdrawalsTable.amount}),0)::text`}).from(withdrawalsTable).where(where);
      res.json({withdrawals:rows.map(serializeWithdrawal),total:Number(summary?.total??0),summary:{credit:summary?.amount??'0',debit:'0',net:summary?.amount??'0'}});
    }else res.json(rows.map(serializeWithdrawal));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/withdrawals/:id/decision",
  adminWrite,
  async (req, res, next): Promise<void> => {
    try {
      const id = String(req.params.id);
      const input = AdminDecideWithdrawalBody.parse(req.body);
      const rows = await db
        .select()
        .from(withdrawalsTable)
        .where(eq(withdrawalsTable.id, id))
        .limit(1);
      const existing = rows[0];
      if (!existing) throw notFound("Withdrawal not found");
      if (existing.status !== "pending") {
        throw badRequest("Withdrawal already decided");
      }

      const newStatus = input.decision === "approve" ? "approved" : "rejected";

      if (input.decision === "approve") {
        if (existing.kind === "agent_commission") {
          // Agent commission payouts are paid from commission liability,
          // not from the agent's player wallet — skip balance check & ledger debit.
        } else {
          // Withdrawals debit the Lunar wallet (the withdrawals table has no
          // per-game scope yet). Deposits & balances are per-game; withdrawals
          // remain unified for now.
          const wallet = await ensureWallet(
            existing.userId,
            "lunar",
            existing.currency,
          );
          const balance = await getBalance(wallet.id);
          if (balance < existing.amount) {
            throw badRequest("Insufficient wallet balance to approve");
          }
          await postEntry({
            userId: existing.userId,
            type: "withdraw",
            amount: -existing.amount,
            scope: "lunar",
            memo: `Withdrawal ${id} approved`,
            createdBy: req.user!.id,
            refType: "withdrawal",
            refId: id,
          });
        }

        if (isGatewayEnabled() && existing.kind !== "agent_commission") {
          try {
            const provider = getPaymentProvider();
            const result = await provider.createPayout({
              payoutId: id,
              amount: existing.amount,
              currency: existing.currency,
              upiId: existing.destination,
              purpose: `Withdrawal ${id}`,
            });

            if (result.status === "failed" || result.status === "reversed") {
              await postEntry({
                userId: existing.userId,
                type: "refund",
                amount: existing.amount,
                scope: "lunar",
                memo: `Withdrawal ${id} payout ${result.status} — refund & requeue`,
                refType: "withdrawal",
                refId: id,
                enforceNonNegative: false,
              });

              const [requeued] = await db
                .update(withdrawalsTable)
                .set({
                  status: "pending",
                  gatewayPayoutId: result.gatewayPayoutId,
                  gatewayStatus: result.status,
                  rejectionReason: `Gateway payout ${result.status}${result.failureReason ? `: ${result.failureReason}` : ""} — requeued for retry`,
                  reviewedBy: null,
                  reviewedAt: null,
                })
                .where(eq(withdrawalsTable.id, id))
                .returning();

              await recordAuditFromReq(req, {
                action: "withdrawal.payout_failed_requeue",
                targetType: "withdrawal",
                targetId: id,
                before: { status: existing.status },
                after: {
                  status: "pending",
                  gatewayPayoutId: result.gatewayPayoutId,
                  gatewayStatus: result.status,
                  failureReason: result.failureReason,
                  refunded: true,
                },
              });
              publishWithdrawalDecided(id, existing.userId, existing.amount, "pending");
              res.json(serializeWithdrawal(requeued!));
              return;
            }

            const payoutStatus =
              result.status === "completed" ? "paid" : "approved";

            const [updated] = await db
              .update(withdrawalsTable)
              .set({
                status: payoutStatus,
                gatewayPayoutId: result.gatewayPayoutId,
                gatewayStatus: result.status,
                utr: result.utr ?? null,
                paidAt: result.status === "completed" ? new Date() : null,
                reviewedBy: req.user!.id,
                reviewedAt: new Date(),
              })
              .where(eq(withdrawalsTable.id, id))
              .returning();

            await recordAuditFromReq(req, {
              action: "withdrawal.approve",
              targetType: "withdrawal",
              targetId: id,
              before: { status: existing.status },
              after: {
                status: payoutStatus,
                amount: existing.amount.toString(),
                gatewayPayoutId: result.gatewayPayoutId,
                gatewayStatus: result.status,
                utr: result.utr,
              },
            });
            await createNotification({
              userId: existing.userId,
              type: "withdrawal_approved",
              title:
                payoutStatus === "paid" ? "Withdrawal Paid" : "Withdrawal Approved",
              message:
                payoutStatus === "paid"
                  ? `Your withdrawal of ${existing.amount.toString()} has been paid.${result.utr ? ` UTR: ${result.utr}` : ""}`
                  : `Your withdrawal of ${existing.amount.toString()} has been approved.`,
              linkUrl: "/wallet",
            });
            publishWithdrawalDecided(id, existing.userId, existing.amount, payoutStatus);
            res.json(serializeWithdrawal(updated!));
            return;
          } catch (gatewayErr) {
            await postEntry({
              userId: existing.userId,
              type: "refund",
              amount: existing.amount,
              memo: `Withdrawal ${id} gateway error — refund & requeue`,
              refType: "withdrawal",
              refId: id,
              enforceNonNegative: false,
            });

            const [fallback] = await db
              .update(withdrawalsTable)
              .set({
                status: "pending",
                gatewayStatus: "gateway_error",
                rejectionReason: "Gateway payout request failed — requeued for retry",
                reviewedBy: null,
                reviewedAt: null,
              })
              .where(eq(withdrawalsTable.id, id))
              .returning();

            await recordAuditFromReq(req, {
              action: "withdrawal.gateway_error_requeue",
              targetType: "withdrawal",
              targetId: id,
              before: { status: existing.status },
              after: { status: "pending", gatewayStatus: "gateway_error", refunded: true },
            });
            publishWithdrawalDecided(id, existing.userId, existing.amount, "pending");
            res.json(serializeWithdrawal(fallback!));
            return;
          }
        }
      }

      const [updated] = await db
        .update(withdrawalsTable)
        .set({
          status: newStatus,
          rejectionReason:
            input.decision === "reject" ? (input.reason ?? null) : null,
          reviewedBy: req.user!.id,
          reviewedAt: new Date(),
        })
        .where(eq(withdrawalsTable.id, id))
        .returning();

      await recordAuditFromReq(req, {
        action: `withdrawal.${input.decision}`,
        targetType: "withdrawal",
        targetId: id,
        before: { status: existing.status },
        after: {
          status: newStatus,
          reason: input.reason ?? null,
          amount: existing.amount.toString(),
        },
      });
      await writeAppLog({
        kind: "payment",
        message: `Withdrawal ${id} ${input.decision}d`,
        actorId: req.user!.id,
      });
      await createNotification({
        userId: existing.userId,
        type: newStatus === "approved" ? "withdrawal_approved" : "withdrawal_rejected",
        title: newStatus === "approved" ? "Withdrawal Approved" : "Withdrawal Rejected",
        message:
          newStatus === "approved"
            ? `Your withdrawal of ${existing.amount.toString()} has been approved.`
            : `Your withdrawal was rejected.${input.reason ? ` Reason: ${input.reason}` : ""}`,
        linkUrl: "/wallet",
      });
      publishWithdrawalDecided(id, existing.userId, existing.amount, newStatus);
      res.json(serializeWithdrawal(updated!));
    } catch (err) {
      next(err);
    }
  },
);

const MarkPaidInput = z.object({
  utr: z.string().min(4).max(64),
});

router.post(
  "/withdrawals/:id/mark-paid",
  adminWrite,
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const input = MarkPaidInput.parse(req.body);
      const rows = await db
        .select()
        .from(withdrawalsTable)
        .where(eq(withdrawalsTable.id, id))
        .limit(1);
      const existing = rows[0];
      if (!existing) throw notFound("Withdrawal not found");
      if (existing.status !== "approved") {
        throw badRequest("Only approved withdrawals can be marked as paid");
      }

      const [updated] = await db
        .update(withdrawalsTable)
        .set({
          status: "paid",
          utr: input.utr,
          manualSettlement: true,
          paidAt: new Date(),
        })
        .where(eq(withdrawalsTable.id, id))
        .returning();

      await recordAuditFromReq(req, {
        action: "withdrawal.mark_paid",
        targetType: "withdrawal",
        targetId: id,
        before: { status: existing.status },
        after: {
          status: "paid",
          utr: input.utr,
          manualSettlement: true,
          amount: existing.amount.toString(),
        },
      });
      await createNotification({
        userId: existing.userId,
        type: "withdrawal_approved",
        title: "Withdrawal Paid",
        message: `Your withdrawal of ${existing.amount.toString()} has been paid. UTR: ${input.utr}`,
        linkUrl: "/wallet",
      });
      bus.publish({
        topic: "withdrawals:admin",
        type: "decided",
        id,
        userId: existing.userId,
        amount: existing.amount.toString(),
        status: "paid",
        ts: Date.now(),
      });
      res.json(serializeWithdrawal(updated!));
    } catch (err) {
      next(err);
    }
  },
);

// ---- Deposits (admin management) -------------------------------------------

router.get("/deposits", adminOnly, async (req, res, next) => {
  try {
    const filter=parseTransactionQuery(req.query);
    const {limit,offset}=filter;
    const DEPOSIT_STATUSES = ["pending", "approved", "rejected", "cancelled", "gateway_pending"] as const;
    const DEPOSIT_METHODS = ["manual", "auto"] as const;
    const conds = [eq(paymentRequestsTable.kind, "deposit")] as ReturnType<typeof eq>[];
    conds.push(...transactionConditions(filter,{time:sql`${paymentRequestsTable.createdAt}`,amount:sql`${paymentRequestsTable.amount}`,text:[sql`${paymentRequestsTable.id}`,sql`${paymentRequestsTable.userId}`,sql`${paymentRequestsTable.upiRef}`,sql`${paymentRequestsTable.notes}`,sql`(SELECT email FROM users WHERE id=${paymentRequestsTable.userId})`]}));
    if(filter.userId)conds.push(eq(paymentRequestsTable.userId,filter.userId));
    if (typeof req.query.status === "string" && req.query.status) {
      if (!(DEPOSIT_STATUSES as readonly string[]).includes(req.query.status))
        throw badRequest("Invalid status filter");
      conds.push(eq(paymentRequestsTable.status, req.query.status as (typeof DEPOSIT_STATUSES)[number]));
    }
    if (typeof req.query.method === "string" && req.query.method) {
      if (!(DEPOSIT_METHODS as readonly string[]).includes(req.query.method))
        throw badRequest("Invalid method filter");
      conds.push(eq(paymentRequestsTable.method, req.query.method as (typeof DEPOSIT_METHODS)[number]));
    }
    const where = and(...conds);
    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(paymentRequestsTable)
        .where(where)
        .orderBy(desc(paymentRequestsTable.createdAt),desc(paymentRequestsTable.id))
        .limit(limit)
        .offset(offset),
      db.select({ c: count(),amount:sql<string>`COALESCE(sum(${paymentRequestsTable.amount}),0)::text` }).from(paymentRequestsTable).where(where),
    ]);
    res.json({
      deposits: rows.map(serializePaymentRequest),
      total: Number(totalRow[0]?.c ?? 0),
      summary:{credit:totalRow[0]?.amount??'0',debit:'0',net:totalRow[0]?.amount??'0'},
    });
  } catch (err) {
    next(err);
  }
});

const DepositDecisionInput = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(500).optional(),
});

router.post(
  "/deposits/:id/decision",
  adminWrite,
  async (req, res, next): Promise<void> => {
    try {
      const id = String(req.params.id);
      const input = DepositDecisionInput.parse(req.body);
      const decision = input.decision;
      const reason = input.reason;
      if (decision === "reject" && (!reason || reason.trim().length === 0)) {
        throw badRequest("reason is required when rejecting a deposit");
      }
      const newStatus = decision === "approve" ? "approved" : "rejected";

      const { existing, updated, depositCredit } = await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(paymentRequestsTable)
          .where(
            and(
              eq(paymentRequestsTable.id, id),
              eq(paymentRequestsTable.kind, "deposit"),
            ),
          )
          .for("update")
          .limit(1);
        const dep = rows[0];
        if (!dep) throw notFound("Deposit not found");
        if (dep.status !== "pending") {
          throw badRequest("Deposit already decided");
        }

        let ledgerEntryId: string | null = null;
        let depositCredit:
          | { userId: string; scope: string; balance: bigint; amount: bigint }
          | null = null;

        if (decision === "approve") {
          // Credit the deposit's per-game wallet (scope from dep.game).
          // postEntry handles wallet lookup/create + ledger insert atomically.
          const { entry } = await postEntry(
            {
              userId: dep.userId,
              type: "deposit",
              amount: dep.amount,
              scope: toWalletScope(dep.game),
              refType: "deposit",
              refId: id,
              memo: `Deposit ${id} approved`,
              createdBy: req.user!.id,
              enforceNonNegative: false,
            },
            tx,
          );
          ledgerEntryId = entry.id;
          depositCredit = {
            userId: dep.userId,
            scope: toWalletScope(dep.game),
            balance: entry.balanceAfter,
            amount: dep.amount,
          };
        }

        const [upd] = await tx
          .update(paymentRequestsTable)
          .set({
            status: newStatus,
            rejectionReason: decision === "reject" ? (reason ?? null) : null,
            processedBy: req.user!.id,
            processedAt: new Date(),
            ...(ledgerEntryId ? { ledgerEntryId } : {}),
          })
          .where(eq(paymentRequestsTable.id, id))
          .returning();

        return { existing: dep, updated: upd!, depositCredit };
      });

      // Post-commit: push the new balance to the depositor's open WS sessions
      // so their wallet UI updates immediately. Safe to call after the tx
      // resolves because the deposit ledger row is now durable.
      if (depositCredit) {
        publishWalletBalance({
          userId: depositCredit.userId,
          scope: toWalletScope(depositCredit.scope),
          balance: depositCredit.balance,
          entryType: "deposit",
          amount: depositCredit.amount,
        });
      }

      await recordAuditFromReq(req, {
        action: `deposit.${decision}`,
        targetType: "deposit",
        targetId: id,
        before: { status: existing.status },
        after: {
          status: newStatus,
          reason: reason ?? null,
          amount: existing.amount.toString(),
        },
      });
      await writeAppLog({
        kind: "payment",
        message: `Deposit ${id} ${decision}d`,
        actorId: req.user!.id,
      });
      await createNotification({
        userId: existing.userId,
        type: newStatus === "approved" ? "deposit_approved" : "deposit_rejected",
        title: newStatus === "approved" ? "Deposit Approved" : "Deposit Rejected",
        message:
          newStatus === "approved"
            ? `Your deposit of ${existing.amount.toString()} has been approved and credited.`
            : `Your deposit was rejected.${reason ? ` Reason: ${reason}` : ""}`,
        linkUrl: "/wallet",
      });
      // Deposit-tier bonus + referral reward (idempotent on paymentRequestId).
      if (newStatus === "approved") {
        try {
          await applyDepositBonus({
            paymentRequestId: id,
            userId: existing.userId,
            amountPaise: existing.amount,
          });
        } catch (err) {
          // Never fail the deposit on bonus failure
          console.error("applyDepositBonus failed", err);
        }
      }
      res.json(serializePaymentRequest(updated));
    } catch (err) {
      next(err);
    }
  },
);

router.get("/deposit-settings", adminOnly, async (_req, res, next) => {
  try {
    const settings = await getDepositSettings();
    res.json({
      id: settings.id,
      manualEnabled: settings.manualEnabled,
      autoEnabled: settings.autoEnabled,
      minAmountPaise: settings.minAmountPaise.toString(),
      maxAmountPaise: settings.maxAmountPaise.toString(),
      updatedBy: settings.updatedBy,
      updatedAt: settings.updatedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

const AmountPaiseStr = z.string().regex(/^\d{1,18}$/u, "must be a positive integer string");
const DepositSettingsBody = z.object({
  manualEnabled: z.boolean().optional(),
  autoEnabled: z.boolean().optional(),
  minAmountPaise: AmountPaiseStr.optional(),
  maxAmountPaise: AmountPaiseStr.optional(),
});

function serializeDepositSettings(s: typeof depositSettingsTable.$inferSelect) {
  return {
    id: s.id,
    manualEnabled: s.manualEnabled,
    autoEnabled: s.autoEnabled,
    minAmountPaise: s.minAmountPaise.toString(),
    maxAmountPaise: s.maxAmountPaise.toString(),
    updatedBy: s.updatedBy,
    updatedAt: s.updatedAt.toISOString(),
  };
}

function serializeWithdrawSettings(
  s: typeof depositSettingsTable.$inferSelect,
) {
  return {
    minAmountPaise: s.withdrawMinAmountPaise.toString(),
    maxAmountPaise: s.withdrawMaxAmountPaise.toString(),
    dailyPerUserPaise: s.withdrawDailyPerUserPaise.toString(),
    dailyPlatformPaise: s.withdrawDailyPlatformPaise.toString(),
    updatedBy: s.updatedBy,
    updatedAt: s.updatedAt.toISOString(),
  };
}

const NonNegativeAmountPaiseStr = z
  .string()
  .regex(/^\d{1,18}$/u, "must be a non-negative integer string");

const WithdrawSettingsBody = z.object({
  minAmountPaise: AmountPaiseStr.optional(),
  maxAmountPaise: AmountPaiseStr.optional(),
  dailyPerUserPaise: NonNegativeAmountPaiseStr.optional(),
  dailyPlatformPaise: NonNegativeAmountPaiseStr.optional(),
});

router.get("/withdraw-settings", adminOnly, async (_req, res, next) => {
  try {
    const settings = await getDepositSettings();
    res.json(serializeWithdrawSettings(settings));
  } catch (err) {
    next(err);
  }
});

router.put("/withdraw-settings", adminWrite, async (req, res, next) => {
  try {
    const body = WithdrawSettingsBody.parse(req.body);
    const existing = await db.select().from(depositSettingsTable).limit(1);
    const current = existing[0];

    const nextMin = body.minAmountPaise !== undefined
      ? BigInt(body.minAmountPaise)
      : (current?.withdrawMinAmountPaise ?? 10000n);
    const nextMax = body.maxAmountPaise !== undefined
      ? BigInt(body.maxAmountPaise)
      : (current?.withdrawMaxAmountPaise ?? 10000000n);
    const nextDailyPerUser = body.dailyPerUserPaise !== undefined
      ? BigInt(body.dailyPerUserPaise)
      : (current?.withdrawDailyPerUserPaise ?? 0n);
    const nextDailyPlatform = body.dailyPlatformPaise !== undefined
      ? BigInt(body.dailyPlatformPaise)
      : (current?.withdrawDailyPlatformPaise ?? 0n);

    if (nextMin <= 0n) {
      throw badRequest("minAmountPaise must be greater than zero");
    }
    if (nextMax <= 0n) {
      throw badRequest("maxAmountPaise must be greater than zero");
    }
    if (nextMin > nextMax) {
      throw badRequest("minAmountPaise cannot exceed maxAmountPaise");
    }
    if (nextDailyPerUser < 0n) {
      throw badRequest("dailyPerUserPaise cannot be negative");
    }
    if (nextDailyPlatform < 0n) {
      throw badRequest("dailyPlatformPaise cannot be negative");
    }
    if (nextDailyPerUser > 0n && nextDailyPerUser < nextMax) {
      throw badRequest(
        "dailyPerUserPaise cannot be less than maxAmountPaise (single request would exceed cap)",
      );
    }
    if (
      nextDailyPlatform > 0n &&
      nextDailyPerUser > 0n &&
      nextDailyPlatform < nextDailyPerUser
    ) {
      throw badRequest(
        "dailyPlatformPaise cannot be less than dailyPerUserPaise",
      );
    }

    let row;
    if (current) {
      [row] = await db
        .update(depositSettingsTable)
        .set({
          withdrawMinAmountPaise: nextMin,
          withdrawMaxAmountPaise: nextMax,
          withdrawDailyPerUserPaise: nextDailyPerUser,
          withdrawDailyPlatformPaise: nextDailyPlatform,
          updatedBy: req.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(depositSettingsTable.id, current.id))
        .returning();
    } else {
      [row] = await db
        .insert(depositSettingsTable)
        .values({
          withdrawMinAmountPaise: nextMin,
          withdrawMaxAmountPaise: nextMax,
          withdrawDailyPerUserPaise: nextDailyPerUser,
          withdrawDailyPlatformPaise: nextDailyPlatform,
          updatedBy: req.user!.id,
        })
        .returning();
    }

    await recordAuditFromReq(req, {
      action: "withdraw_settings.update",
      targetType: "deposit_settings",
      targetId: row!.id,
      before: current
        ? {
            withdrawMinAmountPaise: current.withdrawMinAmountPaise.toString(),
            withdrawMaxAmountPaise: current.withdrawMaxAmountPaise.toString(),
            withdrawDailyPerUserPaise:
              current.withdrawDailyPerUserPaise.toString(),
            withdrawDailyPlatformPaise:
              current.withdrawDailyPlatformPaise.toString(),
          }
        : null,
      after: {
        withdrawMinAmountPaise: row!.withdrawMinAmountPaise.toString(),
        withdrawMaxAmountPaise: row!.withdrawMaxAmountPaise.toString(),
        withdrawDailyPerUserPaise:
          row!.withdrawDailyPerUserPaise.toString(),
        withdrawDailyPlatformPaise:
          row!.withdrawDailyPlatformPaise.toString(),
      },
    });
    res.json(serializeWithdrawSettings(row!));
  } catch (err) {
    next(err);
  }
});

router.put("/deposit-settings", adminWrite, async (req, res, next) => {
  try {
    const body = DepositSettingsBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
    // Lock the singleton row so concurrent admin updates serialize and both
    // flags are evaluated against the same latest state. Without this, two
    // requests each disabling a different method can both pass validation.
    const existing = await tx
      .select()
      .from(depositSettingsTable)
      .for("update")
      .limit(1);
    const current = existing[0];

    const nextMin = body.minAmountPaise !== undefined
      ? BigInt(body.minAmountPaise)
      : (current?.minAmountPaise ?? 10000n);
    const nextMax = body.maxAmountPaise !== undefined
      ? BigInt(body.maxAmountPaise)
      : (current?.maxAmountPaise ?? 10000000n);

    if (nextMin <= 0n) {
      throw badRequest("minAmountPaise must be greater than zero");
    }
    if (nextMax <= 0n) {
      throw badRequest("maxAmountPaise must be greater than zero");
    }
    if (nextMin > nextMax) {
      throw badRequest("minAmountPaise cannot exceed maxAmountPaise");
    }

    const nextManual =
      typeof body.manualEnabled === "boolean"
        ? body.manualEnabled
        : (current?.manualEnabled ?? true);
    const nextAuto =
      typeof body.autoEnabled === "boolean"
        ? body.autoEnabled
        : (current?.autoEnabled ?? false);
    if (!nextManual && !nextAuto) {
      throw badRequest("At least one deposit method must be enabled");
    }

    let row;
    if (current) {
      [row] = await tx
        .update(depositSettingsTable)
        .set({
          updatedBy: req.user!.id,
          updatedAt: new Date(),
          minAmountPaise: nextMin,
          maxAmountPaise: nextMax,
          manualEnabled: nextManual,
          autoEnabled: nextAuto,
        })
        .where(eq(depositSettingsTable.id, current.id))
        .returning();
    } else {
      [row] = await tx
        .insert(depositSettingsTable)
        .values({
          manualEnabled: nextManual,
          autoEnabled: nextAuto,
          minAmountPaise: nextMin,
          maxAmountPaise: nextMax,
          updatedBy: req.user!.id,
        })
        .returning();
    }
    return { current, row: row! };
    });

    await recordAuditFromReq(req, {
      action: "deposit_settings.update",
      targetType: "deposit_settings",
      targetId: result.row.id,
      before: result.current
        ? {
            manualEnabled: result.current.manualEnabled,
            autoEnabled: result.current.autoEnabled,
            minAmountPaise: result.current.minAmountPaise.toString(),
            maxAmountPaise: result.current.maxAmountPaise.toString(),
          }
        : null,
      after: {
        manualEnabled: result.row.manualEnabled,
        autoEnabled: result.row.autoEnabled,
        minAmountPaise: result.row.minAmountPaise.toString(),
        maxAmountPaise: result.row.maxAmountPaise.toString(),
      },
    });
    res.json(serializeDepositSettings(result.row));
  } catch (err) {
    next(err);
  }
});

// ---- Reconciliation ---------------------------------------------------------

router.get("/reconciliation", adminOnly, async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    const status =
      typeof req.query.status === "string" ? req.query.status : "";
    const rows = await listReconciliationEntries({ status, limit, offset });
    res.json(rows.map(serializeReconEntry));
  } catch (err) {
    next(err);
  }
});

router.post("/reconciliation/run", adminWrite, async (req, res, next) => {
  try {
    const dateStr =
      typeof req.body?.date === "string" ? req.body.date : null;
    const date = dateStr ? new Date(dateStr) : new Date(Date.now() - 86400_000);
    if (Number.isNaN(date.getTime())) throw badRequest("Invalid date");
    const result = await runReconciliation(date);
    await recordAuditFromReq(req, {
      action: "reconciliation.run",
      targetType: "reconciliation",
      after: { date: date.toISOString(), ...result },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/reconciliation/:id/resolve", adminWrite, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const rows = await db
      .select()
      .from(reconciliationEntriesTable)
      .where(eq(reconciliationEntriesTable.id, id))
      .limit(1);
    if (!rows[0]) throw notFound("Reconciliation entry not found");
    const [updated] = await db
      .update(reconciliationEntriesTable)
      .set({ resolvedAt: new Date(), resolvedBy: req.user!.id })
      .where(eq(reconciliationEntriesTable.id, id))
      .returning();
    await recordAuditFromReq(req, {
      action: "reconciliation.resolve",
      targetType: "reconciliation_entry",
      targetId: id,
    });
    res.json(serializeReconEntry(updated!));
  } catch (err) {
    next(err);
  }
});

// ---- Bonus ------------------------------------------------------------------

router.post("/bonus", adminWrite, requireStepUp, async (req, res, next) => {
  try {
    const input = AdminIssueBonusBody.parse(req.body);
    if (!/^\d{1,18}$/.test(input.amount)) {
      throw badRequest("amount must be a positive integer string");
    }
    const amount = BigInt(input.amount);
    if (amount <= 0n) throw badRequest("amount must be positive");

    let userIds: string[] = [];
    if (input.target.kind === "user") {
      if (!input.target.userId) throw badRequest("userId required");
      const exists = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, input.target.userId))
        .limit(1);
      if (!exists[0]) throw notFound("User not found");
      userIds = [input.target.userId];
    } else {
      const segment = input.target.segment;
      if (!segment) throw badRequest("segment required");
      const conds = [eq(usersTable.status, "active" as never)];
      if (segment === "new_last_7_days") {
        conds.push(
          gte(usersTable.createdAt, new Date(Date.now() - 7 * 86400_000)),
        );
      } else if (segment === "new_last_30_days") {
        conds.push(
          gte(usersTable.createdAt, new Date(Date.now() - 30 * 86400_000)),
        );
      }
      const rows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(...conds))
        .limit(10_000);
      userIds = rows.map((r) => r.id);
    }

    let credited = 0;
    for (const uid of userIds) {
      try {
        await postEntry({
          userId: uid,
          type: "bonus",
          amount,
          memo: input.memo,
          createdBy: req.user!.id,
          refType: "bonus_grant",
          metadata: input.wageringNote ? { note: input.wageringNote } : null,
        });
        credited += 1;
      } catch {
        // best-effort batch
      }
    }

    await recordAuditFromReq(req, {
      action: "bonus.issue",
      targetType: input.target.kind === "user" ? "user" : "segment",
      targetId:
        input.target.kind === "user"
          ? (input.target.userId ?? null)
          : (input.target.segment ?? null),
      after: {
        amount: amount.toString(),
        memo: input.memo,
        credited,
        recipients: userIds.length,
      },
    });

    await createBulkNotifications(
      userIds.slice(0, credited).map((uid) => ({
        userId: uid,
        type: "bonus_issued" as const,
        title: "Bonus Credited",
        message: `You received a bonus of ${amount.toString()}. ${input.memo}`,
        linkUrl: "/wallet",
      })),
    );
    const totalAmount = (amount * BigInt(credited)).toString();
    res.json({ credited, totalAmount });
  } catch (err) {
    next(err);
  }
});

// ---- Promotions (Refer & Earn / Bonuses) -----------------------------------

const PromotionSettingsBody = z.object({
  enabled: z.boolean().optional(),
  signupBonusPaise: z.string().regex(/^\d{1,18}$/u).optional(),
  depositTiers: z
    .array(
      z.object({
        minPaise: z.string().regex(/^\d{1,18}$/u),
        maxPaise: z.union([z.string().regex(/^\d{1,18}$/u), z.null()]),
        bonusPaise: z.string().regex(/^\d{1,18}$/u),
      }),
    )
    .optional(),
  referrerRewardPaise: z.string().regex(/^\d{1,18}$/u).optional(),
  referrerMinDepositPaise: z.string().regex(/^\d{1,18}$/u).optional(),
  wageringMultiplier: z.number().int().min(1).max(20).optional(),
});

router.get("/promotions/settings", adminOnly, async (_req, res, next) => {
  try {
    const out = await getPromotionSettings();
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.put(
  "/promotions/settings",
  adminWrite,
  requireStepUp,
  async (req, res, next) => {
    try {
      const input = PromotionSettingsBody.parse(req.body);
      const before = await getPromotionSettings();
      const updated = await updatePromotionSettings({
        ...input,
        updatedBy: req.user!.id,
      });
      await recordAuditFromReq(req, {
        action: "promotions.settings_updated",
        targetType: "promotion_settings",
        targetId: "singleton",
        before,
        after: updated,
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

router.get("/promotions/analytics", adminOnly, async (req, res, next) => {
  try {
    const windowDays = clampInt(req.query.windowDays, 30, 1, 365);
    const out = await getPromotionAnalytics(windowDays);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get("/promotions/events", adminOnly, async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 50, 1, 500);
    const offset = clampInt(req.query.offset, 0, 0, 100_000);
    const type =
      typeof req.query.type === "string" && req.query.type ? req.query.type : undefined;
    const userId =
      typeof req.query.userId === "string" && req.query.userId ? req.query.userId : undefined;
    const from =
      typeof req.query.from === "string" && req.query.from ? req.query.from : undefined;
    const to =
      typeof req.query.to === "string" && req.query.to ? req.query.to : undefined;
    const out = await listBonusEvents({ limit, offset, type, userId, from, to });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get("/promotions/events.csv", adminOnly, async (req, res, next) => {
  try {
    const out = await listBonusEvents({
      limit: 5000,
      offset: 0,
      type:
        typeof req.query.type === "string" && req.query.type ? req.query.type : undefined,
      userId:
        typeof req.query.userId === "string" && req.query.userId
          ? req.query.userId
          : undefined,
      from:
        typeof req.query.from === "string" && req.query.from ? req.query.from : undefined,
      to:
        typeof req.query.to === "string" && req.query.to ? req.query.to : undefined,
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="bonus-events-${Date.now()}.csv"`,
    );
    const lines = [
      "id,createdAt,type,userId,amountPaise,ip",
      ...out.entries.map((e) =>
        [
          e.id,
          e.createdAt,
          e.type,
          e.userId ?? "",
          e.amount,
          e.ip ?? "",
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    res.send(lines.join("\n"));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/promotions/users/:id/revoke",
  adminWrite,
  requireStepUp,
  async (req, res, next) => {
    try {
      const userId = String(req.params.id);
      const reason = String((req.body?.reason as string) ?? "Admin revocation");
      const exists = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (!exists[0]) throw notFound("User not found");
      const revoked = await revokeBonus({
        userId,
        reason,
        actorId: req.user!.id,
      });
      await recordAuditFromReq(req, {
        action: "promotions.bonus_revoked",
        targetType: "user",
        targetId: userId,
        after: { revokedPaise: revoked.toString(), reason },
      });
      res.json({ revokedPaise: revoked.toString() });
    } catch (err) {
      next(err);
    }
  },
);

// ---- Fraud ------------------------------------------------------------------

router.get("/fraud/flags", adminOnly, async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 100, 1, 200);
    const conds = [] as ReturnType<typeof eq>[];
    if (typeof req.query.resolved === "string") {
      const v = req.query.resolved === "true";
      conds.push(eq(fraudFlagsTable.resolved, v));
    }
    if (typeof req.query.severity === "string" && req.query.severity)
      conds.push(eq(fraudFlagsTable.severity, req.query.severity as never));
    if (typeof req.query.rule === "string" && req.query.rule)
      conds.push(eq(fraudFlagsTable.rule, req.query.rule));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db
      .select()
      .from(fraudFlagsTable)
      .where(where)
      .orderBy(desc(fraudFlagsTable.createdAt))
      .limit(limit);
    res.json(rows.map(serializeFlag));
  } catch (err) {
    next(err);
  }
});

router.post("/fraud/flags/:id/resolve", adminWrite, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const existing = await db
      .select()
      .from(fraudFlagsTable)
      .where(eq(fraudFlagsTable.id, id))
      .limit(1);
    if (!existing[0]) throw notFound("Flag not found");
    const [updated] = await db
      .update(fraudFlagsTable)
      .set({
        resolved: true,
        resolvedBy: req.user!.id,
        resolvedAt: new Date(),
      })
      .where(eq(fraudFlagsTable.id, id))
      .returning();
    await recordAuditFromReq(req, {
      action: "fraud.resolve",
      targetType: "fraud_flag",
      targetId: id,
      before: { resolved: existing[0].resolved },
      after: { resolved: true },
    });
    res.json(serializeFlag(updated!));
  } catch (err) {
    next(err);
  }
});

router.post("/fraud/scan", adminWrite, async (req, res, next) => {
  try {
    const flagged = await detectMultiAccounts();
    await recordAuditFromReq(req, {
      action: "fraud.scan",
      targetType: "system",
      after: { flagged },
    });
    await writeAppLog({
      kind: "admin",
      message: `Multi-account scan completed: ${flagged} flags created`,
      actorId: req.user!.id,
    });
    res.json({ flagged });
  } catch (err) {
    next(err);
  }
});

// ---- Audit ------------------------------------------------------------------

router.get("/audit", adminOnly, async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    const conds = [] as ReturnType<typeof eq>[];
    if (typeof req.query.actorId === "string" && req.query.actorId)
      conds.push(eq(auditLogTable.actorId, req.query.actorId));
    if (typeof req.query.targetId === "string" && req.query.targetId)
      conds.push(eq(auditLogTable.targetId, req.query.targetId));
    if (typeof req.query.targetType === "string" && req.query.targetType)
      conds.push(eq(auditLogTable.targetType, req.query.targetType));
    if (typeof req.query.action === "string" && req.query.action)
      conds.push(eq(auditLogTable.action, req.query.action));
    if (typeof req.query.from === "string" && req.query.from) {
      const d = new Date(req.query.from);
      if (!Number.isNaN(d.getTime())) conds.push(gte(auditLogTable.createdAt, d));
    }
    if (typeof req.query.to === "string" && req.query.to) {
      const d = new Date(req.query.to);
      if (!Number.isNaN(d.getTime())) conds.push(lte(auditLogTable.createdAt, d));
    }
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db
      .select()
      .from(auditLogTable)
      .where(where)
      .orderBy(desc(auditLogTable.createdAt))
      .limit(limit)
      .offset(offset);
    res.json(rows.map(serializeAudit));
  } catch (err) {
    next(err);
  }
});

router.get("/audit/csv", adminOnly, async (req, res, next) => {
  try {
    const conds = [] as ReturnType<typeof eq>[];
    if (typeof req.query.actorId === "string" && req.query.actorId)
      conds.push(eq(auditLogTable.actorId, req.query.actorId));
    if (typeof req.query.targetId === "string" && req.query.targetId)
      conds.push(eq(auditLogTable.targetId, req.query.targetId));
    if (typeof req.query.action === "string" && req.query.action)
      conds.push(eq(auditLogTable.action, req.query.action));
    if (typeof req.query.from === "string" && req.query.from) {
      const d = new Date(req.query.from);
      if (!Number.isNaN(d.getTime())) conds.push(gte(auditLogTable.createdAt, d));
    }
    if (typeof req.query.to === "string" && req.query.to) {
      const d = new Date(req.query.to);
      if (!Number.isNaN(d.getTime())) conds.push(lte(auditLogTable.createdAt, d));
    }
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db
      .select()
      .from(auditLogTable)
      .where(where)
      .orderBy(desc(auditLogTable.createdAt))
      .limit(10_000);

    const header = "id,createdAt,action,actorId,actorRole,targetType,targetId,ip,before,after\n";
    const csvRows = rows.map((r) => {
      const esc = (v: unknown) => {
        if (v === null || v === undefined) return "";
        const s = typeof v === "object" ? JSON.stringify(v) : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      };
      return [
        esc(r.id),
        esc(r.createdAt.toISOString()),
        esc(r.action),
        esc(r.actorId),
        esc(r.actorRole),
        esc(r.targetType),
        esc(r.targetId),
        esc(r.ip),
        esc(r.before),
        esc(r.after),
      ].join(",");
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=audit_log.csv");
    res.send(header + csvRows.join("\n"));
  } catch (err) {
    next(err);
  }
});

// ---- App Logs ---------------------------------------------------------------

router.get("/logs", adminOnly, async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    const conds = [] as ReturnType<typeof eq>[];
    if (typeof req.query.kind === "string" && req.query.kind)
      conds.push(eq(appLogsTable.kind, req.query.kind));
    if (typeof req.query.level === "string" && req.query.level)
      conds.push(eq(appLogsTable.level, req.query.level as never));
    if (typeof req.query.actorId === "string" && req.query.actorId)
      conds.push(eq(appLogsTable.actorId, req.query.actorId));
    if (typeof req.query.from === "string" && req.query.from) {
      const d = new Date(req.query.from);
      if (!Number.isNaN(d.getTime())) conds.push(gte(appLogsTable.createdAt, d));
    }
    if (typeof req.query.to === "string" && req.query.to) {
      const d = new Date(req.query.to);
      if (!Number.isNaN(d.getTime())) conds.push(lte(appLogsTable.createdAt, d));
    }
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db
      .select()
      .from(appLogsTable)
      .where(where)
      .orderBy(desc(appLogsTable.createdAt))
      .limit(limit)
      .offset(offset);
    res.json(
      rows.map((r) => ({
        id: r.id,
        level: r.level,
        kind: r.kind,
        message: r.message,
        actorId: r.actorId,
        ip: r.ip,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/logs/csv", adminOnly, async (req, res, next) => {
  try {
    const conds = [] as ReturnType<typeof eq>[];
    if (typeof req.query.kind === "string" && req.query.kind)
      conds.push(eq(appLogsTable.kind, req.query.kind));
    if (typeof req.query.level === "string" && req.query.level)
      conds.push(eq(appLogsTable.level, req.query.level as never));
    if (typeof req.query.from === "string" && req.query.from) {
      const d = new Date(req.query.from);
      if (!Number.isNaN(d.getTime())) conds.push(gte(appLogsTable.createdAt, d));
    }
    if (typeof req.query.to === "string" && req.query.to) {
      const d = new Date(req.query.to);
      if (!Number.isNaN(d.getTime())) conds.push(lte(appLogsTable.createdAt, d));
    }
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db
      .select()
      .from(appLogsTable)
      .where(where)
      .orderBy(desc(appLogsTable.createdAt))
      .limit(10_000);

    const header = "id,createdAt,level,kind,message,actorId,ip,metadata\n";
    const csvRows = rows.map((r) => {
      const esc = (v: unknown) => {
        if (v === null || v === undefined) return "";
        const s = typeof v === "object" ? JSON.stringify(v) : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      };
      return [
        esc(r.id),
        esc(r.createdAt.toISOString()),
        esc(r.level),
        esc(r.kind),
        esc(r.message),
        esc(r.actorId),
        esc(r.ip),
        esc(r.metadata),
      ].join(",");
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=app_logs.csv");
    res.send(header + csvRows.join("\n"));
  } catch (err) {
    next(err);
  }
});

// ---- Games (multi-game admin) ----------------------------------------------

const GAME_META_ADMIN: Record<string, { title: string; route: string }> = {
  lottery: { title: "Irland Lotto", route: "/lottery" },
  mines: { title: "Mines", route: "/mines" },
  plinko: { title: "Plinko", route: "/plinko" },
  dice: { title: "Dice", route: "/dice" },
  jetx: { title: "JetX", route: "/jetx" },
  fury: { title: "Fury Flight", route: "/fury" },
  "bike-racing": { title: "Bike Racing", route: "/bike-racing" },
  "horse-racing": { title: "Wild Trails", route: "/horse-riding" },
  roulette: { title: "Roulette", route: "/roulette" },
  baccarat: { title: "Baccarat VIP", route: "/baccarat" },
  blackjack: { title: "Blackjack", route: "/blackjack" },
  "teen-patti": { title: "Teen Patti 20/20", route: "/teen-patti" },
  "teen-patti-live": { title: "Teen Patti 20-20 Live", route: "/teen-patti-live" },
  "sic-bo": { title: "Sic Bo", route: "/sic-bo" },
  "andar-bahar": { title: "Andar Bahar", route: "/andar-bahar" },
  "lucky-7": { title: "Lucky 7", route: "/lucky-7" },
  "wheel-2-live": { title: "Wheel 2.0 Live", route: "/wheel-2-live" },
  "lucky-7-live": { title: "Lucky 7 Live", route: "/lucky-7-live" },
};

// List every game_config row so the admin RTP page can render a tab/list of
// all games (lunar + any future ones) instead of being hard-coded to lunar.
router.get("/games", adminOnly, async (_req, res, next) => {
  try {
    const { gameConfigTable: gc } = await import("@workspace/db");
    const rows = await db.select().from(gc).orderBy(gc.gameCode);
    res.json(
      rows.filter((r) => !isRetiredGame(r.gameCode)).map((r) => {
        const meta = GAME_META_ADMIN[r.gameCode] ?? {
          title: r.gameCode,
          route: `/${r.gameCode}`,
        };
        return {
          id: r.id,
          gameCode: r.gameCode,
          title: meta.title,
          route: meta.route,
          rtpMin: r.rtpMin,
          rtpMax: r.rtpMax,
          maxMultiplier: r.maxMultiplier,
          maxStakePaise: r.maxStakePaise.toString(),
          houseEdge: r.houseEdge,
          enabled: r.enabled,
          updatedAt: r.updatedAt.toISOString(),
          updatedBy: r.updatedBy,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

// Per-game KPIs for "today" (UTC). Cheap aggregation grouped by game_code so
// the dashboard can render a small table that updates live via the existing
// `admin:metrics` realtime topic (every bet placed/settled triggers a bump,
// dashboard re-fetches this endpoint).
router.get("/games/metrics", adminOnly, async (_req, res, next) => {
  try {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const { gameConfigTable: gc } = await import("@workspace/db");
    const [configs, perGameAgg] = await Promise.all([
      db
        .select({
          gameCode: gc.gameCode,
          enabled: gc.enabled,
          rtpMax: gc.rtpMax,
          houseEdge: gc.houseEdge,
        })
        .from(gc),
      db
        .select({
          gameCode: betsTable.gameCode,
          rounds: count(),
          stake: sql<string>`COALESCE(SUM(${betsTable.stakeAmount}), 0)::text`,
          payout: sql<string>`COALESCE(SUM(${betsTable.payoutAmount}), 0)::text`,
          players: sql<string>`COUNT(DISTINCT ${betsTable.userId})::text`,
        })
        .from(betsTable)
        .where(gte(betsTable.placedAt, startOfToday))
        .groupBy(betsTable.gameCode),
    ]);

    const aggMap = new Map(perGameAgg.map((r) => [r.gameCode, r]));
    const out = configs
      .map((c) => {
        const meta = GAME_META_ADMIN[c.gameCode] ?? {
          title: c.gameCode,
          route: `/${c.gameCode}`,
        };
        const agg = aggMap.get(c.gameCode);
        const stake = BigInt(agg?.stake ?? "0");
        const payout = BigInt(agg?.payout ?? "0");
        const ggr = stake - payout;
        // Realized RTP = payout / stake. Only meaningful when stake > 0;
        // we surface null for empty days so the UI can render "—".
        const realizedRtp =
          stake > 0n ? Number((payout * 10000n) / stake) / 100 : null;
        return {
          gameCode: c.gameCode,
          title: meta.title,
          enabled: c.enabled,
          targetRtp: c.rtpMax,
          configuredHouseEdge: c.houseEdge,
          rounds: Number(agg?.rounds ?? 0),
          players: Number(agg?.players ?? 0),
          stake: stake.toString(),
          payout: payout.toString(),
          ggr: ggr.toString(),
          realizedRtp,
        };
      })
      .sort((a, b) => a.gameCode.localeCompare(b.gameCode));
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// ---- Dashboard --------------------------------------------------------------

router.get("/dashboard", adminOnly, async (_req, res, next) => {
  try {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const [
      usersTotal,
      usersByStatus,
      kycPending,
      withdrawalsPending,
      depositsPending,
      openFlags,
      betsTodayAgg,
    ] = await Promise.all([
      db.select({ c: count() }).from(usersTable),
      db
        .select({ status: usersTable.status, c: count() })
        .from(usersTable)
        .groupBy(usersTable.status),
      db
        .select({ c: count() })
        .from(kycSubmissionsTable)
        .where(eq(kycSubmissionsTable.status, "pending")),
      db
        .select({ c: count() })
        .from(withdrawalsTable)
        .where(eq(withdrawalsTable.status, "pending")),
      db
        .select({ c: count() })
        .from(paymentRequestsTable)
        .where(
          and(
            eq(paymentRequestsTable.kind, "deposit"),
            eq(paymentRequestsTable.status, "pending"),
          ),
        ),
      db
        .select({ c: count() })
        .from(fraudFlagsTable)
        .where(eq(fraudFlagsTable.resolved, false)),
      db
        .select({
          c: count(),
          stake: sql<string>`COALESCE(SUM(${betsTable.stakeAmount}), 0)::text`,
          payout: sql<string>`COALESCE(SUM(${betsTable.payoutAmount}), 0)::text`,
        })
        .from(betsTable)
        .where(gte(betsTable.placedAt, startOfToday)),
    ]);
    const statusMap = Object.fromEntries(
      usersByStatus.map((r) => [r.status, Number(r.c)]),
    );
    res.json({
      usersTotal: Number(usersTotal[0]?.c ?? 0),
      usersActive: statusMap.active ?? 0,
      usersSuspended: statusMap.suspended ?? 0,
      kycPending: Number(kycPending[0]?.c ?? 0),
      withdrawalsPending: Number(withdrawalsPending[0]?.c ?? 0),
      depositsPending: Number(depositsPending[0]?.c ?? 0),
      openFlags: Number(openFlags[0]?.c ?? 0),
      betsToday: Number(betsTodayAgg[0]?.c ?? 0),
      stakeToday: betsTodayAgg[0]?.stake ?? "0",
      payoutToday: betsTodayAgg[0]?.payout ?? "0",
    });
  } catch (err) {
    next(err);
  }
});

// ---- Agents -----------------------------------------------------------------

router.get("/agents", adminOnly, async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);

    const sortBy =
      typeof req.query.sortBy === "string" ? req.query.sortBy : "created";

    const allAgents = await db
      .select({
        agent: agentsTable,
        email: usersTable.email,
        displayName: usersTable.displayName,
        referralCode: usersTable.referralCode,
        userStatus: usersTable.status,
      })
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id));

    const totalRow = await db.select({ c: count() }).from(agentsTable);

    const agentIds = allAgents.map((a) => a.agent.id);
    const earningsMap = new Map<string, string>();
    const playerCountMap = new Map<string, number>();

    if (agentIds.length > 0) {
      const [earnings, refCodes] = await Promise.all([
        db
          .select({
            agentId: commissionsTable.agentId,
            total: sql<string>`COALESCE(SUM(${commissionsTable.commissionAmount}), 0)::text`,
          })
          .from(commissionsTable)
          .where(inArray(commissionsTable.agentId, agentIds))
          .groupBy(commissionsTable.agentId),
        Promise.resolve(allAgents.map((a) => a.referralCode).filter(Boolean)),
      ]);

      for (const e of earnings) {
        earningsMap.set(e.agentId, e.total);
      }

      if (refCodes.length > 0) {
        const playerCounts = await db
          .select({
            referredBy: usersTable.referredBy,
            c: count(),
          })
          .from(usersTable)
          .where(inArray(usersTable.referredBy, refCodes as string[]))
          .groupBy(usersTable.referredBy);

        const codeToAgentId = new Map<string, string>();
        for (const a of allAgents) {
          if (a.referralCode) codeToAgentId.set(a.referralCode, a.agent.id);
        }

        for (const pc of playerCounts) {
          if (pc.referredBy) {
            const aid = codeToAgentId.get(pc.referredBy);
            if (aid) playerCountMap.set(aid, Number(pc.c));
          }
        }
      }
    }

    const result = allAgents.map((a) => ({
      id: a.agent.id,
      userId: a.agent.userId,
      email: a.email,
      displayName: a.displayName,
      referralCode: a.referralCode,
      commissionRate: a.agent.commissionRate,
      upiId: a.agent.upiId,
      status: a.agent.status,
      userStatus: a.userStatus,
      totalEarned: earningsMap.get(a.agent.id) ?? "0",
      playerCount: playerCountMap.get(a.agent.id) ?? 0,
      createdAt: a.agent.createdAt.toISOString(),
    }));

    if (sortBy === "earnings") {
      result.sort((a, b) => {
        const diff = BigInt(b.totalEarned) - BigInt(a.totalEarned);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      });
    } else if (sortBy === "players") {
      result.sort((a, b) => b.playerCount - a.playerCount);
    } else {
      result.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }

    const paginated = result.slice(offset, offset + limit);

    res.json({
      agents: paginated,
      total: Number(totalRow[0]?.c ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/agents", adminWrite, (_req, res) => {
  res.status(409).json({error:{code:"BRANCH_FLOW_REQUIRED",message:"Create a master from B2B / B2C Network. The master creates its agents."}});
});

router.patch("/agents/:id", adminWrite, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const body = req.body as {
      commissionRate?: number;
      upiId?: string;
      status?: string;
    };

    const existing = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, id))
      .limit(1);
    if (!existing[0]) throw notFound("Agent not found");

    const updates: Partial<{
      commissionRate: number;
      upiId: string | null;
      status: string;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    if (body.commissionRate !== undefined) {
      if (!Number.isInteger(body.commissionRate) || body.commissionRate < 0 || body.commissionRate > 100) {
        throw badRequest("Commission rate must be 0-100");
      }
      updates.commissionRate = body.commissionRate;
    }
    if (body.upiId !== undefined) {
      updates.upiId = body.upiId || null;
    }
    if (body.status !== undefined) {
      if (!["active", "inactive"].includes(body.status)) {
        throw badRequest("Status must be active or inactive");
      }
      updates.status = body.status;
    }

    const [updated] = await db
      .update(agentsTable)
      .set(updates)
      .where(eq(agentsTable.id, id))
      .returning();

    await recordAuditFromReq(req, {
      action: "agent.update",
      targetType: "agent",
      targetId: id,
      before: {
        commissionRate: existing[0].commissionRate,
        upiId: existing[0].upiId,
        status: existing[0].status,
      },
      after: {
        commissionRate: updated!.commissionRate,
        upiId: updated!.upiId,
        status: updated!.status,
      },
    });

    res.json({
      id: updated!.id,
      userId: updated!.userId,
      commissionRate: updated!.commissionRate,
      upiId: updated!.upiId,
      status: updated!.status,
      updatedAt: updated!.updatedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/agents/:id", adminOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const agentRows = await db
      .select({
        agent: agentsTable,
        email: usersTable.email,
        displayName: usersTable.displayName,
        referralCode: usersTable.referralCode,
      })
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .where(eq(agentsTable.id, id))
      .limit(1);

    if (!agentRows[0]) throw notFound("Agent not found");
    const row = agentRows[0];

    const [earningsRow, payoutRows] = await Promise.all([
      db
        .select({
          total: sql<string>`COALESCE(SUM(${commissionsTable.commissionAmount}), 0)::text`,
        })
        .from(commissionsTable)
        .where(eq(commissionsTable.agentId, id)),
      db
        .select()
        .from(withdrawalsTable)
        .where(
          and(
            eq(withdrawalsTable.userId, row.agent.userId),
            eq(withdrawalsTable.kind, "agent_commission"),
          ),
        )
        .orderBy(desc(withdrawalsTable.requestedAt))
        .limit(20),
    ]);

    let playerCount = 0;
    if (row.referralCode) {
      const pcRows = await db
        .select({ c: count() })
        .from(usersTable)
        .where(eq(usersTable.referredBy, row.referralCode));
      playerCount = Number(pcRows[0]?.c ?? 0);
    }

    res.json({
      agent: {
        id: row.agent.id,
        userId: row.agent.userId,
        email: row.email,
        displayName: row.displayName,
        referralCode: row.referralCode,
        commissionRate: row.agent.commissionRate,
        upiId: row.agent.upiId,
        status: row.agent.status,
        createdAt: row.agent.createdAt.toISOString(),
      },
      stats: {
        totalEarned: earningsRow[0]?.total ?? "0",
        playerCount,
      },
      payouts: payoutRows.map((w) => ({
        id: w.id,
        amount: w.amount.toString(),
        currency: w.currency,
        method: w.method,
        destination: w.destination,
        kind: w.kind,
        status: w.status,
        rejectionReason: w.rejectionReason,
        reviewedBy: w.reviewedBy,
        reviewedAt: w.reviewedAt ? w.reviewedAt.toISOString() : null,
        requestedAt: w.requestedAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/agents/compute-commissions", adminWrite, async (req, res, next) => {
  try {
    const body = req.body as { date?: string };
    const dateStr = body.date ?? new Date(Date.now() - 86400_000).toISOString().split("T")[0];
    const created = await computeCommissions(dateStr);
    res.json({ date: dateStr, commissionsCreated: created });
  } catch (err) {
    next(err);
  }
});

// ---- UPI Accounts ----------------------------------------------------------

const MAX_QR_BYTES = 2 * 1024 * 1024; // 2 MB

const UpiAccountInputSchema = z.object({
  label: z.string().min(1).max(100),
  upiId: z.string().min(4).max(100),
  qrObjectKey: z.string().min(1).max(300).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const UpiAccountUpdateSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  upiId: z.string().min(4).max(100).optional(),
  qrObjectKey: z.string().min(1).max(300).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

router.put(
  "/upi-accounts/uploads/:filename",
  adminWrite,
  express.raw({ type: "*/*", limit: MAX_QR_BYTES }),
  async (req, res, next) => {
    try {
      const filename = String(req.params.filename ?? "");
      if (!filename) throw badRequest("filename is required");
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.byteLength === 0) {
        throw badRequest("Empty upload body");
      }
      const contentType = req.header("content-type") ?? null;
      const stored = await storeUpiQrObject({
        filename,
        body,
        contentType,
      });
      await recordAuditFromReq(req, {
        action: "upi_account.upload_qr",
        targetType: "upi_qr_object",
        targetId: stored.key,
        after: { size: stored.size, contentType: stored.contentType },
      });
      res.json(stored);
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "type" in err &&
        (err as { type?: string }).type === "entity.too.large"
      ) {
        return next(new HttpError(413, "PAYLOAD_TOO_LARGE", "Upload too large"));
      }
      next(err);
    }
  },
);

router.get("/upi-accounts", adminOnly, async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(upiAccountsTable)
      .orderBy(upiAccountsTable.sortOrder, upiAccountsTable.createdAt);
    res.json(rows.map(serializeUpiAccount));
  } catch (err) {
    next(err);
  }
});

router.post("/upi-accounts", adminWrite, async (req, res, next) => {
  try {
    const input = UpiAccountInputSchema.parse(req.body);
    const [row] = await db
      .insert(upiAccountsTable)
      .values({
        label: input.label,
        upiId: input.upiId,
        qrObjectKey: input.qrObjectKey ?? null,
        active: input.active ?? true,
        sortOrder: input.sortOrder ?? 0,
        createdBy: req.user!.id,
      })
      .returning();
    await recordAuditFromReq(req, {
      action: "upi_account.create",
      targetType: "upi_account",
      targetId: row!.id,
      after: { label: row!.label, upiId: row!.upiId, active: row!.active },
    });
    res.json(serializeUpiAccount(row!));
  } catch (err) {
    next(err);
  }
});

router.put("/upi-accounts/:id", adminWrite, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = UpiAccountUpdateSchema.parse(req.body);
    const existing = await db
      .select()
      .from(upiAccountsTable)
      .where(eq(upiAccountsTable.id, id))
      .limit(1);
    const before = existing[0];
    if (!before) throw notFound("UPI account not found");
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.label !== undefined) update.label = input.label;
    if (input.upiId !== undefined) update.upiId = input.upiId;
    if (input.qrObjectKey !== undefined) update.qrObjectKey = input.qrObjectKey;
    if (input.active !== undefined) update.active = input.active;
    if (input.sortOrder !== undefined) update.sortOrder = input.sortOrder;
    const [row] = await db
      .update(upiAccountsTable)
      .set(update)
      .where(eq(upiAccountsTable.id, id))
      .returning();
    if (
      input.qrObjectKey !== undefined &&
      input.qrObjectKey !== before.qrObjectKey &&
      before.qrObjectKey
    ) {
      await deleteUpiQrObject(before.qrObjectKey);
    }
    await recordAuditFromReq(req, {
      action: "upi_account.update",
      targetType: "upi_account",
      targetId: id,
      before: { label: before.label, upiId: before.upiId, active: before.active },
      after: { label: row!.label, upiId: row!.upiId, active: row!.active },
    });
    res.json(serializeUpiAccount(row!));
  } catch (err) {
    next(err);
  }
});

router.delete("/upi-accounts/:id", adminWrite, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const existing = await db
      .select()
      .from(upiAccountsTable)
      .where(eq(upiAccountsTable.id, id))
      .limit(1);
    const before = existing[0];
    if (!before) throw notFound("UPI account not found");
    await db.delete(upiAccountsTable).where(eq(upiAccountsTable.id, id));
    if (before.qrObjectKey) {
      await deleteUpiQrObject(before.qrObjectKey);
    }
    await recordAuditFromReq(req, {
      action: "upi_account.delete",
      targetType: "upi_account",
      targetId: id,
      before: { label: before.label, upiId: before.upiId },
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ---- Round Profit Split (pari-mutuel settlement) ---------------------------

/**
 * Summary cards for the admin "Round Profit Split" page. Returns the
 * pool / payout / company-profit totals for today (UTC), the trailing
 * 7 and 30 days, and all-time. The page renders four cards from this.
 */
router.get("/round-settlements/summary", adminOnly, async (req, res, next) => {
  try {
    const gameCode =
      typeof req.query.gameCode === "string" ? req.query.gameCode : null;
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [today, week, month, all] = await Promise.all([
      settlementTotals({ since: startOfToday, gameCode }),
      settlementTotals({ since: sevenDaysAgo, gameCode }),
      settlementTotals({ since: thirtyDaysAgo, gameCode }),
      settlementTotals({ gameCode }),
    ]);
    res.json({ today, last7d: week, last30d: month, allTime: all });
  } catch (err) {
    next(err);
  }
});

/**
 * 30-day daily series for the company-profit vs player-payout chart.
 * Buckets are UTC calendar days; missing days are filled with zeros so the
 * chart's x-axis stays continuous.
 */
router.get("/round-settlements/daily", adminOnly, async (req, res, next) => {
  try {
    const days = Math.min(
      Math.max(parseInt(String(req.query.days ?? "30"), 10) || 30, 1),
      90,
    );
    const gameCode =
      typeof req.query.gameCode === "string" ? req.query.gameCode : null;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const conds = [sql`${roundSettlementsTable.settledAt} >= ${since}`];
    if (gameCode) conds.push(sql`${roundSettlementsTable.gameCode} = ${gameCode}`);
    const rows = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${roundSettlementsTable.settledAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
        totalPool: sql<string>`COALESCE(SUM(${roundSettlementsTable.totalPool}), 0)::text`,
        playerPool: sql<string>`COALESCE(SUM(${roundSettlementsTable.playerPool}), 0)::text`,
        companyProfit: sql<string>`COALESCE(SUM(${roundSettlementsTable.companyProfit}), 0)::text`,
        rounds: sql<string>`COUNT(*)::text`,
      })
      .from(roundSettlementsTable)
      .where(sql`${conds.reduce((a, b) => sql`${a} AND ${b}`)}`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    // Fill any missing UTC days with zeros so the chart stays continuous.
    const map = new Map(rows.map((r) => [r.day, r]));
    const out: Array<{
      day: string;
      totalPool: string;
      playerPool: string;
      companyProfit: string;
      rounds: number;
    }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      const r = map.get(key);
      out.push({
        day: key,
        totalPool: r?.totalPool ?? "0",
        playerPool: r?.playerPool ?? "0",
        companyProfit: r?.companyProfit ?? "0",
        rounds: r ? Number(r.rounds) : 0,
      });
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get("/round-settlements", adminOnly, async (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
      200,
    );
    const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
    const gameCode =
      typeof req.query.gameCode === "string" ? req.query.gameCode : null;
    // Validate date params: bad ISO -> 400 (not 500). Unset -> ignore.
    let dateFrom: Date | null = null;
    if (typeof req.query.dateFrom === "string" && req.query.dateFrom) {
      const d = new Date(req.query.dateFrom);
      if (Number.isNaN(d.getTime())) {
        throw badRequest("dateFrom must be a valid ISO date");
      }
      dateFrom = d;
    }
    let dateTo: Date | null = null;
    if (typeof req.query.dateTo === "string" && req.query.dateTo) {
      const d = new Date(req.query.dateTo);
      if (Number.isNaN(d.getTime())) {
        throw badRequest("dateTo must be a valid ISO date");
      }
      dateTo = d;
    }
    // Validate minPool: must be a non-negative integer string in paise.
    // BigInt() throws SyntaxError on garbage like "abc" or "1.5", which
    // would otherwise bubble up as a 500 — convert to a 400 instead.
    let minPool: bigint | null = null;
    if (typeof req.query.minPool === "string" && req.query.minPool) {
      if (!/^\d+$/.test(req.query.minPool)) {
        throw badRequest("minPool must be a non-negative integer (paise)");
      }
      minPool = BigInt(req.query.minPool);
    }
    const conds = [sql`true`];
    if (gameCode) conds.push(sql`${roundSettlementsTable.gameCode} = ${gameCode}`);
    if (dateFrom) conds.push(sql`${roundSettlementsTable.settledAt} >= ${dateFrom}`);
    if (dateTo) conds.push(sql`${roundSettlementsTable.settledAt} < ${dateTo}`);
    if (minPool !== null && minPool > 0n)
      conds.push(sql`${roundSettlementsTable.totalPool} >= ${minPool}`);
    const where = conds.reduce((a, b) => sql`${a} AND ${b}`);
    const [{ total }] = (await db
      .select({ total: sql<string>`COUNT(*)::text` })
      .from(roundSettlementsTable)
      .where(where)) as { total: string }[];
    const rows = await db
      .select()
      .from(roundSettlementsTable)
      .where(where)
      .orderBy(desc(roundSettlementsTable.settledAt))
      .limit(limit)
      .offset(offset);
    res.json({
      total: Number(total),
      settlements: rows.map((r) => ({
        id: r.id,
        roundId: r.roundId,
        gameCode: r.gameCode,
        totalPool: r.totalPool.toString(),
        playerPool: r.playerPool.toString(),
        companyProfit: r.companyProfit.toString(),
        winnerCount: r.winnerCount,
        loserCount: r.loserCount,
        settledAt: r.settledAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/round-settlements/:id", adminOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const rows = await db
      .select()
      .from(roundSettlementsTable)
      .where(eq(roundSettlementsTable.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("Settlement not found");
    const entries = await db
      .select()
      .from(roundSettlementEntriesTable)
      .where(eq(roundSettlementEntriesTable.settlementId, id))
      .orderBy(desc(roundSettlementEntriesTable.payout));
    res.json({
      id: row.id,
      roundId: row.roundId,
      gameCode: row.gameCode,
      totalPool: row.totalPool.toString(),
      playerPool: row.playerPool.toString(),
      companyProfit: row.companyProfit.toString(),
      winnerCount: row.winnerCount,
      loserCount: row.loserCount,
      settledAt: row.settledAt.toISOString(),
      entries: entries.map((e) => ({
        id: e.id,
        userId: e.userId,
        betId: e.betId,
        stake: e.stake.toString(),
        cashoutMultiplier: e.cashoutMultiplier,
        payout: e.payout.toString(),
        profit: e.profit.toString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
