import crypto from "node:crypto";
import { db, partnersTable, type Partner } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { signHmac } from "./partners";

// In-memory partner cache for hot-path bet placement. Wallet-mode rarely
// changes; the cache is invalidated on TTL (60s) so admin edits propagate
// quickly enough without hammering the DB on every bet.
const PARTNER_CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: Partner; expiresAt: number }>();

export async function getPartner(partnerId: string): Promise<Partner | null> {
  const hit = cache.get(partnerId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const rows = await db
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.id, partnerId))
    .limit(1);
  const value = rows[0];
  if (!value) {
    cache.delete(partnerId);
    return null;
  }
  cache.set(partnerId, {
    value,
    expiresAt: Date.now() + PARTNER_CACHE_TTL_MS,
  });
  return value;
}

export function invalidatePartnerCache(partnerId: string): void {
  cache.delete(partnerId);
}

export interface WalletOpInput {
  partner: Partner;
  /** Stable id from the partner namespace (their player_id). */
  playerRef: string;
  /** Always positive paise; direction is implied by the endpoint. */
  amountPaise: bigint;
  /** Idempotency key — partner endpoint MUST dedupe on this. */
  idempotencyKey: string;
  /** Lunar bet id, surfaced for partner-side reconciliation. */
  betId: string;
  /** Game code for partner reporting/limits. */
  gameCode: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;

async function callWallet(
  op: "debit" | "credit",
  input: WalletOpInput,
): Promise<{ ok: boolean; status: number; body: string }> {
  const { partner, playerRef, amountPaise, idempotencyKey, betId, gameCode } =
    input;
  if (!partner.walletCallbackUrl) {
    throw new Error("REMOTE_WALLET_NOT_CONFIGURED");
  }
  // We re-use the webhook secret for outbound wallet calls. The partner
  // therefore only needs one shared secret to verify both webhook events
  // and wallet ops; the path itself (`/debit` vs `/credit`) disambiguates.
  if (!partner.webhookSecret) {
    throw new Error("REMOTE_WALLET_SECRET_MISSING");
  }
  const url = `${partner.walletCallbackUrl.replace(/\/$/, "")}/${op}`;
  const ts = Date.now().toString();
  const body = JSON.stringify({
    op,
    playerRef,
    amount: amountPaise.toString(),
    currency: "INR",
    idempotencyKey,
    betId,
    gameCode,
  });
  const sig = signHmac({
    secret: partner.webhookSecret,
    timestamp: ts,
    body,
  });
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-partner-timestamp": ts,
        "x-partner-signature": sig,
        "x-partner-idempotency-key": idempotencyKey,
      },
      body,
      signal: ac.signal,
    });
    const text = await resp.text();
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      body: text.slice(0, 1000),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: `network: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Authoritative debit. Throws an Error whose `.message` is one of the
 * stable codes mapped by the global error middleware:
 *   - INSUFFICIENT_FUNDS       — partner gave a definitive 4xx (e.g. 402,
 *                                409). The bet is voided and the caller
 *                                surfaces a 4xx to the partner.
 *   - REMOTE_WALLET_UNAVAILABLE — transient failure (network/timeout/5xx)
 *                                AFTER one retry with the same idempotency
 *                                key. Bet is voided but the partner can
 *                                reconcile via GET /v1/bets/{id} (the row
 *                                survives) and replay debits idempotently.
 *
 * Idempotency: we always send the same `idempotencyKey` (derived from the
 * Lunar bet id), so a successful retry after a half-completed first call
 * is safe — partner's /debit handler MUST dedupe on this header.
 */
const TRANSIENT = (status: number): boolean =>
  status === 0 || status === 408 || status === 425 || status === 429 ||
  (status >= 500 && status <= 599);

export async function remoteDebit(input: WalletOpInput): Promise<void> {
  let attempt = await callWallet("debit", input);
  if (!attempt.ok && TRANSIENT(attempt.status)) {
    logger.warn(
      { partnerId: input.partner.id, betId: input.betId, status: attempt.status },
      "remote debit transient failure — retrying once with same idempotency key",
    );
    attempt = await callWallet("debit", input);
  }
  if (attempt.ok) return;
  logger.warn(
    {
      partnerId: input.partner.id,
      betId: input.betId,
      status: attempt.status,
      body: attempt.body,
    },
    "remote wallet debit definitively failed",
  );
  // Definitive partner-side rejection (4xx, except the transient subset
  // above) → INSUFFICIENT_FUNDS. Anything else (network, timeout, 5xx after
  // retry) → REMOTE_WALLET_UNAVAILABLE so the partner can distinguish a
  // hard reject from "we couldn't tell".
  if (!TRANSIENT(attempt.status) && attempt.status >= 400 && attempt.status < 500) {
    throw new Error("INSUFFICIENT_FUNDS");
  }
  throw new Error("REMOTE_WALLET_UNAVAILABLE");
}

/**
 * Best-effort credit. The bet is already settled in our books so the
 * partner is the source of truth on the player wallet. If the call fails
 * here, the durable `bet.settled` webhook (already enqueued by the bets
 * service) is the partner's recovery signal — they re-credit on receipt
 * using the same betId, which their `/credit` handler must dedupe.
 */
export async function remoteCredit(input: WalletOpInput): Promise<boolean> {
  const result = await callWallet("credit", input);
  if (!result.ok) {
    logger.warn(
      {
        partnerId: input.partner.id,
        betId: input.betId,
        status: result.status,
        body: result.body,
      },
      "remote wallet credit failed (will retry via bet.settled webhook)",
    );
    return false;
  }
  return true;
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}
