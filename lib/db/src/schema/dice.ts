import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  bigint,
  boolean,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { betsTable } from "./bets";

export const diceDirectionEnum = pgEnum("dice_direction", ["over", "under"]);

export const diceRoundsTable = pgTable(
  "dice_rounds",
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
    target: doublePrecision("target").notNull(),
    direction: diceDirectionEnum("direction").notNull(),
    roll: doublePrecision("roll").notNull(),
    didWin: boolean("did_win").notNull(),
    multiplier: doublePrecision("multiplier").notNull(),
    payoutAmount: bigint("payout_amount", { mode: "bigint" }).notNull(),
    houseEdge: doublePrecision("house_edge").notNull(),
    maxMultiplier: doublePrecision("max_multiplier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("dice_rounds_user_id_idx").on(t.userId),
    index("dice_rounds_created_at_idx").on(t.createdAt),
  ],
);

export type DiceRound = typeof diceRoundsTable.$inferSelect;
export type DiceDirection = (typeof diceDirectionEnum.enumValues)[number];

export const diceUserSeedsTable = pgTable("dice_user_seeds", {
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

export type DiceUserSeed = typeof diceUserSeedsTable.$inferSelect;
