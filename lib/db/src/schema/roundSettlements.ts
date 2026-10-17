import {
  pgTable,
  text,
  timestamp,
  bigint,
  doublePrecision,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

// One row per settled round under the pari-mutuel split. The round id is the
// game-supplied roundId (the same string the bets carry on bets.round_id).
// We keep this independent from the existing `game_rounds` table because
// in-house lunar rounds are client-driven and don't always have a row there;
// `round_settlements` is the authoritative record for "who got what" under
// the 95/5 model regardless of whether `game_rounds` has a matching row.
export const roundSettlementsTable = pgTable(
  "round_settlements",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    roundId: text("round_id").notNull(),
    gameCode: text("game_code").notNull(),
    // Total stake across every bet in the round (winners + losers).
    totalPool: bigint("total_pool", { mode: "bigint" }).notNull(),
    // Amount distributed to winning players (95% of pool).
    playerPool: bigint("player_pool", { mode: "bigint" }).notNull(),
    // Amount kept by the house (5% of pool, plus any rounding remainder).
    companyProfit: bigint("company_profit", { mode: "bigint" }).notNull(),
    // Counts derived from entries — denormalised so the admin list view
    // doesn't need a JOIN to render winner/loser totals per row.
    winnerCount: integer("winner_count").notNull().default(0),
    loserCount: integer("loser_count").notNull().default(0),
    settledAt: timestamp("settled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Idempotency guard: only one settlement per round per game.
    uniqueIndex("round_settlements_round_game_unique_idx").on(
      t.roundId,
      t.gameCode,
    ),
    index("round_settlements_settled_at_idx").on(t.settledAt),
    index("round_settlements_game_code_idx").on(t.gameCode),
  ],
);

export type RoundSettlement = typeof roundSettlementsTable.$inferSelect;

// One row per participating player in a round. Captures the per-player split
// for the admin row-expand view and any future audit/dispute work.
export const roundSettlementEntriesTable = pgTable(
  "round_settlement_entries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    settlementId: text("settlement_id")
      .notNull()
      .references(() => roundSettlementsTable.id, { onDelete: "cascade" }),
    roundId: text("round_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    betId: text("bet_id").notNull(),
    stake: bigint("stake", { mode: "bigint" }).notNull(),
    // null when the player busted (did not cash out before crash).
    cashoutMultiplier: doublePrecision("cashout_multiplier"),
    payout: bigint("payout", { mode: "bigint" }).notNull(),
    // Signed: payout - stake. Stored for cheap admin reads.
    profit: bigint("profit", { mode: "bigint" }).notNull(),
  },
  (t) => [
    index("rse_settlement_id_idx").on(t.settlementId),
    index("rse_round_id_idx").on(t.roundId),
    index("rse_user_id_idx").on(t.userId),
    uniqueIndex("rse_bet_id_unique_idx").on(t.betId),
  ],
);

export type RoundSettlementEntry = typeof roundSettlementEntriesTable.$inferSelect;

// Append-only company-profit ledger: one row per settled round, plus a
// running balance for the lifetime company-profit accumulator. Mirrors the
// shape of `wallet_ledger` but lives in its own table because the company
// is not a user (the wallet ledger schema requires a real user_id reference).
// All rows are written inside the same transaction as the matching round
// settlement so the ledger and the round split are atomically consistent.
export const companyProfitLedgerTable = pgTable(
  "company_profit_ledger",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    settlementId: text("settlement_id")
      .notNull()
      .references(() => roundSettlementsTable.id, { onDelete: "cascade" }),
    gameCode: text("game_code").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("cpl_settlement_unique_idx").on(t.settlementId),
    index("cpl_game_code_idx").on(t.gameCode),
    index("cpl_created_at_idx").on(t.createdAt),
  ],
);

export type CompanyProfitLedgerEntry =
  typeof companyProfitLedgerTable.$inferSelect;
