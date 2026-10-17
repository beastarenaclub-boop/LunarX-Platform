/** Shared pacing for the filmed Andar Bahar dealer. All times are milliseconds. */
export const AB_MOTION_VERSION = 1;
export const AB_TIMING = {
  bettingWindowMs: 30_000,
  jokerMs: 1_900,
  cardMs: 1_700,
  holdMs: 900,
} as const;

export function andarBaharRevealMs(cardsDealt: number): number {
  if (!Number.isInteger(cardsDealt) || cardsDealt < 1 || cardsDealt > 49)
    throw new Error("Invalid Andar Bahar card count");
  return AB_TIMING.jokerMs + cardsDealt * AB_TIMING.cardMs + AB_TIMING.holdMs;
}
