import {
  db,
  paymentRequestsTable,
  withdrawalsTable,
  walletLedgerTable,
  reconciliationEntriesTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, or, inArray } from "drizzle-orm";
import { getPaymentProvider } from "./payment-gateway";
import { logger } from "../lib/logger";

export async function runReconciliation(date: Date) {
  const provider = getPaymentProvider();
  const from = new Date(date);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(date);
  to.setUTCHours(23, 59, 59, 999);

  const runDate = new Date();

  const [gatewayTxns, deposits, withdrawals] = await Promise.all([
    provider.listSettlements({ from, to }),
    db
      .select()
      .from(paymentRequestsTable)
      .where(
        and(
          eq(paymentRequestsTable.kind, "deposit"),
          gte(paymentRequestsTable.createdAt, from),
          lte(paymentRequestsTable.createdAt, to),
          or(
            eq(paymentRequestsTable.status, "approved"),
            eq(paymentRequestsTable.status, "gateway_pending"),
          ),
        ),
      ),
    db
      .select()
      .from(withdrawalsTable)
      .where(
        and(
          gte(withdrawalsTable.requestedAt, from),
          lte(withdrawalsTable.requestedAt, to),
          or(
            eq(withdrawalsTable.status, "paid"),
            eq(withdrawalsTable.status, "approved"),
            eq(withdrawalsTable.status, "failed"),
          ),
        ),
      ),
  ]);

  const depositIds = deposits.map((d) => d.id);
  const withdrawalIds = withdrawals.map((w) => w.id);

  const ledgerEntries = depositIds.length > 0 || withdrawalIds.length > 0
    ? await db
        .select()
        .from(walletLedgerTable)
        .where(
          or(
            depositIds.length > 0
              ? and(
                  eq(walletLedgerTable.refType, "payment_request"),
                  inArray(walletLedgerTable.refId, depositIds),
                )
              : undefined,
            withdrawalIds.length > 0
              ? and(
                  eq(walletLedgerTable.refType, "withdrawal"),
                  inArray(walletLedgerTable.refId, withdrawalIds),
                )
              : undefined,
          ),
        )
    : [];

  const depositLedgerMap = new Map<string, { amount: bigint; entryId: string }>();
  const withdrawalLedgerMap = new Map<string, { amount: bigint; entryId: string }>();
  for (const le of ledgerEntries) {
    if (le.refType === "payment_request" && le.refId && le.type === "deposit") {
      depositLedgerMap.set(le.refId, { amount: le.amount, entryId: le.id });
    }
    if (le.refType === "withdrawal" && le.refId && le.type === "withdraw") {
      withdrawalLedgerMap.set(le.refId, { amount: le.amount, entryId: le.id });
    }
  }

  const gatewayMap = new Map(
    gatewayTxns.map((t) => [t.gatewayOrderId, t]),
  );

  const entries: Array<typeof reconciliationEntriesTable.$inferInsert> = [];

  for (const dep of deposits) {
    if (!dep.gatewayOrderId) continue;
    const gw = gatewayMap.get(dep.gatewayOrderId);
    const ledger = depositLedgerMap.get(dep.id);

    if (!gw) {
      entries.push({
        runDate,
        gatewayOrderId: dep.gatewayOrderId,
        paymentRequestId: dep.id,
        ledgerEntryId: ledger?.entryId ?? null,
        direction: "deposit",
        ledgerAmount: ledger?.amount ?? null,
        gatewayAmount: null,
        status: "missing_in_gateway",
        details: { depositId: dep.id, status: dep.status },
      });
    } else {
      gatewayMap.delete(dep.gatewayOrderId);
      const ledgerAmt = ledger?.amount ?? null;

      if (dep.status === "approved" && !ledger) {
        entries.push({
          runDate,
          gatewayOrderId: dep.gatewayOrderId,
          paymentRequestId: dep.id,
          direction: "deposit",
          ledgerAmount: null,
          gatewayAmount: gw.amount,
          status: "status_mismatch",
          details: {
            reason: "Gateway paid and deposit approved but no ledger credit found",
            depositStatus: dep.status,
            gatewayStatus: gw.status,
          },
        });
      } else if (gw.status === "paid" && dep.status === "gateway_pending") {
        entries.push({
          runDate,
          gatewayOrderId: dep.gatewayOrderId,
          paymentRequestId: dep.id,
          direction: "deposit",
          ledgerAmount: null,
          gatewayAmount: gw.amount,
          status: "status_mismatch",
          details: {
            reason: "Gateway reports paid but deposit still pending — webhook may have been missed",
            depositStatus: dep.status,
            gatewayStatus: gw.status,
          },
        });
      } else if (ledgerAmt !== null && gw.amount !== ledgerAmt) {
        entries.push({
          runDate,
          gatewayOrderId: dep.gatewayOrderId,
          paymentRequestId: dep.id,
          ledgerEntryId: ledger?.entryId ?? null,
          direction: "deposit",
          ledgerAmount: ledgerAmt,
          gatewayAmount: gw.amount,
          status: "mismatch_amount",
          details: {
            expected: ledgerAmt.toString(),
            actual: gw.amount.toString(),
          },
        });
      } else {
        entries.push({
          runDate,
          gatewayOrderId: dep.gatewayOrderId,
          paymentRequestId: dep.id,
          ledgerEntryId: ledger?.entryId ?? null,
          direction: "deposit",
          ledgerAmount: ledgerAmt,
          gatewayAmount: gw.amount,
          status: "matched",
        });
      }
    }
  }

  for (const wd of withdrawals) {
    if (!wd.gatewayPayoutId) continue;
    const gw = gatewayMap.get(wd.gatewayPayoutId);
    const ledger = withdrawalLedgerMap.get(wd.id);

    if (!gw) {
      entries.push({
        runDate,
        gatewayOrderId: wd.gatewayPayoutId,
        withdrawalId: wd.id,
        ledgerEntryId: ledger?.entryId ?? null,
        direction: "payout",
        ledgerAmount: ledger?.amount ?? null,
        gatewayAmount: null,
        status: "missing_in_gateway",
        details: { withdrawalId: wd.id, status: wd.status },
      });
    } else {
      gatewayMap.delete(wd.gatewayPayoutId);
      const ledgerAmt = ledger?.amount ?? null;
      const absLedger = ledgerAmt !== null ? (ledgerAmt < 0n ? -ledgerAmt : ledgerAmt) : null;

      if (wd.status === "paid" && !ledger) {
        entries.push({
          runDate,
          gatewayOrderId: wd.gatewayPayoutId,
          withdrawalId: wd.id,
          direction: "payout",
          ledgerAmount: null,
          gatewayAmount: gw.amount,
          status: "status_mismatch",
          details: {
            reason: "Gateway completed payout but no ledger debit found",
            withdrawalStatus: wd.status,
            gatewayStatus: gw.status,
          },
        });
      } else if (gw.status === "completed" && wd.status !== "paid") {
        entries.push({
          runDate,
          gatewayOrderId: wd.gatewayPayoutId,
          withdrawalId: wd.id,
          ledgerEntryId: ledger?.entryId ?? null,
          direction: "payout",
          ledgerAmount: ledgerAmt,
          gatewayAmount: gw.amount,
          status: "status_mismatch",
          details: {
            reason: "Gateway reports completed but withdrawal not marked paid",
            withdrawalStatus: wd.status,
            gatewayStatus: gw.status,
          },
        });
      } else if (absLedger !== null && gw.amount !== absLedger) {
        entries.push({
          runDate,
          gatewayOrderId: wd.gatewayPayoutId,
          withdrawalId: wd.id,
          ledgerEntryId: ledger?.entryId ?? null,
          direction: "payout",
          ledgerAmount: ledgerAmt,
          gatewayAmount: gw.amount,
          status: "mismatch_amount",
          details: {
            expected: absLedger.toString(),
            actual: gw.amount.toString(),
          },
        });
      } else {
        entries.push({
          runDate,
          gatewayOrderId: wd.gatewayPayoutId,
          withdrawalId: wd.id,
          ledgerEntryId: ledger?.entryId ?? null,
          direction: "payout",
          ledgerAmount: ledgerAmt,
          gatewayAmount: gw.amount,
          status: "matched",
        });
      }
    }
  }

  for (const [orderId, gw] of gatewayMap) {
    entries.push({
      runDate,
      gatewayOrderId: orderId,
      direction: gw.type,
      ledgerAmount: null,
      gatewayAmount: gw.amount,
      status: "missing_in_ledger",
      details: { gatewayStatus: gw.status, utr: gw.utr },
    });
  }

  if (entries.length > 0) {
    await db.insert(reconciliationEntriesTable).values(entries);
  }

  const mismatches = entries.filter((e) => e.status !== "matched");
  logger.info(
    { date: from.toISOString(), total: entries.length, mismatches: mismatches.length },
    "Reconciliation complete",
  );

  return { total: entries.length, mismatches: mismatches.length, runDate };
}

export async function listReconciliationEntries(opts: {
  status?: string;
  limit: number;
  offset: number;
}) {
  const conds = [] as ReturnType<typeof eq>[];
  if (opts.status) {
    conds.push(eq(reconciliationEntriesTable.status, opts.status as never));
  }
  const where = conds.length ? and(...conds) : undefined;
  return db
    .select()
    .from(reconciliationEntriesTable)
    .where(where)
    .orderBy(desc(reconciliationEntriesTable.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
}
