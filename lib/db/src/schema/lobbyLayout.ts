import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const lobbyLayoutTable = pgTable("lobby_layout", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  layout: jsonb("layout").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: text("updated_by"),
});
