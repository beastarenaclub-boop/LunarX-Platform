import { useEffect, useSyncExternalStore } from "react";

/**
 * "The game on screen is still animating toward a result the server may
 * already have settled."
 *
 * Settlement and the reveal are two different moments. The server credits a
 * win (and pushes the new wallet balance) at settlement, but a roulette ball,
 * a plinko ball or a card flip can still be on its way for several seconds
 * after that. Anything outside the game that reads the server directly — the
 * shared "My results" bar, its "You won!" notice — would announce the win
 * before the game has shown it.
 *
 * A game declares the hold for exactly the stretch where its own animation is
 * still ahead of the server; while ANY hold is up, the shell keeps freshly
 * settled results back and releases them the moment the last hold drops.
 *
 * Global rather than per game: only one game screen is mounted at a time, and
 * a per-game key would have to agree character for character with the report
 * code the shell uses — a mismatch there fails silently, as a leak.
 */

/**
 * A hold never outlives this, so a stalled animation cannot hide receipts for
 * ever. Longer than the longest legitimate hold: Dragon Tiger One Day holds
 * from a first-window bet to the tiger landing, about 42 s.
 */
const MAX_HOLD_MS = 60_000;

const holds = new Map<symbol, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let held = false;

function publish(): void {
  const next = holds.size > 0;
  if (next === held) return;
  held = next;
  for (const l of listeners) l();
}

function acquire(): symbol {
  const token = Symbol("result-hold");
  holds.set(
    token,
    setTimeout(() => release(token), MAX_HOLD_MS),
  );
  publish();
  return token;
}

function release(token: symbol): void {
  const timer = holds.get(token);
  if (timer === undefined) return;
  clearTimeout(timer);
  holds.delete(token);
  publish();
}

/**
 * Hold freshly settled results back while `holding` is true.
 *
 * Declarative: pass the condition ("my result is not on screen yet") and the
 * hook takes and drops the hold as it changes, and drops it on unmount.
 */
export function useResultHold(holding: boolean): void {
  useEffect(() => {
    if (!holding) return;
    const token = acquire();
    return () => release(token);
  }, [holding]);
}

/**
 * Imperative form for a game whose reveal runs outside React (an animation
 * loop, a promise chain). Returns the release; calling it twice is harmless.
 */
export function holdResults(): () => void {
  const token = acquire();
  return () => release(token);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Is any game on screen still ahead of its own result? */
export function useResultsHeld(): boolean {
  return useSyncExternalStore(subscribe, () => held, () => false);
}
