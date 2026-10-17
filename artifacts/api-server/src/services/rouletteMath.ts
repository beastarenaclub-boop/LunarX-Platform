/** European single-zero roulette: 36 / covered pockets total return.
 * Straight 36x, split 18x, street 12x, corner 9x, line 6x, dozen/column 3x,
 * outside 2x. RTP 36/37, house edge 1/37. Historical bases remain replayable.
 */

import { ROULETTE_PAYOUT_BASE, ROULETTE_LIMITS, rouletteMaxBetPaise, rouletteSelectionKey } from "@workspace/api-zod/roulette-game";
export { ROULETTE_PAYOUT_BASE };
export const ROULETTE_POCKETS = 37; // 0..36



export const ROULETTE_RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type RouletteBetType =
  | "straight"
  | "split"
  | "street"
  | "corner"
  | "line"
  | "dozen"
  | "column"
  | "red"
  | "black"
  | "odd"
  | "even"
  | "high"
  | "low";

export interface RouletteBetInput {
  type: RouletteBetType;
  /** Inside bets: the exact numbers covered (validated against the layout). */
  numbers?: number[];
  /** dozen/column: 1 | 2 | 3. */
  selection?: number;
  amountPaise: bigint;
}

/** Per selection, per player, per round, including all previously funded slips. */
export function validateRouletteStakes(bets: RouletteBetInput[], existing: RouletteBetInput[] = []): void {
  if (!bets.length) throw new Error("NO_BETS");
  if (bets.length > ROULETTE_LIMITS.maxBetsPerSlip) throw new Error("TOO_MANY_BETS");
  const totals = new Map<string, bigint>();
  for (const bet of existing) {
    const key = rouletteSelectionKey(bet);
    totals.set(key, (totals.get(key) ?? 0n) + bet.amountPaise);
  }
  for (const bet of bets) {
    rouletteBetCoverage(bet);
    if (bet.amountPaise < BigInt(ROULETTE_LIMITS.minBetPaise)) throw new Error("ROULETTE_BET_TOO_SMALL");
    const key = rouletteSelectionKey(bet);
    const total = (totals.get(key) ?? 0n) + bet.amountPaise;
    if (total > rouletteMaxBetPaise(bet.type)) {
      throw new Error(bet.type === "straight" ? "ROULETTE_STRAIGHT_LIMIT" : "ROULETTE_OTHER_LIMIT");
    }
    totals.set(key, total);
  }
}

function key(nums: number[]): string {
  return [...nums].sort((a, b) => a - b).join(",");
}

// ---------------------------------------------------------------------------
// Precomputed valid inside-bet combinations for the European layout
// (3 columns × 12 rows; 0 sits above row 1).
// ---------------------------------------------------------------------------

const VALID_SPLITS: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  for (let n = 1; n <= 36; n++) {
    if (n % 3 !== 0) out.add(key([n, n + 1])); // within a street
    if (n + 3 <= 36) out.add(key([n, n + 3])); // across streets
  }
  out.add(key([0, 1]));
  out.add(key([0, 2]));
  out.add(key([0, 3]));
  return out;
})();

const VALID_STREETS: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  for (let r = 0; r < 12; r++) out.add(key([r * 3 + 1, r * 3 + 2, r * 3 + 3]));
  // Trios with the zero on the European layout.
  out.add(key([0, 1, 2]));
  out.add(key([0, 2, 3]));
  return out;
})();

const VALID_CORNERS: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  for (let n = 1; n <= 32; n++) {
    if (n % 3 !== 0) out.add(key([n, n + 1, n + 3, n + 4]));
  }
  out.add(key([0, 1, 2, 3])); // "first four"
  return out;
})();

const VALID_LINES: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  for (let r = 0; r < 11; r++) {
    const n = r * 3 + 1;
    out.add(key([n, n + 1, n + 2, n + 3, n + 4, n + 5]));
  }
  return out;
})();

/**
 * Resolve the set of pockets a bet covers, throwing INVALID_ROULETTE_BET for
 * malformed or off-layout combinations.
 */
export function rouletteBetCoverage(bet: {
  type: RouletteBetType;
  numbers?: number[];
  selection?: number;
}): number[] {
  const numbers = bet.numbers ?? [];
  const uniq = [...new Set(numbers)].sort((a, b) => a - b);
  const allInRange = uniq.every((n) => Number.isInteger(n) && n >= 0 && n <= 36);
  switch (bet.type) {
    case "straight":
      if (uniq.length !== 1 || !allInRange) throw new Error("INVALID_ROULETTE_BET");
      return uniq;
    case "split":
      if (uniq.length !== 2 || !allInRange || !VALID_SPLITS.has(key(uniq)))
        throw new Error("INVALID_ROULETTE_BET");
      return uniq;
    case "street":
      if (uniq.length !== 3 || !allInRange || !VALID_STREETS.has(key(uniq)))
        throw new Error("INVALID_ROULETTE_BET");
      return uniq;
    case "corner":
      if (uniq.length !== 4 || !allInRange || !VALID_CORNERS.has(key(uniq)))
        throw new Error("INVALID_ROULETTE_BET");
      return uniq;
    case "line":
      if (uniq.length !== 6 || !allInRange || !VALID_LINES.has(key(uniq)))
        throw new Error("INVALID_ROULETTE_BET");
      return uniq;
    case "dozen": {
      const d = bet.selection;
      if (d !== 1 && d !== 2 && d !== 3) throw new Error("INVALID_ROULETTE_BET");
      return Array.from({ length: 12 }, (_, i) => (d - 1) * 12 + i + 1);
    }
    case "column": {
      const c = bet.selection;
      if (c !== 1 && c !== 2 && c !== 3) throw new Error("INVALID_ROULETTE_BET");
      return Array.from({ length: 12 }, (_, i) => c + i * 3);
    }
    case "red":
      return [...ROULETTE_RED_NUMBERS].sort((a, b) => a - b);
    case "black":
      return Array.from({ length: 36 }, (_, i) => i + 1).filter(
        (n) => !ROULETTE_RED_NUMBERS.has(n),
      );
    case "odd":
      return Array.from({ length: 18 }, (_, i) => i * 2 + 1);
    case "even":
      return Array.from({ length: 18 }, (_, i) => (i + 1) * 2);
    case "high":
      return Array.from({ length: 18 }, (_, i) => i + 19);
    case "low":
      return Array.from({ length: 18 }, (_, i) => i + 1);
    default:
      throw new Error("INVALID_ROULETTE_BET");
  }
}

/**
 * Total-return multiplier (stake included) for a winning bet covering
 * `covered` pockets. Uses the fixed paytable:
 *   ROULETTE_PAYOUT_BASE / pockets_covered
 * At BASE=36 all valid coverage sizes have integer total-return prices.
 *
 * Payouts are fixed regardless of admin config — the edge is collected implicitly
 * by the zero pocket. Capped to maxMultiplier so the admin stake ceiling holds.
 */
export function rouletteTotalReturnMultiplier(
  covered: number,
  maxMultiplier: number,
): number {
  if (covered < 1 || covered > 36) throw new Error("INVALID_ROULETTE_BET");
  const raw = ROULETTE_PAYOUT_BASE / covered;
  return Math.min(maxMultiplier, raw);
}

export interface SettledRouletteBet {
  type: RouletteBetType;
  numbers?: number[];
  selection?: number;
  amountPaise: string;
  payoutPaise: string;
  didWin: boolean;
}

/**
 * Settle a list of bets against the winning pocket. Returns per-bet payouts
 * (0 for losers) and the aggregate totals. Payouts floor to whole paise.
 *
 * Payouts use ROULETTE_PAYOUT_BASE / pockets_covered (currently 36) regardless
 * of the configured house edge — the edge is collected implicitly by the zero
 * pocket, not by scaling payouts.
 */
export function settleRouletteBets(
  bets: RouletteBetInput[],
  pocket: number,
  maxMultiplier: number,
  payoutBase = ROULETTE_PAYOUT_BASE,
): { settled: SettledRouletteBet[]; totalStake: bigint; totalPayout: bigint } {
  let totalStake = 0n;
  let totalPayout = 0n;
  const settled: SettledRouletteBet[] = bets.map((b) => {
    if (b.amountPaise <= 0n) throw new Error("INVALID_STAKE");
    const coverage = rouletteBetCoverage(b);
    const didWin = coverage.includes(pocket);
    let payout = 0n;
    if (didWin) {
      const mult = rouletteTotalReturnMultiplierWithBase(coverage.length, payoutBase, maxMultiplier);
      // For non-integer multipliers (e.g. 35/3) the +1e-9 guard prevents
      // float dust from causing off-by-one floors on exact values.
      payout = Number.isInteger(mult)
        ? b.amountPaise * BigInt(mult)
        : BigInt(Math.floor(Number(b.amountPaise) * mult + 1e-9));
    }
    totalStake += b.amountPaise;
    totalPayout += payout;
    return {
      type: b.type,
      ...(b.numbers ? { numbers: [...b.numbers].sort((x, y) => x - y) } : {}),
      ...(b.selection !== undefined ? { selection: b.selection } : {}),
      amountPaise: b.amountPaise.toString(),
      payoutPaise: payout.toString(),
      didWin,
    };
  });
  return { settled, totalStake, totalPayout };
}

/**
 * Like rouletteTotalReturnMultiplier but with an explicit payout base.
 * Used by the verify endpoint to recompute historical rounds at the base
 * that was active when the round was settled, so 31.45, 35 and 36-base
 * rounds verify correctly without trusting stored payoutPaise.
 */
export function rouletteTotalReturnMultiplierWithBase(
  covered: number,
  payoutBase: number,
  maxMultiplier: number,
): number {
  if (covered < 1 || covered > 36) throw new Error("INVALID_ROULETTE_BET");
  return Math.min(maxMultiplier, payoutBase / covered);
}

/** Color of a pocket for UI/verification. */
export function pocketColor(n: number): "green" | "red" | "black" {
  if (n === 0) return "green";
  return ROULETTE_RED_NUMBERS.has(n) ? "red" : "black";
}
