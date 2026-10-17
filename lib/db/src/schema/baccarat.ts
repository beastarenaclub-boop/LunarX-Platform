import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  bigint,
  jsonb,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { betsTable } from "./bets";

/**
 * One baccarat deal = one bets-table row (aggregate stake) + one audit row
 * here. `bets` stores the individual bets (player/banker/tie/pairs) with
 * per-bet payouts; the dealt cards are stored so verification/history can
 * replay the exact hand from the provably-fair shoe.
 */
export const baccaratRoundsTable = pgTable(
  "baccarat_rounds",
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
    /** Cards drawn from the shoe, as shoe card ids (0..415). */
    playerCards: jsonb("player_cards").notNull(),
    bankerCards: jsonb("banker_cards").notNull(),
    playerTotal: integer("player_total").notNull(),
    bankerTotal: integer("banker_total").notNull(),
    /** 'player' | 'banker' | 'tie' */
    winner: text("winner").notNull(),
    playerPair: boolean("player_pair").notNull(),
    bankerPair: boolean("banker_pair").notNull(),
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
    index("baccarat_rounds_user_id_idx").on(t.userId),
    index("baccarat_rounds_created_at_idx").on(t.createdAt),
  ],
);

export type BaccaratRound = typeof baccaratRoundsTable.$inferSelect;

export const baccaratUserSeedsTable = pgTable("baccarat_user_seeds", {
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

export type BaccaratUserSeed = typeof baccaratUserSeedsTable.$inferSelect;
