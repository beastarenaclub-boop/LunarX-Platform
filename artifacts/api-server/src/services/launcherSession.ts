import { db, partnerSessionsTable, type PartnerSession } from "@workspace/db";
import { and, eq, gt, isNull, isNotNull } from "drizzle-orm";

const LAUNCH_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface IssueParams {
  partnerId: string;
  playerRef: string;
  gameCode: string;
  currency?: string;
}

export async function issueLaunchToken(p: IssueParams): Promise<PartnerSession> {
  const expiresAt = new Date(Date.now() + LAUNCH_TOKEN_TTL_MS);
  const [row] = await db
    .insert(partnerSessionsTable)
    .values({
      partnerId: p.partnerId,
      playerRef: p.playerRef,
      gameCode: p.gameCode,
      currency: p.currency ?? "INR",
      expiresAt,
    })
    .returning();
  return row!;
}

/**
 * Atomically claim a launch token. Returns the row if it was unclaimed and
 * within its TTL, or null otherwise. Uses a conditional UPDATE so two
 * concurrent requests cannot both succeed.
 */
export async function consumeLaunchToken(
  token: string,
): Promise<PartnerSession | null> {
  const now = new Date();
  const [row] = await db
    .update(partnerSessionsTable)
    .set({ consumedAt: now })
    .where(
      and(
        eq(partnerSessionsTable.token, token),
        isNull(partnerSessionsTable.consumedAt),
        gt(partnerSessionsTable.expiresAt, now),
        // Refuse tokens that didn't go through the /launch CSP wrapper —
        // this is what enforces partner.allowedOrigins for the iframe.
        // The check lives in the UPDATE WHERE so unverified tokens are
        // never marked consumed (no accidental burn on hostile probes).
        isNotNull(partnerSessionsTable.wrapperVerifiedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Mark a token as having passed the /launch wrapper (and therefore the
 * partner's per-origin CSP frame-ancestors check). Idempotent — safe to
 * call on every wrapper hit (refreshes are valid until the token expires).
 */
export async function markWrapperVerified(
  token: string,
): Promise<void> {
  await db
    .update(partnerSessionsTable)
    .set({ wrapperVerifiedAt: new Date() })
    .where(
      and(
        eq(partnerSessionsTable.token, token),
        isNull(partnerSessionsTable.consumedAt),
        gt(partnerSessionsTable.expiresAt, new Date()),
      ),
    );
}

/**
 * Persist a freshly-minted wrapper nonce on the launch token row. The
 * value is sent back to the browser as an HttpOnly cookie by GET /launch
 * and re-presented on POST /wrapper-attest, where we verify it matches.
 */
export async function setWrapperNonce(
  token: string,
  nonce: string,
): Promise<void> {
  await db
    .update(partnerSessionsTable)
    .set({ wrapperNonce: nonce })
    .where(
      and(
        eq(partnerSessionsTable.token, token),
        isNull(partnerSessionsTable.consumedAt),
        gt(partnerSessionsTable.expiresAt, new Date()),
      ),
    );
}

export async function findLaunchToken(
  token: string,
): Promise<PartnerSession | null> {
  const rows = await db
    .select()
    .from(partnerSessionsTable)
    .where(eq(partnerSessionsTable.token, token))
    .limit(1);
  return rows[0] ?? null;
}
