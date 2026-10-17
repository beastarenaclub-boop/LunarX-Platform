import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  bigint,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { betsTable } from "./bets";

export const minesRoundStatusEnum = pgEnum("mines_round_status", [
  "active",
  "cashed_out",
  "busted",
]);

export const minesRoundsTable = pgTable(
  "mines_rounds",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    betId: text("bet_id")
      .notNull()
      .unique()
      .references(() => betsTable.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    // Provably-fair commitment for THIS round (snapshot — never mutated).
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    clientSeed: text("client_seed").notNull(),
    nonce: bigint("nonce", { mode: "number" }).notNull(),
    // Game shape + outcome.
    gridSize: integer("grid_size").notNull(),
    mineCount: integer("mine_count").notNull(),
    mineIndexes: jsonb("mine_indexes").notNull(),
    revealedIndexes: jsonb("revealed_indexes")
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Per-round config snapshot so historical verification stays stable
    // even if admins change house_edge later.
    houseEdge: doublePrecision("house_edge").notNull(),
    payoutVersion: integer("payout_version").notNull().default(2),
    maxMultiplier: doublePrecision("max_multiplier").notNull(),
    // Current/final multiplier (1.0 when no cells revealed yet).
    multiplier: doublePrecision("multiplier").notNull().default(1),
    status: minesRoundStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("mines_rounds_user_id_idx").on(t.userId),
    index("mines_rounds_status_idx").on(t.status),
    index("mines_rounds_created_at_idx").on(t.createdAt),
    // DB-level enforcement of one active mines round per user.
    // Application also pre-checks (for nicer error), but this guarantees
    // the invariant under concurrent /place requests — Postgres serializes
    // the unique-index check, so the loser sees a unique violation.
    uniqueIndex("mines_rounds_one_active_per_user_idx")
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export type MinesRound = typeof minesRoundsTable.$inferSelect;
export type MinesRoundStatus = (typeof minesRoundStatusEnum.enumValues)[number];
