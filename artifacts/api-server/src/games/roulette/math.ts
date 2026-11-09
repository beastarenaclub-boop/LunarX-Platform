/**
 * Roulette payout arithmetic, for both wheels.
 *
 * Pure — no DB, no config — so the paytable is trivially unit-testable and the
 * history endpoint can recompute a settled round without trusting the payout
 * that was stored on it.
 *
 * Payout model: a winning bet returns `stake × numberCount / pocketsCovered`,
 * stake included, floored to whole paise. The edge is not applied to the
 * payout: it is collected by the two zeros, which no even-money, dozen or
 * column bet covers. That is why `houseEdge` is not a settable field on these
 * two games — it is `1 − numberCount/pocketCount` and nothing else, and a
 * stored number that settlement never reads is the dead knob the config
 * registry exists to prevent.
 */
import {
  coveredPockets,
  multiplierFor,
  BetShapeError,
  type BetType,
  type Wheel,
} from "./wheel";

export interface RouletteBetInput {
  type: BetType;
  /**
   * The COMPACT anchor list the wire carries, never the expanded pockets:
   * straight `[pocket]`, split `[two pockets]`, street/sixline `[row start]`,
   * corner `[lowest covered]`, dozen/column `[1|2|3]`, even-money `[]`.
   *
   * A client never says what its bet covers. `coveredPockets` is the only
   * definition, and settlement re-derives from this rather than from anything
   * recorded at placement — so a tampered client cannot widen its own bet.
   */
  selection: number[];
  amountPaise: bigint;
}

export interface SettledRouletteBet {
  type: BetType;
  selection: number[];
  amountPaise: string;
  payoutPaise: string;
  didWin: boolean;
}

/**
 * Payout for a winning bet, in whole paise.
 *
 * `numberCount / covered` is a rational of two small integers, so a float
 * product cannot express it: `Math.floor(Number(stake) * (18 / 4))` lands just
 * under the exact value on a large share of stakes and floors a paisa away.
 * bigint division gives the floor the float only approximated. This is the same
 * defect the crash path already paid for (see the integer-arithmetic note in
 * services/bets.ts).
 *
 * Flooring rather than rounding is deliberate and is why the mini wheel's 4.5×
 * corner is safe: rounding up would hand the player a fraction more than the
 * odds allow. The house is never short, and the most anyone loses to it is half
 * a paisa.
 */
export function roulettePayoutPaise(
  wheel: Wheel,
  amountPaise: bigint,
  covered: number,
  maxMultiplier: number,
): bigint {
  if (covered < 1 || covered > wheel.numberCount) {
    throw new BetShapeError("bet covers no pockets on this wheel");
  }
  const exact = (amountPaise * BigInt(wheel.numberCount)) / BigInt(covered);
  if (maxMultiplier * covered >= wheel.numberCount) return exact;
  // The admin ceiling bites. Pay on the 6dp multiplier grid `bets.ts` credits
  // against, so the recorded payout and the wallet credit cannot disagree.
  const capped =
    (amountPaise * BigInt(Math.round(maxMultiplier * 1e6))) / 1_000_000n;
  return capped < exact ? capped : exact;
}

/** Total return multiplier for a bet type, after the admin ceiling. */
export function rouletteTotalReturnMultiplier(
  wheel: Wheel,
  type: BetType,
  maxMultiplier: number,
): number {
  return Math.min(maxMultiplier, multiplierFor(wheel, type));
}

/**
 * Settle a slip against the winning pocket.
 *
 * Called with `pocket = -1` at VALIDATION time, before a round exists, purely
 * to prove the shapes are legal and to total the stake: no pocket is -1, so
 * every bet reads as a loser and the payout total is meaningless and unused.
 */
export function settleRouletteBets(
  wheel: Wheel,
  bets: RouletteBetInput[],
  pocket: number,
  maxMultiplier: number,
): { settled: SettledRouletteBet[]; totalStake: bigint; totalPayout: bigint } {
  let totalStake = 0n;
  let totalPayout = 0n;
  const settled: SettledRouletteBet[] = bets.map((b) => {
    if (b.amountPaise <= 0n) throw new Error("INVALID_STAKE");
    const coverage = coveredPockets(wheel, b.type, b.selection);
    const didWin = coverage.includes(pocket);
    const payout = didWin
      ? roulettePayoutPaise(wheel, b.amountPaise, coverage.length, maxMultiplier)
      : 0n;
    totalStake += b.amountPaise;
    totalPayout += payout;
    return {
      type: b.type,
      selection: [...b.selection],
      amountPaise: b.amountPaise.toString(),
      payoutPaise: payout.toString(),
      didWin,
    };
  });
  return { settled, totalStake, totalPayout };
}

/**
 * The stored audit wrapper.
 *
 * `numberCount` travels with the settled bets so a historical round recomputes
 * on the LAYOUT it was played on. Rows written before migration 0065 carry
 * `payoutBase` instead: they are European spins on a 37-pocket wheel with a
 * 35-base paytable, and there is no wheel in this file that describes them.
 * Reading them as American would move every payout in a player's history.
 */
export interface StoredRouletteBets {
  /** Present from 0065 onward: the wheel this round was dealt on. */
  numberCount?: number;
  /** Pre-0065 only: the European payout base the round settled under. */
  payoutBase?: number;
  bets: SettledRouletteBet[];
}
