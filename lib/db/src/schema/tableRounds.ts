import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  bigint,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";

/**
 * Shared, server-scheduled rounds for the table games (roulette, baccarat,
 * blackjack, teen-patti, andar-bahar). One row per round per game; every
 * player bets into the same round on a fixed clock:
 *
 *   betting → reveal → settling → settled   (or → voided on unsafe recovery)
 *
 * Phase deadlines are persisted as absolute timestamps so a restarted server
 * (and any client joining mid-round) can compute the remaining time.
 * The provably-fair server seed is committed via its hash at round creation
 * (broadcast to all players BEFORE any outcome exists) and revealed at the
 * reveal phase.
 */
export const tableRoundsTable = pgTable(
  "table_rounds",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    gameCode: text("game_code").notNull(),
    phase: text("phase").notNull().default("betting"), // betting|reveal|settling|settled|voided
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    clientSeed: text("client_seed").notNull(),
    nonce: bigint("nonce", { mode: "number" }).notNull().default(sql`0`),
    bettingEndsAt: timestamp("betting_ends_at", { withTimezone: true }).notNull(),
    revealEndsAt: timestamp("reveal_ends_at", { withTimezone: true }).notNull(),
    settleEndsAt: timestamp("settle_ends_at", { withTimezone: true }).notNull(),
    /** Game-specific outcome (pocket / tableau / joker run …); null until reveal. */
    outcome: jsonb("outcome"),
    /**
     * Snapshot of the game config THIS round was created with (houseEdge,
     * maxMultiplier, min/max stake, phase durations). Admin edits only apply
     * from the NEXT round, and verification of old rounds stays stable.
     */
    config: jsonb("config").notNull(),
    totalStake: bigint("total_stake", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    totalPayout: bigint("total_payout", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    playerCount: bigint("player_count", { mode: "number" })
      .notNull()
      .default(sql`0`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("table_rounds_game_code_idx").on(t.gameCode),
    index("table_rounds_phase_idx").on(t.phase),
    index("table_rounds_created_at_idx").on(t.createdAt),
  ],
);

export type TableRound = typeof tableRoundsTable.$inferSelect;

/**
 * One row per player wager slip in a table round. `bets` holds the raw
 * game-specific bet inputs (amounts as decimal strings); the linked
 * `bet_id` row in `bets` carries the wallet debit. At settlement the row
 * flips pending → settled (or refunded on void) and `audit_round_id` points
 * at the per-game provably-fair audit row (roulette_rounds/baccarat_rounds/
 * teen_patti_rounds/andar_bahar_rounds/blackjack_rounds) that keeps the
 * existing /:id and /:id/verify endpoints working.
 */
export const tableRoundBetsTable = pgTable(
  "table_round_bets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    roundId: text("round_id")
      .notNull()
      .references(() => tableRoundsTable.id, { onDelete: "cascade" }),
    gameCode: text("game_code").notNull(),
    userId: text("user_id").notNull(),
    betId: text("bet_id").notNull(),
    bets: jsonb("bets").notNull(),
    totalStake: bigint("total_stake", { mode: "bigint" }).notNull(),
    payoutAmount: bigint("payout_amount", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    status: text("status").notNull().default("pending"), // pending|settled|refunded
    auditRoundId: text("audit_round_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("table_round_bets_round_id_idx").on(t.roundId),
    index("table_round_bets_user_id_idx").on(t.userId),
    index("table_round_bets_status_idx").on(t.status),
  ],
);

export type TableRoundBet = typeof tableRoundBetsTable.$inferSelect;
