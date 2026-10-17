import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Lookup table for the platform's RBAC roles. The set of valid role names is
 * also encoded as the `user_role` Postgres enum on `users.role` for
 * referential integrity at the column level (DB enforces only the listed
 * values can land in `users.role`). This table acts as the
 * human/operator-facing source-of-truth describing each role's purpose and
 * the coarse permission set associated with it, and is seeded automatically
 * on application startup (see `artifacts/api-server/src/lib/bootstrap.ts`).
 */
export const rolesTable = pgTable("roles", {
  name: text("name").primaryKey(),
  description: text("description").notNull(),
  permissions: jsonb("permissions").notNull().$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Role = typeof rolesTable.$inferSelect;
