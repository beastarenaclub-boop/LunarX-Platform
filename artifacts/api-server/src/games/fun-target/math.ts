export const BET_TYPES = ["straight"] as const;
export type BetType = typeof BET_TYPES[number];
export const MAX_BETS_PER_SLIP = 10;
export const RETURN_HUNDREDTHS: Record<BetType, bigint> = { straight: 900n };
export interface BetInput { type: BetType; selection: [number]; amountPaise: bigint }
export interface Outcome { pocket: number }
export interface SettledBet { type: BetType; selection: [number]; amountPaise: string; payoutPaise: string; didWin: boolean }

export function isOutcome(value: unknown): value is Outcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const n = (value as Outcome).pocket;
  return Number.isInteger(n) && n >= 0 && n < 10;
}
/** A round's paytable as the platform snapshots it (`ftDigitReturn`, migration 0080), or absent. */
export type Paytable = Record<string, number> | null | undefined;
/**
 * The digit's total return in hundredths: the round's paytable row, or the
 * shipped 9x. Whole hundredths (the setting has two decimals) so every payout
 * below is exact bigint arithmetic.
 */
export function digitReturnHundredths(paytable?: Paytable): bigint {
  const v = paytable?.ftDigitReturn;
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? BigInt(Math.round(v * 100)) : RETURN_HUNDREDTHS.straight;
}
export function capHundredths(maxMultiplier: number, paytable?: Paytable): bigint {
  if (!Number.isFinite(maxMultiplier) || maxMultiplier <= 0) throw new Error("INVALID_MULTIPLIER");
  const cap = BigInt(Math.floor(maxMultiplier * 100)), ret = digitReturnHundredths(paytable);
  return ret < cap ? ret : cap;
}
export function validateBets(bets: BetInput[]): bigint {
  if (!Array.isArray(bets) || !bets.length) throw new Error("NO_BETS");
  if (bets.length > MAX_BETS_PER_SLIP) throw new Error("TOO_MANY_BETS");
  const positions = new Set<number>();
  let total = 0n;
  for (const bet of bets) {
    if (!bet || bet.type !== "straight" || !Array.isArray(bet.selection) || bet.selection.length !== 1 ||
        !Number.isInteger(bet.selection[0]) || bet.selection[0] < 0 || bet.selection[0] > 9) {
      throw new Error("INVALID_FUN_TARGET_BET");
    }
    if (typeof bet.amountPaise !== "bigint" || bet.amountPaise <= 0n || bet.amountPaise > 999999999999999999n) throw new Error("INVALID_STAKE");
    if (positions.has(bet.selection[0])) throw new Error("DUPLICATE_BET_POSITION");
    positions.add(bet.selection[0]); total += bet.amountPaise;
  }
  return total;
}
export function settleBets(bets: BetInput[], outcome: Outcome, _houseEdge: number, maxMultiplier: number, paytable?: Paytable) {
  const totalStake = validateBets(bets);
  if (!isOutcome(outcome)) throw new Error("INVALID_OUTCOME");
  const hundredths = capHundredths(maxMultiplier, paytable);
  let totalPayout = 0n;
  const settled: SettledBet[] = bets.map(bet => {
    const didWin = bet.selection[0] === outcome.pocket;
    const payout = didWin ? bet.amountPaise * hundredths / 100n : 0n;
    totalPayout += payout;
    return { type: bet.type, selection: [...bet.selection], amountPaise: bet.amountPaise.toString(), payoutPaise: payout.toString(), didWin };
  });
  return { settled, totalStake, totalPayout };
}
export function payouts(_houseEdge: number, maxMultiplier: number, paytable?: Paytable): Record<BetType, number> {
  return { straight: Number(capHundredths(maxMultiplier, paytable)) / 100 };
}
/** The SHIPPED top return (the paytable is editable since 0080; see MAX_MULTIPLIER_FLOORS for the most it may be set to). */
export function topReturnMultiplier(_houseEdge: number): number { return 9; }
