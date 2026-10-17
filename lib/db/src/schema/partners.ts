import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  bigint,
  integer,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";

export const partnerStatusEnum = pgEnum("partner_status", [
  "active",
  "suspended",
  "disabled",
]);

export const partnerWalletModeEnum = pgEnum("partner_wallet_mode", [
  "local-credits",
  "remote-wallet",
]);

export const partnersTable = pgTable(
  "partners",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    displayName: text("display_name").notNull(),
    contactEmail: text("contact_email"),
    allowedGames: text("allowed_games")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    allowedOrigins: text("allowed_origins")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    walletMode: partnerWalletModeEnum("wallet_mode")
      .notNull()
      .default("local-credits"),
    // Per-game RTP override map: { lunar: 0.97, mines: 0.99 }. NULL = inherit
    // platform defaults. Replaces the previous single-scalar `rtpOverride`.
    rtpOverrides: jsonb("rtp_overrides").$type<Record<string, number>>(),
    status: partnerStatusEnum("status").notNull().default("active"),
    webhookUrl: text("webhook_url"),
    webhookSecret: text("webhook_secret"),
    walletCallbackUrl: text("wallet_callback_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("partners_status_idx").on(t.status)],
);

export type Partner = typeof partnersTable.$inferSelect;
export type PartnerStatus = (typeof partnerStatusEnum.enumValues)[number];
export type PartnerWalletMode =
  (typeof partnerWalletModeEnum.enumValues)[number];

export const partnerApiKeyStatusEnum = pgEnum("partner_api_key_status", [
  "active",
  "revoked",
]);

export const partnerApiKeysTable = pgTable(
  "partner_api_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    keyId: text("key_id").notNull(),
    // Stored secret used for server-side HMAC verification. Encrypt-at-rest
    // is delegated to the database (TDE / disk encryption); we never expose
    // this field over any API except the one-shot issuance response.
    secret: text("secret").notNull().default(""),
    label: text("label"),
    status: partnerApiKeyStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("partner_api_keys_key_id_idx").on(t.keyId),
    index("partner_api_keys_partner_id_idx").on(t.partnerId),
    index("partner_api_keys_status_idx").on(t.status),
  ],
);

export type PartnerApiKey = typeof partnerApiKeysTable.$inferSelect;
export type PartnerApiKeyStatus =
  (typeof partnerApiKeyStatusEnum.enumValues)[number];

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "delivering",
  "delivered",
  "failed",
]);

export const webhookDeliveriesTable = pgTable(
  "webhook_deliveries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastResponseStatus: integer("last_response_status"),
    lastResponseBody: text("last_response_body"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("webhook_deliveries_event_id_idx").on(t.eventId),
    index("webhook_deliveries_partner_id_idx").on(t.partnerId),
    index("webhook_deliveries_status_next_attempt_idx").on(
      t.status,
      t.nextAttemptAt,
    ),
    index("webhook_deliveries_created_at_idx").on(t.createdAt),
  ],
);

export type WebhookDelivery = typeof webhookDeliveriesTable.$inferSelect;
export type WebhookDeliveryStatus =
  (typeof webhookDeliveryStatusEnum.enumValues)[number];

// Per-attempt history for a webhook delivery so admins can audit each try
// independently (timing, response, error). The latest-attempt mirror lives
// on `webhook_deliveries` for cheap list rendering.
export const webhookDeliveryAttemptsTable = pgTable(
  "webhook_delivery_attempts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => webhookDeliveriesTable.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    statusCode: integer("status_code").notNull(),
    responseBody: text("response_body"),
    requestHeaders: jsonb("request_headers"),
    requestBody: text("request_body"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("webhook_delivery_attempts_delivery_id_idx").on(t.deliveryId),
    index("webhook_delivery_attempts_created_at_idx").on(t.createdAt),
  ],
);

export type WebhookDeliveryAttempt =
  typeof webhookDeliveryAttemptsTable.$inferSelect;

export const partnerRequestLogsTable = pgTable(
  "partner_request_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    partnerId: text("partner_id").references(() => partnersTable.id, {
      onDelete: "cascade",
    }),
    apiKeyId: text("api_key_id"),
    requestId: text("request_id"),
    method: text("method").notNull(),
    path: text("path").notNull(),
    statusCode: integer("status_code").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    ip: text("ip"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("partner_request_logs_partner_id_idx").on(t.partnerId),
    index("partner_request_logs_created_at_idx").on(t.createdAt),
  ],
);

export type PartnerRequestLog = typeof partnerRequestLogsTable.$inferSelect;

// Per-partner wallet float used for local-credits accounting summary.
// Per-player balances live on the shadow user's normal wallet/ledger.
export const partnerWalletsTable = pgTable(
  "partner_wallets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    currency: text("currency").notNull().default("INR"),
    balancePaise: bigint("balance_paise", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("partner_wallets_partner_currency_idx").on(
      t.partnerId,
      t.currency,
    ),
  ],
);

export type PartnerWallet = typeof partnerWalletsTable.$inferSelect;

// Anti-replay nonce store: every signed partner request must carry a
// unique nonce; we insert (api_key_id, nonce) and rely on the unique index
// to reject replays. Rows are pruned after the timestamp tolerance window.
export const partnerRequestNoncesTable = pgTable(
  "partner_request_nonces",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    apiKeyId: text("api_key_id").notNull(),
    nonce: text("nonce").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("partner_request_nonces_key_nonce_idx").on(t.apiKeyId, t.nonce),
    index("partner_request_nonces_created_at_idx").on(t.createdAt),
  ],
);

// Stable mapping from (partnerId, externalPlayerRef) to a local shadow user.
// Avoids any lossy email-derivation: distinct refs always map to distinct users.
export const partnerPlayerLinksTable = pgTable(
  "partner_player_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    playerRef: text("player_ref").notNull(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("partner_player_links_partner_ref_idx").on(
      t.partnerId,
      t.playerRef,
    ),
    index("partner_player_links_user_id_idx").on(t.userId),
  ],
);

export type PartnerPlayerLink = typeof partnerPlayerLinksTable.$inferSelect;
