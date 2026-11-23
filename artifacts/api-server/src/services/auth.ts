import { db, usersTable, sessionsTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { and, eq, gt, inArray, isNull, like, or } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { unauthorized, HttpError } from "../lib/errors";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * Login usernames: the first USERNAME_NAME_LETTERS letters of the account's
 * name + USERNAME_DIGITS random digits, e.g. "Rahul Sharma" -> rahul482.
 * Shorter names use all their letters (Raj -> raj482); names with no Latin
 * letters fall back to USERNAME_FALLBACK_PREFIX (cry482).
 */
export const USERNAME_NAME_LETTERS = 5;
export const USERNAME_DIGITS = 3;
export const USERNAME_FALLBACK_PREFIX = "cry";
/**
 * Accepts current names (rahul482), the 4-digit overflow used when a name's
 * 1,000 numbers are all taken (rahul4821), and older "cry" + 4-digit names
 * (cry1234), which keep working.
 */
export const USERNAME_PATTERN = new RegExp(
  `^[a-z]{1,${USERNAME_NAME_LETTERS}}\\d{${USERNAME_DIGITS},${USERNAME_DIGITS + 1}}$`,
);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isUsername(value: string): boolean {
  return USERNAME_PATTERN.test(normalizeUsername(value));
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.emailNormalized, normalizeEmail(email)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserByUsername(
  username: string,
): Promise<User | null> {
  const normalized = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normalized)) return null;
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, normalized))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Resolve a login identifier. Players, masters and agents use their username
 * (rahul482, or an older cry1234); admin/support and accounts created before
 * usernames existed can still use their email.
 */
export async function findUserByLogin(
  identifier: string,
): Promise<User | null> {
  const value = identifier.trim();
  if (!value) return null;
  if (isUsername(value)) return findUserByUsername(value);
  if (value.includes("@")) return findUserByEmail(value);
  return null;
}

type DbOrTx = Pick<typeof db, "select">;

/** Username letters taken from a name: "Rahul Sharma" -> "rahul", "José" -> "jose". */
export function usernamePrefix(name: string | null | undefined): string {
  const letters = (name ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return letters.slice(0, USERNAME_NAME_LETTERS) || USERNAME_FALLBACK_PREFIX;
}

/**
 * Pick a random, currently unused username for an account called `name`:
 * its first 5 letters + 3 random digits. Each name has 1,000 numbers; once
 * they are all taken a 4th digit is added so signups never stop. The unique
 * index on users.username is the final guard against a concurrent signup
 * taking the same name, so callers must retry on a unique violation (see
 * `isUniqueViolation`).
 */
export async function generateUsername(
  name: string | null | undefined,
  conn: DbOrTx = db,
): Promise<string> {
  const prefix = usernamePrefix(name);
  for (const digits of [USERNAME_DIGITS, USERNAME_DIGITS + 1]) {
    const space = 10 ** digits;
    const format = (n: number) => `${prefix}${String(n).padStart(digits, "0")}`;
    // Fast path: random probes, checked in one round trip.
    for (let round = 0; round < 4; round++) {
      const candidates = [
        ...new Set(Array.from({ length: 16 }, () => format(randomInt(space)))),
      ];
      const taken = await conn
        .select({ username: usersTable.username, email: usersTable.emailNormalized })
        .from(usersTable)
        .where(
          or(
            inArray(usersTable.username, candidates),
            inArray(usersTable.emailNormalized, candidates),
          ),
        );
      const used = new Set(taken.flatMap((t) => [t.username, t.email]));
      const free = candidates.find((c) => !used.has(c));
      if (free) return free;
    }
    // Nearly full for this name: list its taken numbers and pick a free one.
    // The prefix is plain a-z, so it is safe inside a LIKE pattern.
    const rows = await conn
      .select({ username: usersTable.username, email: usersTable.emailNormalized })
      .from(usersTable)
      .where(
        or(
          like(usersTable.username, `${prefix}%`),
          like(usersTable.emailNormalized, `${prefix}%`),
        ),
      );
    const used = new Set(rows.flatMap((r) => [r.username, r.email]));
    const free: string[] = [];
    for (let i = 0; i < space; i++) {
      const candidate = format(i);
      if (!used.has(candidate)) free.push(candidate);
    }
    if (free.length > 0) return free[randomInt(free.length)]!;
  }
  throw new HttpError(
    503,
    "USERNAMES_EXHAUSTED",
    "New accounts are temporarily unavailable. Please contact support.",
  );
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; constraint?: string; cause?: unknown };
  if (e.code === "23505" && (!constraint || e.constraint === constraint))
    return true;
  return isUniqueViolation(e.cause, constraint);
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
  expectedPasswordHash?: string,
): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + (ttlMsOverride ?? SESSION_TTL_MS));
  return db.transaction(async tx => {
    const [user] = await tx.select({ passwordHash: usersTable.passwordHash }).from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user || (expectedPasswordHash !== undefined && user.passwordHash !== expectedPasswordHash)) throw unauthorized("Credentials changed. Please sign in again.");
    const [session] = await tx
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
  });
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
