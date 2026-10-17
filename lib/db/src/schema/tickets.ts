import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

export const ticketCategoryEnum = pgEnum("ticket_category", [
  "deposit",
  "withdrawal",
  "kyc",
  "game",
  "account",
  "other",
]);

export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "awaiting_reply",
  "resolved",
  "closed",
]);

export const ticketsTable = pgTable(
  "tickets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    category: ticketCategoryEnum("category").notNull(),
    subject: text("subject").notNull(),
    status: ticketStatusEnum("status").notNull().default("open"),
    assigneeId: text("assignee_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("tickets_user_id_idx").on(t.userId),
    index("tickets_status_idx").on(t.status),
    index("tickets_category_idx").on(t.category),
    index("tickets_assignee_idx").on(t.assigneeId),
    index("tickets_created_at_idx").on(t.createdAt),
  ],
);

export const ticketMessagesTable = pgTable(
  "ticket_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => ticketsTable.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    senderRole: text("sender_role").notNull(),
    body: text("body").notNull(),
    attachmentUrl: text("attachment_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ticket_messages_ticket_idx").on(t.ticketId),
    index("ticket_messages_created_at_idx").on(t.createdAt),
  ],
);

export type Ticket = typeof ticketsTable.$inferSelect;
export type TicketMessage = typeof ticketMessagesTable.$inferSelect;
