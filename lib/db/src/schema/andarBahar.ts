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
 * One Andar Bahar round = one bets-table row (aggregate stake) + one audit
 * row here. `bets` stores the individual bets (andar/bahar/range side bets)
 * with per-bet payouts; the joker + dealt cards are stored so verification
 * and history can replay the exact round from the provably-fair single-deck
 * shuffle.
 */
export const andarBaharRoundsTable = pgTable(
  "andar_bahar_rounds",
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
    /** Joker (game card) as deck card id 0..51. */
    joker: integer("joker").notNull(),
    /** Cards dealt to each side (deck card ids), in deal order. */
    andarCards: jsonb("andar_cards").notNull(),
    baharCards: jsonb("bahar_cards").notNull(),
    /** Side dealt first ('andar' | 'bahar') — pays 0.9:1. */
    firstSide: text("first_side").notNull(),
    /** 'andar' | 'bahar' — side that received the matching card. */
    winner: text("winner").notNull(),
    /** Total cards dealt after the joker, including the match (1..49). */
    cardsDealt: integer("cards_dealt").notNull(),
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
    index("andar_bahar_rounds_user_id_idx").on(t.userId),
    index("andar_bahar_rounds_created_at_idx").on(t.createdAt),
  ],
);

export type AndarBaharRound = typeof andarBaharRoundsTable.$inferSelect;

export const andarBaharUserSeedsTable = pgTable("andar_bahar_user_seeds", {
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

export type AndarBaharUserSeed = typeof andarBaharUserSeedsTable.$inferSelect;
