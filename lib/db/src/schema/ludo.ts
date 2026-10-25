import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { betsTable } from "./bets";
export const ludoMatches = pgTable(
  "ludo_matches",
  {
    id: text("id").primaryKey(),
    capacity: integer("capacity").notNull(),
    pool: text("pool").notNull(),
    status: text("status").notNull(),
    entryPaise: bigint("entry_paise", { mode: "bigint" }).notNull(),
    commissionBps: integer("commission_bps").notNull(),
    version: integer("version").notNull().default(0),
    state: jsonb("state").notNull(),
    seed: text("seed").notNull(),
    commitment: text("commitment").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    reason: text("reason"),
  },
  (t) => [
    index("ludo_due").on(t.status, t.deadline),
    index("ludo_queue").on(t.pool, t.status, t.capacity, t.entryPaise),
  ],
);
export const ludoMembers = pgTable(
  "ludo_members",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => ludoMatches.id),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    seat: integer("seat").notNull(),
    requestId: text("request_id").notNull(),
    betId: text("bet_id")
      .notNull()
      .references(() => betsTable.id),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("ludo_member_request").on(t.userId, t.requestId),
    uniqueIndex("ludo_active_user")
      .on(t.userId)
      .where(sql`${t.endedAt} IS NULL`),
    uniqueIndex("ludo_active_seat")
      .on(t.matchId, t.seat)
      .where(sql`${t.endedAt} IS NULL`),
    index("ludo_members_match").on(t.matchId),
    index("ludo_members_user").on(t.userId, t.joinedAt),
  ],
);
export const ludoActions = pgTable(
  "ludo_actions",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => ludoMatches.id),
    userId: text("user_id").references(() => usersTable.id),
    requestId: text("request_id"),
    version: integer("version").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ludo_action_request").on(t.userId, t.requestId),
    uniqueIndex("ludo_action_version").on(t.matchId, t.version),
  ],
);
export const ludoMessages = pgTable(
  "ludo_messages",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => ludoMatches.id),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    requestId: text("request_id").notNull(),
    seat: integer("seat").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    emojiId: text("emoji_id"),
    costPaise: bigint("cost_paise", { mode: "bigint" }).notNull().default(0n),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ludo_message_request").on(t.userId, t.requestId),
    index("ludo_messages_match_time").on(t.matchId, t.createdAt),
    index("ludo_messages_user_time").on(t.userId, t.createdAt),
  ],
);
