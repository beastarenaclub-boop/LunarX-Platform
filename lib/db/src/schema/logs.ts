import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export const appLogLevelEnum = pgEnum("app_log_level", [
  "info",
  "warn",
  "error",
]);

export const appLogsTable = pgTable(
  "app_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    level: appLogLevelEnum("level").notNull().default("info"),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    actorId: text("actor_id"),
    ip: text("ip"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("app_logs_kind_idx").on(t.kind),
    index("app_logs_level_idx").on(t.level),
    index("app_logs_actor_idx").on(t.actorId),
    index("app_logs_created_at_idx").on(t.createdAt),
  ],
);

export type AppLog = typeof appLogsTable.$inferSelect;
export type AppLogLevel = (typeof appLogLevelEnum.enumValues)[number];
