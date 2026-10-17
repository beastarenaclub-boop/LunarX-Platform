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

export const bannerTypeEnum = pgEnum("banner_type", [
  "info",
  "warning",
  "promo",
]);

export const bannersTable = pgTable(
  "banners",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    type: bannerTypeEnum("type").notNull().default("info"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    linkUrl: text("link_url"),
    sticky: boolean("sticky").notNull().default(false),
    active: boolean("active").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => usersTable.id, {
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
    index("banners_active_idx").on(t.active),
    index("banners_starts_at_idx").on(t.startsAt),
    index("banners_ends_at_idx").on(t.endsAt),
  ],
);

export const bannerDismissalsTable = pgTable(
  "banner_dismissals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    bannerId: text("banner_id")
      .notNull()
      .references(() => bannersTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("banner_dismissals_user_idx").on(t.userId),
    index("banner_dismissals_banner_idx").on(t.bannerId),
  ],
);

export type Banner = typeof bannersTable.$inferSelect;
export type BannerDismissal = typeof bannerDismissalsTable.$inferSelect;
