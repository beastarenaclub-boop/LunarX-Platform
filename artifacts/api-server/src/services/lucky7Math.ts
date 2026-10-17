/**
 * Pure Lucky 7 (classic 7 Up / 7 Down) math: bet validation and settlement.
 * No IO — fully deterministic given the dice roll, so the /verify endpoint
 * can recompute every payout from the seeds.
 *
 * Rules: two fair dice are rolled; players back the total being
 *   - "under"   → total 2..6   (15 of 36 combinations)
 *   - "exactly" → total 7      ( 6 of 36 combinations)
 *   - "over"    → total 8..12  (15 of 36 combinations)
 *
 * Version 2 returns 2× on Under/Over and 12× on Exactly 7, including stake.
 * A total of 7 loses both Under and Over bets. Version 1's edge-scaled
 * prices are retained only to settle/replay rounds opened before the change.
 */

export type Lucky7BetType = "under" | "exactly" | "over";
export type Lucky7PayoutVersion = 1 | 2 | 3;
export const LUCKY7_PAYOUT_VERSION: Lucky7PayoutVersion = 3;
export const LUCKY7_MAX_RETURN = 12;
const FIXED_RETURN_HUNDREDTHS: Record<Lucky7BetType, bigint> = {
  under: 200n,
  exactly: 1200n,
  over: 200n,
};

export const LUCKY7_BET_TYPES: readonly Lucky7BetType[] = [
  "under",
  "exactly",
  "over",
];

/** One slip may hold at most one bet per spot. */
export const LUCKY7_MAX_BETS_PER_ROUND = LUCKY7_BET_TYPES.length;

/** Two dice → 36 equally likely combinations. */
export const LUCKY7_TOTAL_COMBINATIONS = 36;

/** Combinations that win each spot (15 / 6 / 15 out of 36). */
export const LUCKY7_WINNING_COMBINATIONS: Record<Lucky7BetType, number> = {
  under: 15,
  exactly: 6,
  over: 15,
};

export interface Lucky7Roll {
  dice: [number, number];
  total: number;
}

/** Which spot a rolled total pays. */
export function lucky7Result(total: number): Lucky7BetType {
  if (total < 7) return "under";
  if (total > 7) return "over";
  return "exactly";
}

/** House edge is clamped so a bad config can never produce a negative payout. */
function normalizeEdge(houseEdge: number): number {
  if (!Number.isFinite(houseEdge)) return 0;
  return Math.min(Math.max(houseEdge, 0), 0.99);
}

function capHundredths(maxMultiplier: number): bigint {
  return BigInt(Math.max(100, Math.floor(maxMultiplier * 100)));
}

/**
 * Total-return multiplier in hundredths for the round's payout version.
 * This is the single source of truth for what
 * a Lucky 7 bet pays — the API, settlement and /verify all read it.
 */
export function lucky7ReturnHundredths(
  type: Lucky7BetType,
  houseEdge: number,
  maxMultiplier: number,
  payoutVersion: Lucky7PayoutVersion = LUCKY7_PAYOUT_VERSION,
): bigint {
  const combos = LUCKY7_WINNING_COMBINATIONS[type];
  if (!combos) throw new Error("INVALID_LUCKY7_BET");
  if (payoutVersion === 2) return FIXED_RETURN_HUNDREDTHS[type];
  // 85% expected return on every spot, with the original fair dice draw.
  // Old rounds keep their accepted version 1/2 prices.
  if (payoutVersion === 3) return type === "exactly" ? 510n : 204n;
  if (payoutVersion !== 1) throw new Error("INVALID_LUCKY7_PAYOUT_VERSION");
  const raw = Math.round(
    ((1 - normalizeEdge(houseEdge)) * LUCKY7_TOTAL_COMBINATIONS * 100) / combos,
  );
  const hundredths = BigInt(Math.max(0, raw));
  const cap = capHundredths(maxMultiplier);
  return hundredths < cap ? hundredths : cap;
}

/** Same value as a plain number (e.g. 2.33) for API responses. */
export function lucky7ReturnMultiplier(
  type: Lucky7BetType,
  houseEdge: number,
  maxMultiplier: number,
  payoutVersion: Lucky7PayoutVersion = LUCKY7_PAYOUT_VERSION,
): number {
  return Number(lucky7ReturnHundredths(type, houseEdge, maxMultiplier, payoutVersion)) / 100;
}

/** Live payout table for all three spots at the given config. */
export function lucky7Payouts(
  houseEdge: number,
  maxMultiplier: number,
  payoutVersion: Lucky7PayoutVersion = LUCKY7_PAYOUT_VERSION,
): Record<Lucky7BetType, number> {
  return {
    under: lucky7ReturnMultiplier("under", houseEdge, maxMultiplier, payoutVersion),
    exactly: lucky7ReturnMultiplier("exactly", houseEdge, maxMultiplier, payoutVersion),
    over: lucky7ReturnMultiplier("over", houseEdge, maxMultiplier, payoutVersion),
  };
}

export interface Lucky7BetInput {
  type: Lucky7BetType;
  amountPaise: bigint;
}

export interface SettledLucky7Bet {
  type: Lucky7BetType;
  amountPaise: string;
  payoutPaise: string;
  didWin: boolean;
}

export interface StoredLucky7Bets {
  payoutVersion: Lucky7PayoutVersion;
  bets: SettledLucky7Bet[];
}

/** Older audit rows stored a bare array and used the edge-scaled paytable. */
export function parseStoredLucky7Bets(raw: unknown): StoredLucky7Bets {
  if (Array.isArray(raw)) return { payoutVersion: 1, bets: raw as SettledLucky7Bet[] };
  const stored = raw as Partial<StoredLucky7Bets> | null;
  if (!stored || ![1, 2, 3].includes(stored.payoutVersion!) || !Array.isArray(stored.bets)) {
    throw new Error("INVALID_LUCKY7_STORED_BETS");
  }
  return { payoutVersion: stored.payoutVersion!, bets: stored.bets };
}

export interface Lucky7Settlement {
  settled: SettledLucky7Bet[];
  totalStake: bigint;
  totalPayout: bigint;
}

/**
 * Settle every bet on a slip against the rolled total. Payout per winning bet
 * is floor(stake × returnHundredths / 100). Legacy prices retain their cap.
 * Throws INVALID_LUCKY7_BET on a bad type/amount.
 */
export function settleLucky7Bets(
  bets: Lucky7BetInput[],
  roll: Lucky7Roll,
  houseEdge: number,
  maxMultiplier: number,
  payoutVersion: Lucky7PayoutVersion = LUCKY7_PAYOUT_VERSION,
): Lucky7Settlement {
  const winner = lucky7Result(roll.total);
  let totalStake = 0n;
  let totalPayout = 0n;
  const settled: SettledLucky7Bet[] = [];
  for (const b of bets) {
    if (!LUCKY7_BET_TYPES.includes(b.type)) {
      throw new Error("INVALID_LUCKY7_BET");
    }
    if (typeof b.amountPaise !== "bigint" || b.amountPaise <= 0n) {
      throw new Error("INVALID_LUCKY7_BET");
    }
    totalStake += b.amountPaise;

    const didWin = b.type === winner;
    let payout = 0n;
    if (didWin) {
      const hundredths = lucky7ReturnHundredths(b.type, houseEdge, maxMultiplier, payoutVersion);
      payout = (b.amountPaise * hundredths) / 100n;
    }
    totalPayout += payout;
    settled.push({
      type: b.type,
      amountPaise: b.amountPaise.toString(),
      payoutPaise: payout.toString(),
      didWin,
    });
  }
  return { settled, totalStake, totalPayout };
}
