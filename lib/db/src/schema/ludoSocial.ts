import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
export const ludoProfiles = pgTable(
  "ludo_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => usersTable.id),
    friendCode: text("friend_code").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ludo_friend_code").on(t.friendCode)],
);
export const ludoFriendships = pgTable(
  "ludo_friendships",
  {
    id: text("id").primaryKey(),
    leftId: text("left_id")
      .notNull()
      .references(() => usersTable.id),
    rightId: text("right_id")
      .notNull()
      .references(() => usersTable.id),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => usersTable.id),
    status: text("status").notNull(),
    leftBlocked: boolean("left_blocked").notNull().default(false),
    rightBlocked: boolean("right_blocked").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ludo_friend_pair").on(t.leftId, t.rightId),
    index("ludo_friend_left").on(t.leftId),
    index("ludo_friend_right").on(t.rightId),
  ],
);
export const ludoDirectMessages = pgTable(
  "ludo_direct_messages",
  {
    id: text("id").primaryKey(),
    friendshipId: text("friendship_id")
      .notNull()
      .references(() => ludoFriendships.id),
    senderId: text("sender_id")
      .notNull()
      .references(() => usersTable.id),
    requestId: text("request_id").notNull(),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    roomCode: text("room_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ludo_dm_request").on(t.senderId, t.requestId),
    index("ludo_dm_thread").on(t.friendshipId, t.createdAt),
  ],
);
