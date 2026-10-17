import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { nanoid } from "nanoid";

export const userRoleEnum = pgEnum("user_role", [
  "player",
  "agent",
  "support",
  "admin",
  "super_admin",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "suspended",
  "banned",
  "pending",
]);

export const usersTable = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("player"),
    status: userStatusEnum("status").notNull().default("active"),
    displayName: text("display_name"),
    referralCode: text("referral_code"),
    referredBy: text("referred_by"),
    channel: text("channel").$type<"b2c" | "b2b">().notNull().default("b2c"),
    b2bAgentId: text("b2b_agent_id"),
    migratedToUserId: text("migrated_to_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_normalized_idx").on(t.emailNormalized),
    index("users_role_idx").on(t.role),
    index("users_status_idx").on(t.status),
    uniqueIndex("users_referral_code_idx")
      .on(t.referralCode)
      .where(sql`${t.referralCode} IS NOT NULL`),
    index("users_referred_by_idx").on(t.referredBy),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
