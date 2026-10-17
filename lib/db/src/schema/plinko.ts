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
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { betsTable } from "./bets";

export const plinkoRiskEnum = pgEnum("plinko_risk", ["low", "medium", "high"]);

export const plinkoRoundsTable = pgTable(
  "plinko_rounds",
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
    rows: integer("rows").notNull(),
    risk: plinkoRiskEnum("risk").notNull(),
    // Sequence of "L"/"R" choices, length === rows.
    path: jsonb("path").notNull(),
    bucket: integer("bucket").notNull(),
    multiplier: doublePrecision("multiplier").notNull(),
    payoutAmount: bigint("payout_amount", { mode: "bigint" }).notNull(),
    // Per-round config snapshot for stable historical verification.
    houseEdge: doublePrecision("house_edge").notNull(),
    maxMultiplier: doublePrecision("max_multiplier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("plinko_rounds_user_id_idx").on(t.userId),
    index("plinko_rounds_created_at_idx").on(t.createdAt),
  ],
);

export type PlinkoRound = typeof plinkoRoundsTable.$inferSelect;
export type PlinkoRisk = (typeof plinkoRiskEnum.enumValues)[number];

// Per-user active server seed for true precommit/reveal fairness. The hash
// of `serverSeed` is exposed (GET /api/plinko/seed) BEFORE any drop; the
// raw seed is only revealed on rotation (POST /api/plinko/seed/rotate),
// which atomically replaces it with a fresh seed. `nextNonce` increments
// per drop so each round derives from a unique (seed, nonce) pair.
export const plinkoUserSeedsTable = pgTable("plinko_user_seeds", {
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

export type PlinkoUserSeed = typeof plinkoUserSeedsTable.$inferSelect;
