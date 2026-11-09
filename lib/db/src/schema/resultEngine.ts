import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  bigint,
  integer,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { partnersTable } from "./partners";

/**
 * The WINNER meter.
 *
 * NO MONEY IS HERE, and that is the whole design. Settlement already credited
 * the wallet; this row records only that the player has not yet acknowledged
 * the win, so the game screen can draw `Score = balance − uncollected` and hold
 * the amount in its own meter until TAKE. Writing a ledger entry on take would
 * pay the win a second time, and the way that is made impossible is that no
 * balance anywhere is derived from this table.
 *
 * Keyed per (player, game): a win held on the classic wheel must not freeze the
 * mini one.
 */
export const pendingWinsTable = pgTable(
  "pending_wins",
  {
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    gameCode: text("game_code").notNull(),
    /**
     * Reporting only. A launcher player and a local player are different
     * accounts, so the primary key does not need it — but a partner asking
     * "what is uncollected on my table" cannot answer from the user row alone.
     */
    partnerId: text("partner_id").references(() => partnersTable.id, {
      onDelete: "set null",
    }),
    // The default is a SQL literal, NOT `0n`: `drizzle-kit push` serialises its
    // snapshot with JSON.stringify, which throws on a BigInt and takes the
    // whole dev schema push down with it. Every other bigint default in this
    // schema is written the same way for the same reason.
    amountPaise: bigint("amount_paise", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    /**
     * The round the meter was last armed by. The client fetches that round's
     * whole layout — winners and losers both — to hold on the chart while the
     * win is uncollected.
     */
    roundId: text("round_id"),
    lastWonAt: timestamp("last_won_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * What the last TAKE took, and the key that took it.
     *
     * A repeat of the same key answers with that amount rather than 0 — the
     * press is reported before the drain animation finishes, so a lost response
     * is ordinary, and "there was nothing to collect" is a different and much
     * more alarming answer than "you already collected 420".
     */
    lastTakeAmountPaise: bigint("last_take_amount_paise", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    lastTakeKey: text("last_take_key"),
    lastTakenAt: timestamp("last_taken_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.gameCode] }),
    // PARTIAL. Auto-collection ages from the last WIN, so the only rows this
    // index is ever scanned for are the armed ones — and a row is kept after a
    // collection rather than deleted, so an unfiltered index would be mostly
    // dead weight that grows with every player who ever won.
    index("pending_wins_last_won_at_idx")
      .on(t.lastWonAt)
      .where(sql`${t.amountPaise} > 0`),
  ],
);

export type PendingWin = typeof pendingWinsTable.$inferSelect;

/**
 * The result engine's state for ONE STREAM.
 *
 * Keyed on the stream key — `roulette` for the shared local table,
 * `roulette#<partnerId>` for that partner's own — because that is already how
 * this codebase spells "which round does this player join"
 * (`lib/crashStream.ts`), and because per-stream is the only correct scope for
 * a bank: shared, one partner's players would steer another partner's wheel;
 * per-game, our margin and theirs would be mixed into one number.
 */
export const gameEngineConfigTable = pgTable(
  "game_engine_config",
  {
    streamKey: text("stream_key").primaryKey(),
    gameCode: text("game_code").notNull(),
    partnerId: text("partner_id").references(() => partnersTable.id, {
      onDelete: "cascade",
    }),
    /**
     * "random" | "collect" | "distribute" | "auto".
     *
     * Ships as "random" — a wheel nobody has configured draws uniformly, and a
     * row created lazily on first read must land in that state rather than in
     * whatever the last operator set on a different stream.
     */
    /**
     * `normal | collect | distribute | auto | rtp`. Ships as `normal`, in which the
     * engine steers nothing and the game draws its own result at its published
     * odds. Called `random` before 2026-09-05; readers still accept that name
     * because a decision's frozen `meta` snapshot keeps it for ever.
     */
    mode: text("mode").notNull().default("normal"),
    /** Merged over the shipped defaults on read; see `resultEngine/params.ts`. */
    params: jsonb("params"),
    bankPaise: bigint("bank_paise", { mode: "bigint" }).notNull().default(sql`0`),
    /**
     * The one HARD limit. A target never overrides it: no mode may choose a
     * pocket that would put the bank under this. When every pocket would, the
     * engine raises BANK_FLOOR_UNREACHABLE and takes the least bad one rather
     * than refusing to resolve — a stranded round is worse than a breached
     * floor.
     */
    minBankFloorPaise: bigint("min_bank_floor_paise", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    /**
     * Consecutive rounds that landed on a pocket nobody backed, and consecutive
     * giving rounds one account headlined.
     *
     * On the row rather than recomputed, because both are about CONSECUTIVE
     * rounds and the decision is made before the round they belong to has
     * settled — a query over settled rounds cannot see it.
     */
    zeroBetStreak: integer("zero_bet_streak").notNull().default(0),
    beneficiaryStreak: integer("beneficiary_streak").notNull().default(0),
    lastBeneficiaryUserId: text("last_beneficiary_user_id"),
    /** Newest first, capped; the anti-pattern check reads the last 20. */
    /**
     * The last outcome CLASSES this stream landed on, newest first, as choice
     * ids. Still called `recent_pockets` because it is the same column and a
     * rename would cost a migration for nothing; roulette writes "17" where it
     * used to write 17, and every other game writes its own class.
     */
    recentPockets: jsonb("recent_pockets"),
    updatedBy: text("updated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("game_engine_config_game_idx").on(t.gameCode)],
);

export type GameEngineConfig = typeof gameEngineConfigTable.$inferSelect;

/**
 * Every movement of a stream's bank, one row per round.
 *
 * The unique (roundId, type) is what makes settlement idempotent: a retried
 * settlement re-runs this insert, hits the constraint and moves nothing. Drop
 * it and a settlement that threw after the bank update counts the round twice
 * on the next recovery pass.
 */
export const gameBankLedgerTable = pgTable(
  "game_bank_ledger",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    streamKey: text("stream_key").notNull(),
    gameCode: text("game_code").notNull(),
    roundId: text("round_id").notNull(),
    /** "round_settle" today; a manual adjustment would be its own type. */
    type: text("type").notNull(),
    deltaPaise: bigint("delta_paise", { mode: "bigint" }).notNull(),
    balanceAfterPaise: bigint("balance_after_paise", {
      mode: "bigint",
    }).notNull(),
    totalStakesPaise: bigint("total_stakes_paise", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    totalPayoutsPaise: bigint("total_payouts_paise", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("game_bank_ledger_round_type_idx").on(t.roundId, t.type),
    index("game_bank_ledger_stream_created_idx").on(t.streamKey, t.createdAt.desc()),
  ],
);

export type GameBankLedgerRow = typeof gameBankLedgerTable.$inferSelect;

/**
 * Why a round landed where it did.
 *
 * EVERY round is recorded, the uniform ones included. "The engine was off that
 * day" is the exact claim this table exists to settle, and a table holding only
 * the steered rounds cannot settle it. Inserted ON CONFLICT DO NOTHING on the
 * round, so a retry never rewrites the original decision.
 */
export const roundDecisionTable = pgTable(
  "round_decision",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    roundId: text("round_id").notNull().unique(),
    streamKey: text("stream_key").notNull(),
    gameCode: text("game_code").notNull(),
    mode: text("mode").notNull(),
    /**
     * The pocket, for the two wheels only. NULL on every other game, which has
     * no such thing — a baccarat round lands on "banker", not on a number.
     * Kept beside `winningChoice` rather than replaced by it so every existing
     * reader of a roulette decision keeps working unchanged.
     */
    winningPocket: integer("winning_pocket"),
    /**
     * The outcome CLASS this round landed on, as the force dialog names it:
     * "17", "00", "banker", "andar". Present for every steerable game, and the
     * key the streak history is kept in.
     */
    winningChoice: text("winning_choice"),
    houseDeltaPaise: bigint("house_delta_paise", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    /**
     * The whole decision — candidates with their weights, the rng seed, the
     * reason, the alerts, the params in force, the bank before. A round replays
     * from this row alone, which is the only reason the seeded PRNG is seeded
     * rather than drawn from directly.
     */
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("round_decision_stream_created_idx").on(t.streamKey, t.createdAt.desc()),
  ],
);

export type RoundDecision = typeof roundDecisionTable.$inferSelect;

/**
 * ONE loss budget for a whole scope, or a floor per game (operator request,
 * 2026-09-23).
 *
 * `game_engine_config.min_bank_floor_paise` is the engine's hard limit per
 * STREAM, measured against that stream's own bank — so nine steerable games
 * run nine separate budgets and an operator typing the same figure on each is
 * really standing behind nine times it. This row is the scope-level answer:
 *
 *   per_game   every game keeps its own floor against its own bank. The
 *              shipped behaviour, and what an ABSENT row means — so a scope
 *              nobody has configured is untouched.
 *   same_each  one figure used as the floor for every game, each still
 *              measured against its own bank. Identical to per_game for the
 *              engine; it is the panel keeping the numbers in step.
 *   combined   one figure for the whole scope, measured against the SUM of
 *              its games' banks. The only mode that changes what the engine
 *              may choose.
 *
 * Keyed by SCOPE: a partner id, or the literal `local` for our own streams,
 * the vocabulary Game Control and the settings export already use. That
 * sentinel is why there is no foreign key — the column deliberately holds a
 * value that is not a partner id. A deleted partner leaves an inert row: it
 * is read only through that partner's own streams, which cascade away with
 * it.
 */
export const engineBankBudgetTable = pgTable("engine_bank_budget", {
  scope: text("scope").primaryKey(),
  /** `per_game | same_each | combined`. An unknown value reads as per_game. */
  mode: text("mode").notNull().default("per_game"),
  // A SQL literal, never `0n`: `drizzle-kit push` serialises its snapshot with
  // JSON.stringify, which throws on a BigInt and takes the dev schema push
  // down with it. Every bigint default in this file is written this way.
  floorPaise: bigint("floor_paise", { mode: "bigint" }).notNull().default(sql`0`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export type EngineBankBudget = typeof engineBankBudgetTable.$inferSelect;
