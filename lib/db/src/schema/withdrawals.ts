import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  bigint,
  index,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

export const withdrawalStatusEnum = pgEnum("withdrawal_status", [
  "pending",
  "approved",
  "rejected",
  "paid",
  "failed",
]);

export const withdrawalsTable = pgTable(
  "withdrawals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("INR"),
    method: text("method").notNull().default("upi"),
    destination: text("destination").notNull(),
    kind: text("kind").notNull().default("player_withdrawal"),
    status: withdrawalStatusEnum("status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    gatewayPayoutId: text("gateway_payout_id"),
    gatewayStatus: text("gateway_status"),
    utr: text("utr"),
    manualSettlement: boolean("manual_settlement").notNull().default(false),
    reviewedBy: text("reviewed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata"),
  },
  (t) => [
    index("withdrawals_user_id_idx").on(t.userId),
    index("withdrawals_status_idx").on(t.status),
    index("withdrawals_requested_at_idx").on(t.requestedAt),
    index("withdrawals_kind_idx").on(t.kind),
  ],
);

export type Withdrawal = typeof withdrawalsTable.$inferSelect;
export type WithdrawalStatus =
  (typeof withdrawalStatusEnum.enumValues)[number];
