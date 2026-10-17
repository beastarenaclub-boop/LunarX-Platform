import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable, userRoleEnum } from "./users";

export const auditLogTable = pgTable(
  "audit_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    actorId: text("actor_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: userRoleEnum("actor_role"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_actor_id_idx").on(t.actorId),
    index("audit_target_idx").on(t.targetType, t.targetId),
    index("audit_action_idx").on(t.action),
    index("audit_created_at_idx").on(t.createdAt),
  ],
);

export type AuditLog = typeof auditLogTable.$inferSelect;
