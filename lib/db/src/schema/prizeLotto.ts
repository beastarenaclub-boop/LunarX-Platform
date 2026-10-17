import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { betsTable } from "./bets";

// Structural types kept local so the database package does not depend on the API package.
type Settings = {
  rtp: number;
  intervalSeconds: number;
  maxTicket: number;
  maxLiability: number;
  salesEnabled: boolean;
};
type Reward =
  | "cashback"
  | "shopping"
  | "giftcard"
  | "travel"
  | "gadgets"
  | "dining"
  | "fuel"
  | "gold";
type Delivery = {
  merchant: string;
  code: string;
  instructions: string;
  expiresAt: string;
};
export const prizeSettingsTable = pgTable(
  "prize_settings",
  {
    id: integer("id").primaryKey(),
    version: integer("version").notNull().default(1),
    value: jsonb("value").$type<Settings>().notNull(),
  },
  (t) => [check("prize_settings_singleton", sql`${t.id} = 1`)],
);
export const prizeDrawsTable = pgTable(
  "prize_draws",
  {
    id: text("id").primaryKey(),
    closes: bigint("closes", { mode: "number" }).notNull(),
    ends: bigint("ends", { mode: "number" }).notNull(),
    seed: text("seed").notNull(),
    commitment: text("commitment").notNull(),
    status: text("status")
      .$type<"open" | "settled">()
      .notNull()
      .default("open"),
    result: text("result").$type<Reward | "none">(),
    config: jsonb("config").$type<Settings>().notNull(),
  },
  (t) => [
    index("prize_draw_end_idx").on(t.ends),
    check("prize_draw_status", sql`${t.status} in ('open','settled')`),
  ],
);
export const prizeTicketsTable = pgTable(
  "prize_tickets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    betId: text("bet_id")
      .notNull()
      .references(() => betsTable.id),
    drawId: text("draw_id")
      .notNull()
      .references(() => prizeDrawsTable.id),
    reward: text("reward").$type<Reward>().notNull(),
    stake: bigint("stake", { mode: "bigint" }).notNull(),
    prize: bigint("prize", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    status: text("status")
      .$type<"pending" | "won" | "lost" | "cancelled">()
      .notNull()
      .default("pending"),
    claimStatus: text("claim_status")
      .$type<"none" | "available" | "requested" | "fulfilled" | "credited">()
      .notNull()
      .default("none"),
    delivery: jsonb("delivery").$type<Delivery>(),
    request: text("request").notNull(),
    requestHash: text("request_hash").notNull(),
    created: bigint("created", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("prize_request_idx").on(t.userId, t.request),
    uniqueIndex("prize_bet_idx").on(t.betId),
    index("prize_user_idx").on(t.userId, t.created),
    index("prize_draw_ticket_idx").on(t.drawId, t.status),
    check("prize_amounts", sql`${t.stake} >= 10000 and ${t.prize} >= 0`),
    check(
      "prize_ticket_status",
      sql`${t.status} in ('pending','won','lost','cancelled')`,
    ),
    check(
      "prize_claim_status",
      sql`${t.claimStatus} in ('none','available','requested','fulfilled','credited')`,
    ),
    check(
      "prize_reward_check",
      sql`${t.reward} in ('cashback','shopping','giftcard','travel','gadgets','dining','fuel','gold')`,
    ),
  ],
);
