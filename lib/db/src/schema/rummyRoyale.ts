import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  bigint,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { betsTable } from "./bets";

export const rummyRoundStatusEnum = pgEnum("rummy_round_status", [
  "active",
  "won",
  "lost",
  "drawn",
]);

/**
 * One Rummy Royale round = one bets-table row (the entry) + this row, which is
 * BOTH the live table and, once settled, the audit record. The player against
 * three computer seats, so the table state is private to one user and the
 * round settles when the player declares, a computer seat declares, the stock
 * runs out or the turn cap is reached.
 *
 * `state` holds every hand and the stock: it is never sent to the client as
 * is (see `publicState` in the service). The seed tuple is the honest deal's;
 * `deal` is what was actually dealt, which under a steering mode may be a
 * different candidate (`result_source` says which) — like the tables, this
 * game publishes no seed and is not provably fair.
 */
export const rummyRoundsTable = pgTable(
  "rummy_rounds",
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
    /** The engine stream this round was decided on (`rummy` or `rummy#<partner>`). */
    streamKey: text("stream_key").notNull(),
    stakePaise: bigint("stake_paise", { mode: "bigint" }).notNull(),
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    clientSeed: text("client_seed").notNull(),
    nonce: bigint("nonce", { mode: "number" }).notNull(),
    /** `{ deck: string[106], opener: 0..3 }` — what was dealt. */
    deal: jsonb("deal").notNull(),
    /** "drawn" | "strategy" | "admin" — how the deal was chosen. */
    resultSource: text("result_source").notNull(),
    /** The class the engine filed the deal under ("you" / "computer" / "draw"). */
    predictedClass: text("predicted_class"),
    /** The private table (rules.ts `TableState`). */
    state: jsonb("state").notNull(),
    status: rummyRoundStatusEnum("status").notNull().default("active"),
    /** When the player's current turn is auto-played if they have not acted. */
    turnDeadline: timestamp("turn_deadline", { withTimezone: true }),
    /** Settled: the winning seat (0 = player), or null for a drawn table. */
    winner: integer("winner"),
    reason: text("reason"),
    /** Unmatched points per seat at the end, in seat order. */
    points: jsonb("points"),
    payoutAmount: bigint("payout_amount", { mode: "bigint" }),
    multiplier: doublePrecision("multiplier"),
    // Pinned per round so a later edge/cap edit never reprices history.
    houseEdge: doublePrecision("house_edge").notNull(),
    maxMultiplier: doublePrecision("max_multiplier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("rummy_rounds_user_id_idx").on(t.userId),
    index("rummy_rounds_created_at_idx").on(t.createdAt),
    // One live table per player, guaranteed by Postgres under concurrent
    // /deal requests (mines' shape): the loser sees a unique violation.
    uniqueIndex("rummy_rounds_one_active_per_user_idx")
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export type RummyRound = typeof rummyRoundsTable.$inferSelect;
export type RummyRoundStatus = (typeof rummyRoundStatusEnum.enumValues)[number];
