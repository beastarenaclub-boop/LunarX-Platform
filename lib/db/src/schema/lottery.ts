import { bigint, check, foreignKey, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { betsTable } from "./bets";

export type LotteryGame = "2D" | "3D" | "Titli";
export type LotterySettings = {
  brand: string; interval: number; unitPrice: number; seriesPrices: Record<string, number>;
  maxTicket: number; payouts: Record<LotteryGame, number>; salesEnabled: boolean; timezone: string;
};
export type LotteryLine = { series: string; number: string; quantity: number; unitPrice: number };
export type LotteryResults = Record<string, Record<LotteryGame, string>>;
export const lotterySettingsTable = pgTable("lottery_settings", {
  id: integer("id").primaryKey(),
  version: integer("version").notNull().default(1),
  value: jsonb("value").$type<LotterySettings>().notNull(),
}, t => [check("lottery_settings_id_check", sql`${t.id} = 1`)]);
export const lotteryDrawsTable = pgTable("lottery_draws", {
  id: text("id").primaryKey(),
  closes: bigint("closes", { mode: "number" }).notNull(),
  ends: bigint("ends", { mode: "number" }).notNull(),
  status: text("status").notNull().default("open"),
  seed: text("seed").notNull(),
  commitment: text("commitment").notNull(),
  results: jsonb("results").$type<LotteryResults>(),
  config: jsonb("config").$type<LotterySettings>().notNull(),
}, t => [index("lottery_draw_time_idx").on(t.ends),
  index("lottery_open_draw_idx").on(t.ends).where(sql`${t.status} = 'open'`),
  check("lottery_draws_status_check", sql`${t.status} in ('open', 'settled')`)]);
export const lotteryTicketsTable = pgTable("lottery_tickets", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  betId: text("bet_id").notNull(),
  drawId: text("draw_id").notNull(),
  game: text("game").$type<LotteryGame>().notNull(),
  lines: jsonb("lines").$type<LotteryLine[]>().notNull(),
  stake: bigint("stake", { mode: "bigint" }).notNull(),
  payout: bigint("payout", { mode: "bigint" }).notNull().default(sql`0`),
  status: text("status").notNull().default("pending"),
  request: text("request").notNull(),
  requestHash: text("request_hash").notNull(),
  created: bigint("created", { mode: "number" }).notNull(),
  claimed: bigint("claimed", { mode: "number" }),
}, t => [foreignKey({ name: "lottery_tickets_user_id_fkey", columns: [t.userId], foreignColumns: [usersTable.id] }),
  foreignKey({ name: "lottery_tickets_bet_id_fkey", columns: [t.betId], foreignColumns: [betsTable.id] }),
  foreignKey({ name: "lottery_tickets_draw_id_fkey", columns: [t.drawId], foreignColumns: [lotteryDrawsTable.id] }),
  uniqueIndex("lottery_user_request_idx").on(t.userId, t.request),
  uniqueIndex("lottery_ticket_bet_idx").on(t.betId),
  index("lottery_user_ticket_idx").on(t.userId, t.created),
  index("lottery_draw_ticket_idx").on(t.drawId, t.status),
  check("lottery_ticket_amounts", sql`${t.stake} > 0 and ${t.payout} >= 0`),
  check("lottery_tickets_game_check", sql`${t.game} in ('2D', '3D', 'Titli')`),
  check("lottery_tickets_status_check", sql`${t.status} in ('pending', 'claimed', 'lost', 'cancelled')`)]);
