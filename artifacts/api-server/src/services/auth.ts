import { db, usersTable, sessionsTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { and, eq, gt, inArray, isNotNull, isNull, notLike, or } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { unauthorized, HttpError } from "../lib/errors";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/** Player usernames: "cry" + USERNAME_DIGITS random digits, 7 characters total. */
export const USERNAME_PREFIX = "cry";
export const USERNAME_DIGITS = 4;
export const USERNAME_PATTERN = new RegExp(
  `^${USERNAME_PREFIX}\\d{${USERNAME_DIGITS}}$`,
);
const USERNAME_SPACE = 10 ** USERNAME_DIGITS;

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
 * Resolve a login identifier. Players use their username (cry1234); operators
 * and players created before usernames existed can still use their email.
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

function formatUsername(n: number): string {
  return `${USERNAME_PREFIX}${String(n).padStart(USERNAME_DIGITS, "0")}`;
}

/**
 * Pick a random, currently unused username. The unique index on
 * users.username is the final guard against a concurrent signup taking the
 * same name, so callers must retry on a unique violation (see
 * `isUniqueViolation`).
 */
export async function generateUsername(conn: DbOrTx = db): Promise<string> {
  // Fast path: random probes, checked in one round trip.
  for (let round = 0; round < 4; round++) {
    const candidates = [
      ...new Set(
        Array.from({ length: 16 }, () => formatUsername(randomInt(USERNAME_SPACE))),
      ),
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
  // Nearly full: scan for remaining free names and pick one at random.
  const all = await conn
    .select({ username: usersTable.username, email: usersTable.emailNormalized })
    .from(usersTable)
    .where(
      or(isNotNull(usersTable.username), notLike(usersTable.emailNormalized, "%@%")),
    );
  const used = new Set(all.flatMap((r) => [r.username, r.email]));
  const free: string[] = [];
  for (let i = 0; i < USERNAME_SPACE; i++) {
    const name = formatUsername(i);
    if (!used.has(name)) free.push(name);
  }
  if (free.length === 0) {
    throw new HttpError(
      503,
      "USERNAMES_EXHAUSTED",
      "New accounts are temporarily unavailable. Please contact support.",
    );
  }
  return free[randomInt(free.length)]!;
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
