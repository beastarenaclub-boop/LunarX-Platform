import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { partnersTable } from "./partners";

/**
 * Short-lived launch tokens issued by `POST /v1/sessions` and consumed by
 * `GET /launch?token=...`. The token is opaque random material — its only
 * meaning is the (partnerId, playerRef, gameCode) it was issued for. Tokens
 * are single-use: `consumedAt` is set when /launch boots a real auth
 * session, so a leaked URL cannot be replayed.
 */
export const partnerSessionsTable = pgTable(
  "partner_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    token: text("token")
      .notNull()
      .$defaultFn(() => nanoid(48)),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    playerRef: text("player_ref").notNull(),
    gameCode: text("game_code").notNull(),
    currency: text("currency").notNull().default("INR"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    // Set by GET /launch once we've validated the partner's allowedOrigins
    // CSP and served the wrapper. /api/launcher/exchange refuses to consume
    // tokens that haven't been wrapper-verified — this prevents a malicious
    // page from iframing the inner game route directly with a stolen token
    // and bypassing the per-partner frame-ancestors allowlist.
    wrapperVerifiedAt: timestamp("wrapper_verified_at", { withTimezone: true }),
    // Random nonce minted by GET /launch and round-tripped via an HttpOnly
    // cookie. POST /api/launcher/wrapper-attest requires the cookie value
    // to match this column — binds the attestation to the browser context
    // that actually rendered /launch, blocking out-of-band replays.
    wrapperNonce: text("wrapper_nonce"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("partner_sessions_token_idx").on(t.token),
    index("partner_sessions_partner_id_idx").on(t.partnerId),
    index("partner_sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export type PartnerSession = typeof partnerSessionsTable.$inferSelect;
