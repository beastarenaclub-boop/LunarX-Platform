import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  bigint,
  jsonb,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { betsTable } from "./bets";

/**
 * One blackjack round = a stateful multi-request hand. Money is tracked as
 * separate bets-table rows per wager component (main hand, split hand,
 * per-hand double, insurance) so every wallet movement stays auditable via
 * the shared bets service. The full action log + seeds let the verifier
 * replay the entire round deterministically from the provably-fair shoe.
 *
 * status: 'insurance' (awaiting insurance decision) | 'active' (player turn)
 *       | 'settling' (dealer done + results persisted, wallet settlement in
 *         progress/retryable) | 'settled'.
 */
export const blackjackRoundsTable = pgTable(
  "blackjack_rounds",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    /** Main-hand bet row (always present). */
    betId: text("bet_id")
      .notNull()
      .unique()
      .references(() => betsTable.id, { onDelete: "restrict" }),
    /** Split-hand bet row (present only after a split). */
    splitBetId: text("split_bet_id").references(() => betsTable.id, {
      onDelete: "restrict",
    }),
    /** Double-down bet rows (same stake again), per hand. */
    doubleMainBetId: text("double_main_bet_id").references(() => betsTable.id, {
      onDelete: "restrict",
    }),
    doubleSplitBetId: text("double_split_bet_id").references(
      () => betsTable.id,
      { onDelete: "restrict" },
    ),
    /** Insurance bet row (half the base stake, rounded up). */
    insuranceBetId: text("insurance_bet_id").references(() => betsTable.id, {
      onDelete: "restrict",
    }),
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    clientSeed: text("client_seed").notNull(),
    nonce: bigint("nonce", { mode: "number" }).notNull(),
    status: text("status").notNull(),
    payoutVersion: integer("payout_version").notNull().default(2),
    /** Base stake per hand in paise. */
    stakeAmount: bigint("stake_amount", { mode: "bigint" }).notNull(),
    /**
     * Player hands: [{ cards: number[], stood, doubled, busted, fromSplit }]
     * — cards are shoe card ids (0..311 for 6 decks).
     */
    hands: jsonb("hands").notNull(),
    /** Index of the hand currently acting (0 or 1). */
    activeHand: integer("active_hand").notNull().default(0),
    /** Dealer cards incl. hole card (hidden from the client until reveal). */
    dealerCards: jsonb("dealer_cards").notNull(),
    /** Cards consumed from the shoe so far. */
    drawnCount: integer("drawn_count").notNull(),
    /** null | 'offered' | 'taken' | 'declined' */
    insurance: text("insurance"),
    /** Ordered action log for provably-fair replay, e.g. ["deal","hit:0",...]. */
    actions: jsonb("actions").notNull(),
    /** Settlement summary written at dealer-done time (before wallet moves). */
    results: jsonb("results"),
    totalStake: bigint("total_stake", { mode: "bigint" }).notNull(),
    payoutAmount: bigint("payout_amount", { mode: "bigint" }).notNull(),
    maxMultiplier: doublePrecision("max_multiplier").notNull(),
    /** Optimistic-locking version stamp; bumped on every mutation. */
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActionAt: timestamp("last_action_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("blackjack_rounds_user_id_idx").on(t.userId),
    index("blackjack_rounds_created_at_idx").on(t.createdAt),
    // At most one unsettled round per player.
    uniqueIndex("blackjack_rounds_active_per_user_idx")
      .on(t.userId)
      .where(sql`${t.status} <> 'settled'`),
  ],
);

export type BlackjackRound = typeof blackjackRoundsTable.$inferSelect;

export const blackjackUserSeedsTable = pgTable("blackjack_user_seeds", {
  userId: text("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  serverSeed: text("server_seed").notNull(),
  serverSeedHash: text("server_seed_hash").notNull(),
  clientSeed: text("client_seed").notNull(),
  nextNonce: bigint("next_nonce", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BlackjackUserSeed = typeof blackjackUserSeedsTable.$inferSelect;
