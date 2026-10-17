import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  bigint,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export const reconStatusEnum = pgEnum("recon_status", [
  "matched",
  "mismatch_amount",
  "missing_in_gateway",
  "missing_in_ledger",
  "status_mismatch",
]);

export const reconciliationEntriesTable = pgTable(
  "reconciliation_entries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    runDate: timestamp("run_date", { withTimezone: true }).notNull(),
    gatewayOrderId: text("gateway_order_id"),
    ledgerEntryId: text("ledger_entry_id"),
    paymentRequestId: text("payment_request_id"),
    withdrawalId: text("withdrawal_id"),
    direction: text("direction").notNull(),
    gatewayAmount: bigint("gateway_amount", { mode: "bigint" }),
    ledgerAmount: bigint("ledger_amount", { mode: "bigint" }),
    status: reconStatusEnum("status").notNull(),
    details: jsonb("details"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("recon_run_date_idx").on(t.runDate),
    index("recon_status_idx").on(t.status),
    index("recon_gateway_order_idx").on(t.gatewayOrderId),
    index("recon_created_at_idx").on(t.createdAt),
  ],
);

export type ReconciliationEntry =
  typeof reconciliationEntriesTable.$inferSelect;
export type ReconStatus = (typeof reconStatusEnum.enumValues)[number];
