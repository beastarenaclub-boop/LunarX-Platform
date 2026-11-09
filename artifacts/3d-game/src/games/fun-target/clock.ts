// One cabinet clock reading 60 -> 0 across the platform's three phases:
// betting (50 s), then a LOCKED tail that is the reveal + settle windows
// (5 s + 5 s on the shipped config, the same cadence as the two wheels).
//
// The kit was written for a 50/10/0 split. The platform's settle phase cannot
// be 0 (gameConfigResolver floors it at 500 ms), so the tail is read off the
// round's own config rather than assumed — an operator changing either window
// moves the lock, not the digits.
export const SPIN_DURATION_MS = 6000;
/** Auto-confirm a valid staged draft this many seconds before the lock. */
export const AUTO_PLACE_LEAD_SECONDS = 2;

export interface Tail { revealDurationMs: number; settleDurationMs: number }
export const DEFAULT_TAIL: Tail = { revealDurationMs: 5000, settleDurationMs: 5000 };

/** The second at which betting shuts, as the cabinet clock reads it. */
export function lockSeconds(tail: Tail): number {
  return Math.ceil((tail.revealDurationMs + tail.settleDurationMs) / 1000);
}

/** Whole-round seconds left: the phase's own remainder plus every phase still to come. */
export function cabinetSeconds(phase: string | null, remainingMs: number, tail: Tail = DEFAULT_TAIL): number | null {
  if (phase === null) return null;
  const ahead = phase === "betting" ? tail.revealDurationMs + tail.settleDurationMs
    : phase === "reveal" ? tail.settleDurationMs : 0;
  return Math.ceil((Math.max(0, remainingMs) + ahead) / 1000);
}
