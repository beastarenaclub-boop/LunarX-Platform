import { bigint, check, doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import type { Candle, RoundResult, Side, Trade } from "../../../forex/store.mjs";

export interface ForexMarketState {
  economicsVersion?: number;
  outcomeSeed?: string;
  roundId: number;
  start: number;
  assets: Record<string, { open: number; candles: Candle[] }>;
  results: RoundResult[];
}

// Market state, funded trades and the shared ledger commit in one PostgreSQL transaction.
export const forexMarketTable = pgTable("forex_market", {
  id: integer("id").primaryKey(),
  data: jsonb("data").$type<ForexMarketState>().notNull(),
}, t => [check("forex_single_market", sql`${t.id} = 1`)]);

export const forexTradesTable = pgTable("forex_trades", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  userId: text("user_id").notNull().references(() => usersTable.id),
  requestId: text("request_id").notNull(),
  roundId: bigint("round_id", { mode: "number" }).notNull(),
  asset: text("asset").notNull(),
  side: text("side").$type<Side>().notNull(),
  amount: integer("amount").notNull(), // integer paise
  payout: integer("payout").notNull().default(0), // integer paise
  status: text("status").$type<Trade["status"]>().notNull().default("open"),
  opened: bigint("opened", { mode: "number" }).notNull(),
  settled: bigint("settled", { mode: "number" }),
  openPrice: doublePrecision("open_price").notNull(),
  closePrice: doublePrecision("close_price"),
}, t => [
  uniqueIndex("forex_user_request_idx").on(t.userId, t.requestId),
  index("forex_user_trades_idx").on(t.userId, t.opened),
  index("forex_round_trades_idx").on(t.roundId),
  check("forex_amount_check", sql`${t.amount} between 1000 and 500000 and ${t.amount} % 1000 = 0`),
  check("forex_payout_check", sql`${t.payout} >= 0`),
  check("forex_side_check", sql`${t.side} in ('buy', 'sell')`),
  check("forex_status_check", sql`${t.status} in ('open', 'won', 'lost', 'refund')`),
]);
