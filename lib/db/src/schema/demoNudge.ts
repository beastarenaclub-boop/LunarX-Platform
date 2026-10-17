import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

export const demoNudgeKindEnum = pgEnum("demo_nudge_kind", [
  "impression",
  "click",
  "conversion",
]);

export const demoNudgeTriggerEnum = pgEnum("demo_nudge_trigger", [
  "rounds",
  "bigwin",
  "lowbalance",
]);

export const demoNudgeEventsTable = pgTable(
  "demo_nudge_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    sessionRef: text("session_ref"),
    kind: demoNudgeKindEnum("kind").notNull(),
    trigger: demoNudgeTriggerEnum("trigger").notNull(),
    language: text("language"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("demo_nudge_events_kind_trigger_idx").on(t.kind, t.trigger),
    index("demo_nudge_events_session_ref_idx").on(t.sessionRef),
    index("demo_nudge_events_created_at_idx").on(t.createdAt),
  ],
);

export type DemoNudgeEvent = typeof demoNudgeEventsTable.$inferSelect;
