import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  index,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

export const fraudSeverityEnum = pgEnum("fraud_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const walletStatusValueEnum = pgEnum("wallet_status_value", [
  "active",
  "frozen",
]);

export const fraudFlagsTable = pgTable(
  "fraud_flags",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    rule: text("rule").notNull(),
    severity: fraudSeverityEnum("severity").notNull().default("medium"),
    description: text("description"),
    metadata: jsonb("metadata"),
    resolved: boolean("resolved").notNull().default(false),
    resolvedBy: text("resolved_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("fraud_flags_user_id_idx").on(t.userId),
    index("fraud_flags_rule_idx").on(t.rule),
    index("fraud_flags_resolved_idx").on(t.resolved),
    index("fraud_flags_created_at_idx").on(t.createdAt),
  ],
);

export type FraudFlag = typeof fraudFlagsTable.$inferSelect;
export type FraudSeverity = (typeof fraudSeverityEnum.enumValues)[number];

export const walletStatusTable = pgTable("wallet_statuses", {
  userId: text("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  status: walletStatusValueEnum("status").notNull().default("active"),
  reason: text("reason"),
  updatedBy: text("updated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WalletStatusRow = typeof walletStatusTable.$inferSelect;
export type WalletStatusValue =
  (typeof walletStatusValueEnum.enumValues)[number];
