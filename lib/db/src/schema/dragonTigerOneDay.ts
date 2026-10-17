import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  bigint,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
export const dragonTigerOneDayRounds = pgTable("dragon_tiger_one_day_rounds", {
  id: serial("id").primaryKey(),
  dragon: integer("dragon").notNull(),
  tiger: integer("tiger").notNull(),
  nonce: text("nonce").notNull(),
  commitment: text("commitment").notNull(),
  firstClosesAt: timestamp("first_closes_at", { withTimezone: true }).notNull(),
  secondOpensAt: timestamp("second_opens_at", { withTimezone: true }).notNull(),
  secondClosesAt: timestamp("second_closes_at", {
    withTimezone: true,
  }).notNull(),
  revealsAt: timestamp("reveals_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});
export const dragonTigerOneDayBets = pgTable(
  "dragon_tiger_one_day_bets",
  {
    id: serial("id").primaryKey(),
    roundId: integer("round_id")
      .notNull()
      .references(() => dragonTigerOneDayRounds.id),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    stage: text("stage").$type<"first" | "second">().notNull(),
    selections: jsonb("selections")
      .$type<
        { market: string; amountPaise: string; oddsHundredths: number }[]
      >()
      .notNull(),
    stakePaise: bigint("stake_paise", { mode: "bigint" }).notNull(),
    payoutPaise: bigint("payout_paise", { mode: "bigint" }),
  },
  (t) => [
    uniqueIndex("dt_one_day_round_user_stage").on(t.roundId, t.userId, t.stage),
    index("dt_one_day_user_bets").on(t.userId, t.id),
  ],
);
