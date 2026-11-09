import { pgTable, text, bigint, timestamp, integer, jsonb, index, uniqueIndex, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { networkNodesTable, networkSettlementsTable } from "./network";
import { usersTable } from "./users";
import { walletLedgerTable } from "./wallet";

export const networkBankEntriesTable = pgTable("network_bank_entries", {
  id: text("id").primaryKey(),
  masterId: text("master_id").notNull().references(() => networkNodesTable.id),
  kind: text("kind").$type<"reserve" | "return" | "distribute">().notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  balanceAfter: bigint("balance_after", { mode: "bigint" }).notNull(),
  requestId: text("request_id").notNull().unique(),
  createdBy: text("created_by").notNull().references(() => usersTable.id),
  settlementId: text("settlement_id").references(() => networkSettlementsTable.id),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("network_bank_master_idx").on(t.masterId, t.createdAt),
  uniqueIndex("network_bank_settlement_idx").on(t.settlementId),
  check("network_bank_amount_check", sql`(${t.kind}='reserve' AND ${t.amount}>0) OR (${t.kind} IN ('return','distribute') AND ${t.amount}<0)`),
  check("network_bank_balance_check", sql`${t.balanceAfter}>=0`),
]);
export const networkProfitDistributionsTable = pgTable("network_profit_distributions", {
  id: text("id").primaryKey().references(() => networkBankEntriesTable.id),
  cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
  totalStake: bigint("total_stake", { mode: "bigint" }).notNull(),
  recipientCount: integer("recipient_count").notNull(),
  previewHash: text("preview_hash").notNull(),
}, t => [check("network_profit_distribution_check", sql`${t.totalStake}>0 AND ${t.recipientCount}>0`)]);
export const networkProfitRecipientsTable = pgTable("network_profit_recipients", {
  distributionId: text("distribution_id").notNull().references(() => networkProfitDistributionsTable.id),
  userId: text("user_id").notNull().references(() => usersTable.id),
  stake: bigint("stake", { mode: "bigint" }).notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  walletEntryId: text("wallet_entry_id").references(() => walletLedgerTable.id),
}, t => [primaryKey({ columns: [t.distributionId, t.userId] }), uniqueIndex("network_profit_wallet_entry_idx").on(t.walletEntryId),
  check("network_profit_recipient_check", sql`${t.stake}>0 AND ${t.amount}>=0 AND ((${t.amount}=0 AND ${t.walletEntryId} IS NULL) OR (${t.amount}>0 AND ${t.walletEntryId} IS NOT NULL))`)]);
