import {
  pgTable,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
  bigint,
  bigserial,
  boolean,
  jsonb,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

export const networkNodesTable = pgTable(
  "network_nodes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    kind: text("kind").$type<"master" | "agent">().notNull(),
    parentId: text("parent_id").references(
      (): AnyPgColumn => networkNodesTable.id,
    ),
    name: text("name").notNull(),
    status: text("status")
      .$type<"active" | "suspended">()
      .notNull()
      .default("active"),
    companyFeeBps: integer("company_fee_bps").notNull().default(1000),
    shareBps: integer("share_bps").notNull().default(10000),
    createdBy: text("created_by")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("network_user_idx").on(t.userId),
    index("network_parent_idx").on(t.parentId),
  ],
);

export type NetworkNode = typeof networkNodesTable.$inferSelect;

const terms = () =>
  jsonb("terms")
    .$type<{
      companyFeeBps: number;
      masterShareBps: number;
      agentShareBps: number;
    }>()
    .notNull();
export const networkWagersTable = pgTable(
  "network_wagers",
  {
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    gameCode: text("game_code").notNull(),
    channel: text("channel").notNull(),
    masterId: text("master_id").references(() => networkNodesTable.id),
    agentId: text("agent_id").references(() => networkNodesTable.id),
    terms: terms(),
    stake: bigint("stake", { mode: "bigint" }).notNull().default(0n),
    payout: bigint("payout", { mode: "bigint" }).notNull().default(0n),
    settled: boolean("settled").notNull().default(false),
    companyAmount: bigint("company_amount", { mode: "bigint" })
      .notNull()
      .default(0n),
    masterAmount: bigint("master_amount", { mode: "bigint" })
      .notNull()
      .default(0n),
    agentAmount: bigint("agent_amount", { mode: "bigint" })
      .notNull()
      .default(0n),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.sourceId] }),
    index("network_wagers_user_idx").on(t.userId),
    index("network_wagers_branch_idx").on(t.masterId, t.agentId),
  ],
);
export const networkLedgerTable = pgTable(
  "network_ledger",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    revision: integer("revision").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    gameCode: text("game_code").notNull(),
    channel: text("channel").notNull(),
    masterId: text("master_id").references(() => networkNodesTable.id),
    agentId: text("agent_id").references(() => networkNodesTable.id),
    accountId: text("account_id").notNull(),
    accountKind: text("account_kind").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    grossStake: bigint("gross_stake", { mode: "bigint" }).notNull(),
    grossPayout: bigint("gross_payout", { mode: "bigint" }).notNull(),
    terms: terms(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("network_ledger_event_account_idx").on(
      t.source,
      t.sourceId,
      t.revision,
      t.accountId,
    ),
    index("network_ledger_account_idx").on(t.accountId, t.createdAt),
    index("network_ledger_channel_idx").on(t.channel, t.createdAt),
  ],
);
export const networkSettlementsTable = pgTable("network_settlements", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  nodeId: text("node_id")
    .notNull()
    .references(() => networkNodesTable.id),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  reference: text("reference").notNull(),
  requestId: text("request_id").notNull().unique(),
  createdBy: text("created_by")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
