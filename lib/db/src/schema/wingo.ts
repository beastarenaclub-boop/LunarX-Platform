import { bigint, boolean, check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

// Results and wallet-funded bets live in the same database as the shared ledger.
export const wingoRoundsTable = pgTable("wingo_rounds", {
  period: text("period").primaryKey(),
  duration: integer("duration").notNull(),
  start: bigint("start", { mode: "number" }).notNull(),
  ends: bigint("ends", { mode: "number" }).notNull(),
  number: integer("number").notNull(),
  payoutVersion: integer("payout_version").notNull().default(2),
  secret: text("secret").notNull(),
  commitment: text("commitment").notNull(),
  settled: boolean("settled").notNull().default(false),
}, (t) => [
  index("wingo_round_time_idx").on(t.duration, t.ends),
  index("wingo_unsettled_idx").on(t.ends).where(sql`${t.settled} = false`),
  check("wingo_number_check", sql`${t.number} between 0 and 9`),
]);

export const wingoBetsTable = pgTable("wingo_bets", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  userId: text("user_id").notNull().references(() => usersTable.id),
  period: text("period").notNull().references(() => wingoRoundsTable.period),
  pick: text("pick").notNull(),
  stake: integer("stake").notNull(), // paise
  payout: integer("payout"), // paise; null until settled
  created: bigint("created", { mode: "number" }).notNull(),
  request: text("request").notNull(),
}, (t) => [
  uniqueIndex("wingo_user_request_idx").on(t.userId, t.request),
  index("wingo_user_bets_idx").on(t.userId, t.created),
  index("wingo_bet_round_idx").on(t.period),
  check("wingo_stake_check", sql`${t.stake} between 100 and 1000000 and ${t.stake} % 100 = 0`),
  check("wingo_payout_check", sql`${t.payout} >= 0`),
]);
