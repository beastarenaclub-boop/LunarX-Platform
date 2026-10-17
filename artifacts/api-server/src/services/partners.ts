import {
  db,
  partnersTable,
  partnerApiKeysTable,
  partnerWalletsTable,
  partnerRequestNoncesTable,
  partnerPlayerLinksTable,
  usersTable,
  type Partner,
  type PartnerApiKey,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { hashPassword } from "../lib/password";
import { encryptSecret, decryptSecret } from "../lib/secretCrypto";
import { nanoid } from "nanoid";

export { decryptSecret };

// Re-export for routes that need the attempts table.
export {
  webhookDeliveryAttemptsTable,
} from "@workspace/db";

export const HMAC_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export interface IssuedKey {
  apiKey: PartnerApiKey;
  keyId: string;
  secret: string;
}

export function generateKeyMaterial(): { keyId: string; secret: string } {
  const keyId = `pk_${crypto.randomBytes(12).toString("base64url")}`;
  const secret = crypto.randomBytes(32).toString("base64url");
  return { keyId, secret };
}

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString("base64url")}`;
}

export async function issueApiKey(
  partnerId: string,
  label: string | null,
): Promise<IssuedKey> {
  const { keyId, secret } = generateKeyMaterial();
  // Encrypt-at-rest with AES-256-GCM (key from PARTNER_SECRET_KEY). The
  // plaintext `secret` is returned to the operator exactly once so they
  // can hand it to the partner; after this point only the envelope lives
  // in the DB.
  const [row] = await db
    .insert(partnerApiKeysTable)
    .values({
      partnerId,
      keyId,
      secret: encryptSecret(secret),
      label: label ?? null,
    })
    .returning();
  return { apiKey: row!, keyId, secret };
}

export async function getPartner(id: string): Promise<Partner | null> {
  const rows = await db
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function findPartnerByKeyId(
  keyId: string,
): Promise<{ partner: Partner; apiKey: PartnerApiKey } | null> {
  const rows = await db
    .select({ partner: partnersTable, apiKey: partnerApiKeysTable })
    .from(partnerApiKeysTable)
    .innerJoin(
      partnersTable,
      eq(partnersTable.id, partnerApiKeysTable.partnerId),
    )
    .where(eq(partnerApiKeysTable.keyId, keyId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Inbound partner request signing scheme v1:
 *   HMAC-SHA256(secret, `${timestamp}.${nonce}.${rawBody}`)
 * Binding the nonce into the signed payload prevents an attacker from
 * replaying a captured signature with a fresh nonce within the timestamp
 * window.
 */
export function verifyHmac(params: {
  secret: string;
  timestamp: string;
  nonce: string;
  body: string;
  signature: string;
}): boolean {
  const expected = crypto
    .createHmac("sha256", params.secret)
    .update(`${params.timestamp}.${params.nonce}.${params.body}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(params.signature, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function signHmac(params: {
  secret: string;
  timestamp: string;
  body: string;
  /** Optional nonce: required for inbound partner requests, omitted for outbound webhooks. */
  nonce?: string;
}): string {
  const payload = params.nonce
    ? `${params.timestamp}.${params.nonce}.${params.body}`
    : `${params.timestamp}.${params.body}`;
  return crypto.createHmac("sha256", params.secret).update(payload).digest("hex");
}

export async function touchKeyUsage(apiKeyId: string): Promise<void> {
  await db
    .update(partnerApiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(partnerApiKeysTable.id, apiKeyId));
}

const SHADOW_DOMAIN = "@partner.lunar.local";

/**
 * Resolve (or create) a shadow user for a partner-owned player using a
 * dedicated mapping table so that distinct external `playerRef` values
 * always map to distinct local users (no email-derivation collisions).
 */
export async function ensurePartnerShadowUser(
  partnerId: string,
  playerRef: string,
): Promise<{ id: string }> {
  const link = await db
    .select({ userId: partnerPlayerLinksTable.userId })
    .from(partnerPlayerLinksTable)
    .where(
      and(
        eq(partnerPlayerLinksTable.partnerId, partnerId),
        eq(partnerPlayerLinksTable.playerRef, playerRef),
      ),
    )
    .limit(1);
  if (link[0]) return { id: link[0].userId };

  const localPart = nanoid(16).toLowerCase();
  const email = `partner_${partnerId}_${localPart}${SHADOW_DOMAIN}`;
  const normalized = email.toLowerCase();
  const passwordHash = await hashPassword(nanoid(40));
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      emailNormalized: normalized,
      passwordHash,
      role: "player",
      status: "active",
      displayName: `Partner ${playerRef}`.slice(0, 64),
    })
    .returning({ id: usersTable.id });

  try {
    await db.insert(partnerPlayerLinksTable).values({
      partnerId,
      playerRef,
      userId: user!.id,
    });
    return { id: user!.id };
  } catch {
    const after = await db
      .select({ userId: partnerPlayerLinksTable.userId })
      .from(partnerPlayerLinksTable)
      .where(
        and(
          eq(partnerPlayerLinksTable.partnerId, partnerId),
          eq(partnerPlayerLinksTable.playerRef, playerRef),
        ),
      )
      .limit(1);
    return { id: after[0]!.userId };
  }
}

/**
 * Anti-replay: insert (apiKeyId, nonce); returns false if already used
 * (caught via unique index conflict).
 */
export async function consumeRequestNonce(
  apiKeyId: string,
  nonce: string,
): Promise<boolean> {
  try {
    await db
      .insert(partnerRequestNoncesTable)
      .values({ apiKeyId, nonce });
    return true;
  } catch {
    return false;
  }
}

export async function pruneOldNonces(): Promise<void> {
  const cutoff = new Date(Date.now() - HMAC_TIMESTAMP_TOLERANCE_MS * 2);
  await db
    .delete(partnerRequestNoncesTable)
    .where(sql`${partnerRequestNoncesTable.createdAt} < ${cutoff}`);
}

export async function ensurePartnerWallet(
  partnerId: string,
  currency = "INR",
): Promise<{ id: string; balancePaise: bigint }> {
  const existing = await db
    .select()
    .from(partnerWalletsTable)
    .where(
      and(
        eq(partnerWalletsTable.partnerId, partnerId),
        eq(partnerWalletsTable.currency, currency),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return { id: existing[0].id, balancePaise: existing[0].balancePaise };
  }
  const inserted = await db
    .insert(partnerWalletsTable)
    .values({ partnerId, currency })
    .onConflictDoNothing({
      target: [partnerWalletsTable.partnerId, partnerWalletsTable.currency],
    })
    .returning();
  if (inserted[0]) {
    return { id: inserted[0].id, balancePaise: inserted[0].balancePaise };
  }
  const after = await db
    .select()
    .from(partnerWalletsTable)
    .where(
      and(
        eq(partnerWalletsTable.partnerId, partnerId),
        eq(partnerWalletsTable.currency, currency),
      ),
    )
    .limit(1);
  return { id: after[0]!.id, balancePaise: after[0]!.balancePaise };
}

export async function adjustPartnerWallet(
  partnerId: string,
  deltaPaise: bigint,
  currency = "INR",
): Promise<bigint> {
  await ensurePartnerWallet(partnerId, currency);
  const [row] = await db
    .update(partnerWalletsTable)
    .set({
      balancePaise: sql`${partnerWalletsTable.balancePaise} + ${deltaPaise.toString()}::bigint`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(partnerWalletsTable.partnerId, partnerId),
        eq(partnerWalletsTable.currency, currency),
      ),
    )
    .returning({ balance: partnerWalletsTable.balancePaise });
  return row!.balance;
}
