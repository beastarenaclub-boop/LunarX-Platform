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
 * One roulette spin = one bets-table row (aggregate stake) + one audit row
 * here. `bets` stores the individual chips placed on the layout with their
 * per-bet payouts so verification/history can rebuild the exact table state.
 */
export const rouletteRoundsTable = pgTable(
  "roulette_rounds",
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
    /** Winning pocket 0..36. */
    pocket: integer("pocket").notNull(),
    /**
     * Chips placed: [{ type, numbers?, selection?, amountPaise, payoutPaise }]
     * — amounts serialized as strings for bigint safety.
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
    index("roulette_rounds_user_id_idx").on(t.userId),
    index("roulette_rounds_created_at_idx").on(t.createdAt),
  ],
);

export type RouletteRound = typeof rouletteRoundsTable.$inferSelect;

export const rouletteUserSeedsTable = pgTable("roulette_user_seeds", {
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

export type RouletteUserSeed = typeof rouletteUserSeedsTable.$inferSelect;
