/**
 * Rummy Royale money, pure.
 *
 * The kit's practice table paid the whole four-seat pot to a winner with no
 * fee. For real money the house takes its edge OFF THE POT: a win returns
 * `4 x (1 - houseEdge)` times the entry (stake included), a drawn table
 * returns the entry, a loss returns nothing. The edge is therefore the one
 * operator knob on this game and the result engine steers how often the
 * player's seat wins; between them the two set the RTP.
 *
 * In whole hundredths so settlement is exact bigint arithmetic, and capped by
 * the round's `maxMultiplier` (floor 4 — MAX_MULTIPLIER_FLOORS — so the cap
 * can never cut a win at any legal edge).
 */
export const POT_SEATS = 4;
export type RummyClass = "you" | "computer" | "draw";

function normalizeEdge(houseEdge: number): number {
  if (!Number.isFinite(houseEdge)) return 0;
  return Math.min(Math.max(houseEdge, 0), 0.99);
}

/** The win's total return in hundredths of the entry, edge taken off the pot. */
export function winReturnHundredths(houseEdge: number, maxMultiplier: number): bigint {
  if (!Number.isFinite(maxMultiplier) || maxMultiplier <= 0) throw new Error("INVALID_MULTIPLIER");
  const raw = BigInt(Math.round(POT_SEATS * (1 - normalizeEdge(houseEdge)) * 100));
  const cap = BigInt(Math.floor(maxMultiplier * 100));
  return raw < cap ? raw : cap;
}

/** What each result returns, as multipliers of the entry (stake included). */
export function payouts(houseEdge: number, maxMultiplier: number): Record<RummyClass, number> {
  return {
    you: Number(winReturnHundredths(houseEdge, maxMultiplier)) / 100,
    draw: 1,
    computer: 0,
  };
}

/** Total payout in paise for an entry that ended in `cls`. */
export function payoutPaise(cls: RummyClass, stakePaise: bigint, houseEdge: number, maxMultiplier: number): bigint {
  if (cls === "computer") return 0n;
  if (cls === "draw") return stakePaise;
  return (stakePaise * winReturnHundredths(houseEdge, maxMultiplier)) / 100n;
}

/** The SHIPPED top return (the pot at zero edge); the cap floor is derived from it. */
export const TOP_RETURN_MULTIPLIER = POT_SEATS;
