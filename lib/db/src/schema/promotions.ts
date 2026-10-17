import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  bigint,
  integer,
  boolean,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

// Append-only ledger for the bonus wallet. Mirrors the cash wallet ledger
// pattern: signed amount, computed balance, immutable rows.
export const bonusLedgerTypeEnum = pgEnum("bonus_ledger_type", [
  "signup",
  "deposit_tier",
  "referral",
  "bet",
  "win",
  "conversion_out",
  "conversion_in",
  "revoke",
  "adjust",
]);

export const bonusLedgerTable = pgTable(
  "bonus_ledger",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    type: bonusLedgerTypeEnum("type").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "bigint" }).notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    memo: text("memo"),
    metadata: jsonb("metadata"),
    createdBy: text("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bonus_ledger_user_idx").on(t.userId),
    index("bonus_ledger_type_idx").on(t.type),
    index("bonus_ledger_created_at_idx").on(t.createdAt),
    // Idempotency: at most one ledger row per (refType, refId) for the
    // crediting operations (signup, deposit_tier, referral). Partial-unique
    // so bets/wins/conversions are unaffected.
    uniqueIndex("bonus_ledger_credit_idem_idx")
      .on(t.refType, t.refId, t.type)
      .where(
        sql`${t.type} IN ('signup','deposit_tier','referral') AND ${t.refType} IS NOT NULL AND ${t.refId} IS NOT NULL`,
      ),
  ],
);

export type BonusLedgerEntry = typeof bonusLedgerTable.$inferSelect;
export type BonusLedgerType = (typeof bonusLedgerTypeEnum.enumValues)[number];

// Per-user wagering tracker for the active bonus grant. We accumulate
// wagered stake from bonus bets; once it reaches `requiredWager`, the
// remaining bonus balance auto-converts to cash.
export const bonusWageringTable = pgTable(
  "bonus_wagering",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    totalIssued: bigint("total_issued", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    requiredWager: bigint("required_wager", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    wageredSoFar: bigint("wagered_so_far", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    lastConvertedAt: timestamp("last_converted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const signupBonusClaimsTable = pgTable(
  "signup_bonus_claims",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    ip: text("ip"),
    emailNormalized: text("email_normalized").notNull(),
    granted: boolean("granted").notNull(),
    blockedReason: text("blocked_reason"),
    amount: bigint("amount", { mode: "bigint" }).notNull().default(sql`0`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("signup_bonus_claims_user_idx").on(t.userId),
    uniqueIndex("signup_bonus_claims_ip_granted_idx")
      .on(t.ip)
      .where(sql`${t.granted} = true AND ${t.ip} IS NOT NULL`),
    uniqueIndex("signup_bonus_claims_email_granted_idx")
      .on(t.emailNormalized)
      .where(sql`${t.granted} = true`),
  ],
);
export type SignupBonusClaim = typeof signupBonusClaimsTable.$inferSelect;

export const referralStatusEnum = pgEnum("referral_status", [
  "signed_up",
  "qualified",
]);

export const referralsTable = pgTable(
  "referrals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    referrerId: text("referrer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    refereeId: text("referee_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    referralCode: text("referral_code").notNull(),
    status: referralStatusEnum("status").notNull().default("signed_up"),
    qualifyingDepositId: text("qualifying_deposit_id"),
    rewardLedgerId: text("reward_ledger_id"),
    rewardPaise: bigint("reward_paise", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("referrals_referee_idx").on(t.refereeId),
    index("referrals_referrer_idx").on(t.referrerId),
    index("referrals_status_idx").on(t.status),
  ],
);
export type Referral = typeof referralsTable.$inferSelect;

// Singleton row keyed by id='singleton'.
export const promotionSettingsTable = pgTable("promotion_settings", {
  id: text("id").primaryKey().default("singleton"),
  enabled: boolean("enabled").notNull().default(true),
  signupBonusPaise: bigint("signup_bonus_paise", { mode: "bigint" })
    .notNull()
    .default(sql`100000`), // ₹1,000
  // JSON array of { minPaise: string, maxPaise: string|null, bonusPaise: string }
  // sorted ascending by minPaise. The matching tier is the highest minPaise
  // <= recharge amount where (maxPaise === null OR amount <= maxPaise).
  depositTiers: jsonb("deposit_tiers").notNull(),
  referrerRewardPaise: bigint("referrer_reward_paise", { mode: "bigint" })
    .notNull()
    .default(sql`50000`), // ₹500
  referrerMinDepositPaise: bigint("referrer_min_deposit_paise", {
    mode: "bigint",
  })
    .notNull()
    .default(sql`500000`), // ₹5,000
  wageringMultiplier: integer("wagering_multiplier").notNull().default(1),
  updatedBy: text("updated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type PromotionSettings = typeof promotionSettingsTable.$inferSelect;

export const bonusEventTypeEnum = pgEnum("bonus_event_type", [
  "signup_granted",
  "signup_blocked_ip",
  "signup_blocked_email",
  "deposit_bonus_granted",
  "referral_signed_up",
  "referral_qualified",
  "bonus_bet_placed",
  "bonus_win_credited",
  "bonus_converted_to_cash",
  "bonus_revoked",
  "settings_updated",
  "bonus_credit_failed",
  "bonus_credit_overflow",
]);

export const bonusEventsTable = pgTable(
  "bonus_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    type: bonusEventTypeEnum("type").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull().default(sql`0`),
    ip: text("ip"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bonus_events_type_idx").on(t.type),
    index("bonus_events_created_at_idx").on(t.createdAt),
    index("bonus_events_user_idx").on(t.userId),
  ],
);
export type BonusEvent = typeof bonusEventsTable.$inferSelect;
export type BonusEventType = (typeof bonusEventTypeEnum.enumValues)[number];
