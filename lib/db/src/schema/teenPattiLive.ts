import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  bigint,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { betsTable } from "./bets";

/**
 * Teen Patti 20-20 LIVE — the 3D live-dealer table. Same maths as the flat
 * Teen Patti game (shared ranking + settlement helpers), but a completely
 * separate game: its own wallet scope, its own round clock and its own
 * history, so the two tables can never contaminate each other's audit trail.
 *
 * One settled deal per player = one bets-table row (aggregate stake) + one
 * audit row here. `bets` stores the individual bets (playerA/playerB/tie/
 * pairPlusA/pairPlusB) with per-bet payouts; both hands' cards are stored so
 * verification/history can replay the exact deal from the provably-fair
 * single-deck shuffle.
 *
 * NOTE: there is deliberately no `teen_patti_live_user_seeds` table. This is a
 * shared server-scheduled round — one deal serves the whole table — so the
 * committed seed tuple lives on the round itself (`table_rounds`) and is
 * copied here at settlement. A per-user seed could not influence it.
 */
export const teenPattiLiveRoundsTable = pgTable(
  "teen_patti_live_rounds",
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
    /** Three card ids (0..51) per hand, in deal order. */
    handACards: jsonb("hand_a_cards").notNull(),
    handBCards: jsonb("hand_b_cards").notNull(),
    /** Hand category: 'highCard'|'pair'|'color'|'sequence'|'pureSequence'|'trail' */
    handACategory: text("hand_a_category").notNull(),
    handBCategory: text("hand_b_category").notNull(),
    /** 'playerA' | 'playerB' | 'tie' */
    winner: text("winner").notNull(),
    /**
     * Bets placed: [{ type, amountPaise, payoutPaise, didWin }] — amounts
     * serialized as strings for bigint safety.
     */
    bets: jsonb("bets").notNull(),
    totalStake: bigint("total_stake", { mode: "bigint" }).notNull(),
    payoutAmount: bigint("payout_amount", { mode: "bigint" }).notNull(),
    multiplier: doublePrecision("multiplier").notNull(),
    maxMultiplier: doublePrecision("max_multiplier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("teen_patti_live_rounds_user_id_idx").on(t.userId),
    index("teen_patti_live_rounds_created_at_idx").on(t.createdAt),
  ],
);

export type TeenPattiLiveRound = typeof teenPattiLiveRoundsTable.$inferSelect;
