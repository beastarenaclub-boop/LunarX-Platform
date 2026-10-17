import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  bigint,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

// Promotional free bets (Aviator-style). A grant carries N free bets of a
// fixed stake each; placing a free bet consumes one from the grant without
// touching the cash wallet. Winnings are credited to the cash wallet.
export const freeBetSourceEnum = pgEnum("free_bet_source", ["admin", "rain"]);

export const freeBetGrantsTable = pgTable(
  "free_bet_grants",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    gameCode: text("game_code").notNull().default("lunar"),
    // Stake of each free bet, in paise.
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    totalCount: integer("total_count").notNull(),
    remainingCount: integer("remaining_count").notNull(),
    source: freeBetSourceEnum("source").notNull().default("admin"),
    grantedBy: text("granted_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("free_bet_grants_user_idx").on(t.userId),
    index("free_bet_grants_created_idx").on(t.createdAt),
  ],
);
export type FreeBetGrant = typeof freeBetGrantsTable.$inferSelect;

// A "rain" drop announced in chat: the first `maxClaims` players to claim
// each receive a free-bet grant of `amountPaise` × `betsPerClaim`.
export const rainEventsTable = pgTable(
  "rain_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    gameCode: text("game_code").notNull().default("lunar"),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    betsPerClaim: integer("bets_per_claim").notNull().default(1),
    maxClaims: integer("max_claims").notNull(),
    claimedCount: integer("claimed_count").notNull().default(0),
    message: text("message"),
    createdBy: text("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("rain_events_created_idx").on(t.createdAt)],
);
export type RainEvent = typeof rainEventsTable.$inferSelect;

export const rainClaimsTable = pgTable(
  "rain_claims",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    rainId: text("rain_id")
      .notNull()
      .references(() => rainEventsTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    grantId: text("grant_id").references(() => freeBetGrantsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("rain_claims_rain_user_idx").on(t.rainId, t.userId),
    index("rain_claims_user_idx").on(t.userId),
  ],
);
export type RainClaim = typeof rainClaimsTable.$inferSelect;
