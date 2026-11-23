import { tooMany } from "../lib/errors";

/**
 * Per-account failed-login throttle. The per-IP limiter alone cannot stop
 * password spraying across guessable usernames (name letters + 3 digits) from
 * many IPs, so failures are also counted per login identifier.
 *
 * State is in memory: the API currently runs as a single instance (see
 * README). Multiple instances would need a shared store.
 */
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const MAX_ENTRIES = 50_000;

interface Entry {
  failures: number;
  firstAt: number;
  lockedUntil: number;
}

const entries = new Map<string, Entry>();

function key(identifier: string): string {
  return identifier.trim().toLowerCase().slice(0, 254);
}

function prune(now: number) {
  if (entries.size < MAX_ENTRIES) return;
  for (const [k, e] of entries) {
    if (e.lockedUntil < now && now - e.firstAt > WINDOW_MS) entries.delete(k);
  }
  // Still full (an attack in progress): drop the oldest entries.
  while (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function assertLoginAllowed(identifier: string, now = Date.now()): void {
  const e = entries.get(key(identifier));
  if (e && e.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((e.lockedUntil - now) / 60_000));
    throw tooMany(
      `Too many failed attempts for this account. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }
}

export function recordLoginFailure(identifier: string, now = Date.now()): void {
  const k = key(identifier);
  let e = entries.get(k);
  if (!e || now - e.firstAt > WINDOW_MS) {
    prune(now);
    e = { failures: 0, firstAt: now, lockedUntil: 0 };
    entries.set(k, e);
  }
  e.failures += 1;
  if (e.failures >= MAX_FAILURES) {
    e.lockedUntil = now + LOCK_MS;
    e.failures = 0;
    e.firstAt = now;
  }
}

export function recordLoginSuccess(identifier: string): void {
  entries.delete(key(identifier));
}

/** Test helper. */
export function resetLoginThrottle(): void {
  entries.clear();
}
