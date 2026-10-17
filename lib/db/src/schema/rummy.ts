import { pgTable, text, jsonb, integer, bigint } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const rummySessionsTable = pgTable("rummy_sessions", {
  userId: text("user_id").primaryKey().references(() => usersTable.id),
  state: jsonb("state").notNull(),
  version: integer("version").notNull().default(0),
  deadline: bigint("deadline", { mode: "number" }).notNull().default(0),
});
