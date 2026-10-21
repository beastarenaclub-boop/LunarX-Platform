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
type PokerGame = "poker-one-day" | "poker-20-20" | "poker-six-players";
type PokerQuote = {
  id: string;
  label: string;
  player: number;
  kind: "back" | "lay" | "bonus2" | "bonus7" | "category";
  odds: number;
  category?: number;
};
type PokerAccepted = {
  market: string;
  amountPaise: string;
  quote: PokerQuote;
  debitPaise: string;
};
export const pokerRounds = pgTable(
  "poker_rounds",
  {
    id: serial("id").primaryKey(),
    game: text("game").$type<PokerGame>().notNull(),
    hands: jsonb("hands").$type<number[][]>().notNull(),
    board: jsonb("board").$type<number[]>().notNull(),
    nonce: text("nonce").notNull(),
    commitment: text("commitment").notNull(),
    quotes: jsonb("quotes").$type<PokerQuote[]>().notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    revealsAt: timestamp("reveals_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [index("poker_round_game").on(t.game, t.id)],
);
export const pokerBets = pgTable(
  "poker_bets",
  {
    id: serial("id").primaryKey(),
    roundId: integer("round_id")
      .notNull()
      .references(() => pokerRounds.id),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    requestId: text("request_id").notNull(),
    selections: jsonb("selections").$type<PokerAccepted[]>().notNull(),
    stakePaise: bigint("stake_paise", { mode: "bigint" }).notNull(),
    payoutPaise: bigint("payout_paise", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("poker_request_user").on(t.userId, t.requestId),
    index("poker_bets_round").on(t.roundId),
    index("poker_bets_user").on(t.userId, t.id),
  ],
);
