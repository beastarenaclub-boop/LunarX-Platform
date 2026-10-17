import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  bigint,
  index,
  uniqueIndex,
  jsonb,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { usersTable } from "./users";
import { partnersTable } from "./partners";

export const betStatusEnum = pgEnum("bet_status", [
  "placed",
  "won",
  "lost",
  "voided",
  "cashed_out",
]);

export const betsTable = pgTable(
  "bets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    gameCode: text("game_code").notNull(),
    roundId: text("round_id"),
    stakeAmount: bigint("stake_amount", { mode: "bigint" }).notNull(),
    payoutAmount: bigint("payout_amount", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    multiplier: doublePrecision("multiplier"),
    status: betStatusEnum("status").notNull().default("placed"),
    metadata: jsonb("metadata"),
    placedAt: timestamp("placed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    partnerId: text("partner_id").references(() => partnersTable.id, {
      onDelete: "set null",
    }),
    partnerBetId: text("partner_bet_id"),
    partnerPlayerRef: text("partner_player_ref"),
  },
  (t) => [
    index("bets_user_id_idx").on(t.userId),
    index("bets_game_code_idx").on(t.gameCode),
    index("bets_status_idx").on(t.status),
    index("bets_placed_at_idx").on(t.placedAt),
    index("bets_partner_id_idx").on(t.partnerId),
    // DB-enforced idempotency: a partner can supply the same partnerBetId only
    // once. Partial unique so legacy non-partner bets are unaffected.
    uniqueIndex("bets_partner_bet_id_unique_idx")
      .on(t.partnerId, t.partnerBetId)
      .where(sql`${t.partnerId} IS NOT NULL AND ${t.partnerBetId} IS NOT NULL`),
  ],
);

export type Bet = typeof betsTable.$inferSelect;
export type BetStatus = (typeof betStatusEnum.enumValues)[number];
