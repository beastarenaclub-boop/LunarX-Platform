import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  bigint,
  index,
  uniqueIndex,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

export const agentsTable = pgTable(
  "agents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    commissionRate: integer("commission_rate").notNull().default(10),
    upiId: text("upi_id"),
    parentAgentId: text("parent_agent_id"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("agents_user_id_idx").on(t.userId),
    index("agents_status_idx").on(t.status),
  ],
);

export type Agent = typeof agentsTable.$inferSelect;

export const commissionStatusEnum = pgEnum("commission_status", [
  "pending",
  "settled",
]);

export const commissionsTable = pgTable(
  "commissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    playerId: text("player_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    periodDate: timestamp("period_date", { withTimezone: true }).notNull(),
    grossStake: bigint("gross_stake", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    grossPayout: bigint("gross_payout", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    netRevenue: bigint("net_revenue", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    commissionRate: integer("commission_rate").notNull(),
    commissionAmount: bigint("commission_amount", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    status: commissionStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("commissions_agent_id_idx").on(t.agentId),
    index("commissions_player_id_idx").on(t.playerId),
    index("commissions_period_date_idx").on(t.periodDate),
    index("commissions_status_idx").on(t.status),
    uniqueIndex("commissions_agent_player_date_idx").on(
      t.agentId,
      t.playerId,
      t.periodDate,
    ),
  ],
);

export type Commission = typeof commissionsTable.$inferSelect;
export type CommissionStatus =
  (typeof commissionStatusEnum.enumValues)[number];

export const agentPayoutStatusEnum = pgEnum("agent_payout_status", [
  "pending",
  "approved",
  "rejected",
  "paid",
]);

export const agentPayoutsTable = pgTable(
  "agent_payouts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "restrict" }),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("INR"),
    upiId: text("upi_id").notNull(),
    status: agentPayoutStatusEnum("status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    reviewedBy: text("reviewed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata"),
  },
  (t) => [
    index("agent_payouts_agent_id_idx").on(t.agentId),
    index("agent_payouts_status_idx").on(t.status),
    index("agent_payouts_requested_at_idx").on(t.requestedAt),
  ],
);

export type AgentPayout = typeof agentPayoutsTable.$inferSelect;
export type AgentPayoutStatus =
  (typeof agentPayoutStatusEnum.enumValues)[number];
