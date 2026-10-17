import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  bigint,
  jsonb,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { betsTable } from "./bets";

/**
 * One Lucky 7 (7 Up / 7 Down) slip = one bets-table row (aggregate stake) +
 * one audit row here. `bets` stores the individual under/exactly/over bets
 * with per-bet payouts; the two dice are stored so verification and history
 * can replay the exact round from the provably-fair seed tuple.
 *
 * New rows wrap bets as { payoutVersion, bets }; legacy bare arrays retain
 * edge-scaled pricing. /verify uses the stored version and pricing inputs,
 * never today's config.
 */
export const lucky7RoundsTable = pgTable(
  "lucky_7_rounds",
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
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    clientSeed: text("client_seed").notNull(),
    nonce: bigint("nonce", { mode: "number" }).notNull(),
    /** The two rolled dice, each 1..6. */
    die1: integer("die_1").notNull(),
    die2: integer("die_2").notNull(),
    /** die1 + die2 (2..12) — the total the spots settle against. */
    total: integer("total").notNull(),
    /**
     * { payoutVersion, bets: [{ type, amountPaise, payoutPaise, didWin }] }.
     * Legacy rows are bare bet arrays; amounts are strings for bigint safety.
     */
    bets: jsonb("bets").notNull(),
    totalStake: bigint("total_stake", { mode: "bigint" }).notNull(),
    payoutAmount: bigint("payout_amount", { mode: "bigint" }).notNull(),
    multiplier: doublePrecision("multiplier").notNull(),
    houseEdge: doublePrecision("house_edge").notNull(),
    maxMultiplier: doublePrecision("max_multiplier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("lucky_7_rounds_user_id_idx").on(t.userId),
    index("lucky_7_rounds_created_at_idx").on(t.createdAt),
  ],
);

export type Lucky7Round = typeof lucky7RoundsTable.$inferSelect;

// NOTE: there is deliberately no `lucky_7_user_seeds` table. Unlike the
// per-request games (dice/plinko/mines), Lucky 7 is a shared server-scheduled
// round: the committed seed tuple lives on the round itself (`table_rounds`)
// and is copied here at settlement, so a per-user seed would have no influence
// on the roll.
