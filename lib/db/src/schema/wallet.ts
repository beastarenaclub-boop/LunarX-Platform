import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  bigint,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

export const walletsTable = pgTable(
  "wallets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    currency: text("currency").notNull().default("INR"),
    // All games use the legacy "lunar" key as their one shared cash wallet.
    // Other scopes are archived after the append-only balance migration.
    scope: text("scope").notNull().default("lunar"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("wallets_user_currency_scope_idx").on(
      t.userId,
      t.currency,
      t.scope,
    ),
  ],
);

export type Wallet = typeof walletsTable.$inferSelect;

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "deposit",
  "withdraw",
  "bet",
  "win",
  "bonus",
  "adjustment",
  "refund",
  "commission",
]);

// Amounts are stored as signed integers in the smallest unit (paise for INR).
// Positive = credit to wallet, negative = debit from wallet.
// balanceAfter is the running balance after this entry is applied.
// Entries are append-only; never UPDATE or DELETE.
export const walletLedgerTable = pgTable(
  "wallet_ledger",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    walletId: text("wallet_id")
      .notNull()
      .references(() => walletsTable.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    type: ledgerEntryTypeEnum("type").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "bigint" }).notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    memo: text("memo"),
    metadata: jsonb("metadata"),
    createdBy: text("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ledger_wallet_id_idx").on(t.walletId),
    index("ledger_user_id_idx").on(t.userId),
    index("ledger_type_idx").on(t.type),
    index("ledger_created_at_idx").on(t.createdAt),
  ],
);

export type WalletLedgerEntry = typeof walletLedgerTable.$inferSelect;
export type LedgerEntryType = (typeof ledgerEntryTypeEnum.enumValues)[number];
