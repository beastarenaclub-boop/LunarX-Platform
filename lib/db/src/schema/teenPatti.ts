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
 * One Teen Patti 20/20 deal = one bets-table row (aggregate stake) + one
 * audit row here. `bets` stores the individual bets (playerA/playerB/tie/
 * pairPlusA/pairPlusB) with per-bet payouts; the dealt cards are stored so
 * verification/history can replay the exact hands from the provably-fair
 * single-deck shuffle.
 */
export const teenPattiRoundsTable = pgTable(
  "teen_patti_rounds",
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
    index("teen_patti_rounds_user_id_idx").on(t.userId),
    index("teen_patti_rounds_created_at_idx").on(t.createdAt),
  ],
);

export type TeenPattiRound = typeof teenPattiRoundsTable.$inferSelect;

export const teenPattiUserSeedsTable = pgTable("teen_patti_user_seeds", {
  userId: text("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  serverSeed: text("server_seed").notNull(),
  serverSeedHash: text("server_seed_hash").notNull(),
  clientSeed: text("client_seed").notNull(),
  nextNonce: integer("next_nonce").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type TeenPattiUserSeed = typeof teenPattiUserSeedsTable.$inferSelect;
