import {
  pgTable,
  text,
  timestamp,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

export const sessionsTable = pgTable(
  "sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid(32)),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastIp: text("last_ip"),
    clientHints: jsonb("client_hints").$type<Record<string, string>>(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // Partner attribution for sessions opened via the iframe launcher.
    // When set, server-side bet/wallet routes auto-tag the partnerId so
    // remote-wallet partners get debit/credit calls and webhooks fire.
    partnerId: text("partner_id"),
    partnerPlayerRef: text("partner_player_ref"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export type Session = typeof sessionsTable.$inferSelect;

export const passwordResetsTable = pgTable(
  "password_resets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid(48)),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("password_resets_user_id_idx").on(t.userId)],
);

export type PasswordReset = typeof passwordResetsTable.$inferSelect;
