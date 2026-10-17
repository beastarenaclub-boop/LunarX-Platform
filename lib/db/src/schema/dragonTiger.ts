import {
  pgTable,
  text,
  integer,
  numeric,
  serial,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Player statistics. The legacy practice balance is archived; spendable funds live in wallet_ledger.
export const dragonTigerPlayersTable = pgTable(
  "dragon_tiger_players",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => usersTable.id),
    balance: integer("balance").notNull().default(0),
    net: numeric("net", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    played: integer("played").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    lastSeen: timestamp("last_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("dragon_tiger_ranking_idx").on(t.net, t.wins)],
);

export const dragonTigerRoundsTable = pgTable("dragon_tiger_rounds", {
  id: serial("id").primaryKey(),
  dragon: integer("dragon").notNull(),
  tiger: integer("tiger").notNull(),
  mainProfitPaisePerRupee: integer("main_profit_paise_per_rupee").notNull().default(98),
  tieProfitPaisePerRupee: integer("tie_profit_paise_per_rupee").notNull().default(1200),
  closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
  revealsAt: timestamp("reveals_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

export const dragonTigerBetsTable = pgTable(
  "dragon_tiger_bets",
  {
    id: serial("id").primaryKey(),
    roundId: integer("round_id")
      .notNull()
      .references(() => dragonTigerRoundsTable.id),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    spots: jsonb("spots")
      .$type<{ dragon: number; tiger: number; tie: number }>()
      .notNull(),
    stake: integer("stake").notNull(),
    payout: numeric("payout", { precision: 12, scale: 2, mode: "number" }),
    walletFunded: boolean("wallet_funded").notNull().default(true),
  },
  (t) => [
    uniqueIndex("dragon_tiger_one_bet_idx").on(t.roundId, t.userId),
    index("dragon_tiger_user_bets_idx").on(t.userId, t.id),
  ],
);
