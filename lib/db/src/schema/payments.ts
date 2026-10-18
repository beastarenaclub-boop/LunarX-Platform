import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  bigint,
  boolean,
  index,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { networkNodesTable } from "./network";

export const masterPaymentAccountsTable = pgTable("master_payment_accounts", {
  masterId: text("master_id").primaryKey().references(() => networkNodesTable.id),
  label: text("label").notNull(),
  upiId: text("upi_id").notNull(),
  qrData: text("qr_data"),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentRequestKindEnum = pgEnum("payment_request_kind", [
  "deposit",
  "withdraw",
]);

export const paymentRequestStatusEnum = pgEnum("payment_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "gateway_pending",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "manual",
  "auto",
]);

export const paymentRequestsTable = pgTable(
  "payment_requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: paymentRequestKindEnum("kind").notNull(),
    method: paymentMethodEnum("method").notNull().default("manual"),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("INR"),
    // Which per-game wallet this deposit/withdraw targets. Deposits and
    // balances are fully separate per game ("lunar" | "mines" | "plinko" |
    // "dice"); legacy rows default to "lunar".
    game: text("game").notNull().default("lunar"),
    // Coin-pack identity for deposits bought from the server-owned catalog.
    // Nullable on purpose: legacy rows and free-form custom amounts have no
    // SKU. When set, `packageSku` is the stable human-readable catalog id and
    // `coinQuantity` is the coin count the SKU grants (both server-derived,
    // never trusted from the client).
    packageSku: text("package_sku"),
    coinQuantity: integer("coin_quantity"),
    status: paymentRequestStatusEnum("status").notNull().default("pending"),
    upiRef: text("upi_ref"),
    upiId: text("upi_id"),
    collectionMasterId: text("collection_master_id").references(() => networkNodesTable.id),
    collectionAccountVersion: integer("collection_account_version"),
    notes: text("notes"),
    rejectionReason: text("rejection_reason"),
    gatewayOrderId: text("gateway_order_id"),
    gatewayStatus: text("gateway_status"),
    gatewayRaw: text("gateway_raw"),
    processedBy: text("processed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ledgerEntryId: text("ledger_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("payment_requests_user_id_idx").on(t.userId),
    index("payment_requests_status_idx").on(t.status),
    index("payment_requests_kind_idx").on(t.kind),
    index("payment_requests_created_at_idx").on(t.createdAt),
    uniqueIndex("payment_requests_master_utr_idx")
      .on(t.collectionMasterId, sql`lower(${t.upiRef})`)
      .where(sql`${t.collectionMasterId} IS NOT NULL AND ${t.kind} = 'deposit' AND ${t.method} = 'manual'`),
  ],
);

export type PaymentRequest = typeof paymentRequestsTable.$inferSelect;
export type PaymentRequestKind =
  (typeof paymentRequestKindEnum.enumValues)[number];
export type PaymentRequestStatus =
  (typeof paymentRequestStatusEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];

export const depositSettingsTable = pgTable("deposit_settings", {
  id: text("id")
    .primaryKey()
    .default("singleton"),
  manualEnabled: boolean("manual_enabled").notNull().default(true),
  autoEnabled: boolean("auto_enabled").notNull().default(false),
  minAmountPaise: bigint("min_amount_paise", { mode: "bigint" })
    .notNull()
    .default(sql`10000`),
  maxAmountPaise: bigint("max_amount_paise", { mode: "bigint" })
    .notNull()
    .default(sql`10000000`),
  withdrawMinAmountPaise: bigint("withdraw_min_amount_paise", { mode: "bigint" })
    .notNull()
    .default(sql`10000`),
  withdrawMaxAmountPaise: bigint("withdraw_max_amount_paise", { mode: "bigint" })
    .notNull()
    .default(sql`10000000`),
  withdrawDailyPerUserPaise: bigint("withdraw_daily_per_user_paise", {
    mode: "bigint",
  })
    .notNull()
    .default(sql`0`),
  withdrawDailyPlatformPaise: bigint("withdraw_daily_platform_paise", {
    mode: "bigint",
  })
    .notNull()
    .default(sql`0`),
  updatedBy: text("updated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DepositSettings = typeof depositSettingsTable.$inferSelect;

export const upiAccountsTable = pgTable(
  "upi_accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    label: text("label").notNull(),
    upiId: text("upi_id").notNull(),
    qrObjectKey: text("qr_object_key"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("upi_accounts_active_idx").on(t.active),
    index("upi_accounts_sort_order_idx").on(t.sortOrder),
  ],
);

export type UpiAccount = typeof upiAccountsTable.$inferSelect;
