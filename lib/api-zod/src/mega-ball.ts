/** Mega Ball studio rules. Amounts and payouts are integer paise. */
export const MEGA_BALL_TIMING = {
  bettingWindowMs: 20_000,
  revealDurationMs: 48_000,
  settleDurationMs: 4_000,
} as const;
export const MEGA_BALL_PAYTABLE = [0, 1, 5, 50, 250, 1000, 10000] as const;
export const MEGA_BALL_MULTIPLIERS = [5, 10, 15, 20, 25, 50, 100] as const;
export const MEGA_BALL_MAX_RETURN = 1_000_000;
export interface MegaBallOutcome {
  balls: number[];
  megaBall: number;
  multiplier: number;
  version: 1;
}
export interface MegaBallCard {
  type: string;
  numbers: number[];
  amountPaise: string;
}
export const MEGA_BALL_LINES = [
  ...Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, col) => row * 5 + col),
  ),
  ...Array.from({ length: 5 }, (_, col) =>
    Array.from({ length: 5 }, (_, row) => row * 5 + col),
  ),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];
export function megaBallLines(numbers: number[], balls: readonly number[]) {
  const drawn = new Set(balls);
  return MEGA_BALL_LINES.filter((line) =>
    line.every((index) => drawn.has(numbers[index])),
  );
}
export function megaBallCardResult(
  numbers: number[],
  outcome: MegaBallOutcome,
) {
  const before = megaBallLines(numbers, outcome.balls).length;
  const lines = megaBallLines(numbers, [
    ...outcome.balls,
    outcome.megaBall,
  ]).length;
  const boosted = lines > before;
  const multiplier =
    MEGA_BALL_PAYTABLE[Math.min(lines, 6)] * (boosted ? outcome.multiplier : 1);
  return { lines, boosted, multiplier };
}
