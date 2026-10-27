import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
export const snakeRooms = pgTable(
  "snake_rooms",
  {
    id: text("id").primaryKey(),
    pool: text("pool").notNull(),
    code: text("code"),
    mode: text("mode").notNull(),
    capacity: integer("capacity").notNull(),
    status: text("status").notNull(),
    version: integer("version").notNull().default(0),
    state: jsonb("state").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("snake_room_code").on(t.code),
    index("snake_queue").on(t.pool, t.status, t.mode, t.capacity),
  ],
);
export const snakeMembers = pgTable(
  "snake_members",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => snakeRooms.id),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    seat: integer("seat").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("snake_active_user")
      .on(t.userId)
      .where(sql`${t.endedAt} IS NULL`),
    index("snake_room_members").on(t.roomId),
  ],
);
export const snakeRequests = pgTable(
  "snake_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    requestId: text("request_id").notNull(),
    roomId: text("room_id")
      .notNull()
      .references(() => snakeRooms.id),
    payload: text("payload").notNull(),
  },
  (t) => [uniqueIndex("snake_user_request").on(t.userId, t.requestId)],
);
