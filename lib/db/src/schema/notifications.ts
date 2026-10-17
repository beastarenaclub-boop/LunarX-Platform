import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

export const notificationTypeEnum = pgEnum("notification_type", [
  "kyc_approved",
  "kyc_rejected",
  "deposit_credited",
  "deposit_approved",
  "deposit_rejected",
  "withdrawal_approved",
  "withdrawal_rejected",
  "ticket_reply",
  "bonus_issued",
  "custom",
]);

export const notificationsTable = pgTable(
  "notifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    read: boolean("read").notNull().default(false),
    linkUrl: text("link_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_user_id_idx").on(t.userId),
    index("notifications_read_idx").on(t.userId, t.read),
    index("notifications_created_at_idx").on(t.createdAt),
  ],
);

export type Notification = typeof notificationsTable.$inferSelect;
