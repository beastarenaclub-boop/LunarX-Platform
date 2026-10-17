import { db, usersTable, sessionsTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.emailNormalized, normalizeEmail(email)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export interface PartnerSessionContext {
  partnerId: string;
  partnerPlayerRef: string;
}

export async function createSession(
  userId: string,
  ip: string | null,
  userAgent: string | null,
  partnerCtx?: PartnerSessionContext | null,
  ttlMsOverride?: number,
): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + (ttlMsOverride ?? SESSION_TTL_MS));
  const [session] = await db
    .insert(sessionsTable)
    .values({
      userId,
      expiresAt,
      ip,
      userAgent,
      partnerId: partnerCtx?.partnerId ?? null,
      partnerPlayerRef: partnerCtx?.partnerPlayerRef ?? null,
    })
    .returning();
  return { id: session!.id, expiresAt: session!.expiresAt };
}

export async function getActiveSession(id: string) {
  const rows = await db
    .select()
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.id, id),
        isNull(sessionsTable.revokedAt),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeSession(id: string): Promise<void> {
  await db
    .update(sessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(sessionsTable.id, id));
}
