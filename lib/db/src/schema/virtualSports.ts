import { bigint, boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { usersTable } from "./users";
import type { SportId } from "../../../virtual-sports/catalog.mjs";
import type { MatchFixture } from "../../../virtual-sports/fixtures.mjs";
import type { MatchEvent } from "../../../virtual-sports/store.mjs";

export const virtualSportsRoundsTable = pgTable("virtual_sports_rounds", {
  id: text("id").primaryKey(), sport: text("sport").$type<SportId>().notNull(),
  starts: bigint("starts", { mode: "number" }).notNull(),
  data: jsonb("data").$type<{ fixture: MatchFixture; winner: number; score: number[]; events: MatchEvent[]; odds: number[] }>().notNull(),
  settled: boolean("settled").notNull().default(false),
}, t => [index("sports_round_starts_idx").on(t.starts), index("sports_unsettled_idx").on(t.settled, t.starts)]);

export const virtualSportsBetsTable = pgTable("virtual_sports_bets", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id").notNull().references(() => usersTable.id), requestId: text("request_id").notNull(),
  roundId: text("round_id").notNull().references(() => virtualSportsRoundsTable.id),
  sport: text("sport").$type<SportId>().notNull(), choice: integer("choice").notNull(),
  amount: integer("amount").notNull(), // paise
  oddsHundredths: integer("odds_hundredths").notNull(), payout: integer("payout").notNull().default(0), // paise
  status: text("status").$type<"pending" | "won" | "lost">().notNull().default("pending"),
  created: bigint("created", { mode: "number" }).notNull(),
}, t => [
  uniqueIndex("sports_user_request_idx").on(t.userId, t.requestId), index("sports_user_bets_idx").on(t.userId, t.created),
  index("sports_round_bets_idx").on(t.roundId, t.status),
  check("sports_amount_check", sql`${t.amount} between 1000 and 500000 and ${t.amount} % 100 = 0`),
  check("sports_payout_check", sql`${t.payout} >= 0`), check("sports_status_check", sql`${t.status} in ('pending', 'won', 'lost')`),
  check("sports_choice_check", sql`${t.choice} between 0 and 3`), check("sports_odds_check", sql`${t.oddsHundredths} >= 100`),
]);
