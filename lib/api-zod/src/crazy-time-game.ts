/** Original virtual wheel rules, versioned independently of any live provider. */
export const CRAZY_TIME_VERSION = 1 as const;
export const CRAZY_TIME_MAX_RETURN = 5001;
/** Longer studio cycle: bets, presenter/spin, then a visible result pause. */
export const CRAZY_TIME_ROUND_TIMING = {
  bettingWindowMs: 30_000,
  revealDurationMs: 18_000,
  settleDurationMs: 8_000,
} as const;
export const CRAZY_TIME_TYPES = [
  "1",
  "2",
  "5",
  "10",
  "coin-flip",
  "cash-hunt",
  "pachinko",
  "crazy-time",
] as const;
export type CrazyTimeSpot = (typeof CRAZY_TIME_TYPES)[number];
export const CRAZY_TIME_SPOTS = [
  { id: "1", label: "1", short: "1", color: "#ebba53", count: 21, profit: 1 },
  { id: "2", label: "2", short: "2", color: "#44a9df", count: 13, profit: 2 },
  { id: "5", label: "5", short: "5", color: "#db669a", count: 7, profit: 5 },
  {
    id: "10",
    label: "10",
    short: "10",
    color: "#a978db",
    count: 4,
    profit: 10,
  },
  {
    id: "coin-flip",
    label: "Coin Flip",
    short: "CF",
    color: "#4281ec",
    count: 4,
    profit: null,
  },
  {
    id: "cash-hunt",
    label: "Cash Hunt",
    short: "CH",
    color: "#48b77c",
    count: 2,
    profit: null,
  },
  {
    id: "pachinko",
    label: "Pachinko",
    short: "P",
    color: "#e69c4b",
    count: 2,
    profit: null,
  },
  {
    id: "crazy-time",
    label: "Crazy Time",
    short: "CT",
    color: "#e04f67",
    count: 1,
    profit: null,
  },
] as const;
// Stable interleaving: both the visible wheel and the server use this exact order.
export const CRAZY_TIME_WHEEL: CrazyTimeSpot[] = CRAZY_TIME_SPOTS.flatMap((s) =>
  Array.from({ length: s.count }, (_, i) => ({
    id: s.id,
    position: (i + 0.5) / s.count,
  })),
)
  .sort((a, b) => a.position - b.position)
  .map((s) => s.id);
export const CRAZY_TOP_PRIZES = [
  [2, 900],
  [3, 90],
  [5, 8],
  [10, 2],
] as const;
export const CRAZY_COIN_PRIZES = [
  [2, 10],
  [3, 10],
  [5, 20],
  [7, 15],
  [10, 20],
  [15, 15],
  [20, 5],
  [25, 3],
  [50, 1],
  [100, 1],
] as const;
export const CRAZY_CASH_PRIZES = [
  [5, 11],
  [10, 20],
  [15, 25],
  [20, 20],
  [25, 15],
  [50, 5],
  [100, 3],
  [200, 1],
] as const;
export const CRAZY_WHEEL_PRIZES = [
  [10, 15],
  [15, 20],
  [20, 25],
  [25, 20],
  [50, 10],
  [100, 9],
  [200, 1],
] as const;
/** Exact long-run return per spot, including the stake; not a session guarantee. */
export const CRAZY_TIME_BASE_RTP = Object.fromEntries(
  CRAZY_TIME_SPOTS.map((spot) => {
    const prizes: readonly (readonly [number, number])[] =
      spot.profit != null
        ? [[spot.profit, 1]]
        : spot.id === "coin-flip"
          ? CRAZY_COIN_PRIZES
          : spot.id === "crazy-time"
            ? CRAZY_WHEEL_PRIZES
            : CRAZY_CASH_PRIZES;
    const boosts =
      spot.id === "pachinko"
        ? [
            [1, 0.95],
            [2, 0.0475],
            [4, 0.0025],
          ]
        : spot.id === "crazy-time"
          ? [
              [1, 0.8],
              [2, 0.08],
              [3, 0.08],
              [4, 0.01],
              [6, 0.02],
              [9, 0.01],
            ]
          : [[1, 1]];
    const top = [
      [1, 7 / 8],
      ...CRAZY_TOP_PRIZES.map(([value, weight]) => [value, weight / 8000]),
    ];
    const totalWeight = prizes.reduce((sum, [, weight]) => sum + weight, 0);
    let expectedProfit = 0;
    for (const [prize, weight] of prizes)
      for (const [boost, probability] of boosts)
        for (const [multiplier, chance] of top)
          expectedProfit +=
            ((Math.min(5000, prize * boost * multiplier) * weight) /
              totalWeight) *
            probability *
            chance;
    return [spot.id, ((1 + expectedProfit) * spot.count) / 54];
  }),
) as Record<CrazyTimeSpot, number>;
export type CrazyTimeBonus =
  | { kind: "coin-flip"; sides: [number, number]; side: 0 | 1 }
  | { kind: "cash-hunt"; grid: number[] }
  | {
      kind: "pachinko";
      slots: number[];
      path: number[];
      slot: number;
      doubles: number;
    }
  | {
      kind: "crazy-time";
      pointers: [number, number, number];
      boosts: number[];
    };
export interface CrazyTimeOutcome {
  version: 1;
  segment: number;
  winner: CrazyTimeSpot;
  topSlot: { spot: CrazyTimeSpot; multiplier: number };
  bonus: CrazyTimeBonus | null;
}
export interface CrazyTimeBet {
  type: CrazyTimeSpot;
  amountPaise: string;
  /** Cash Hunt cell 0..107 or Crazy Time pointer 0..2, locked with the wager. */
  choice?: number;
}
/** Profit odds; original stake is also returned on a win. */
export function crazyTimeProfit(outcome: CrazyTimeOutcome, choice = 0): number {
  const bonus = outcome.bonus;
  let prize: number;
  if (!bonus) prize = Number(outcome.winner);
  else if (bonus.kind === "coin-flip") prize = bonus.sides[bonus.side];
  else if (bonus.kind === "cash-hunt") prize = bonus.grid[choice] ?? 0;
  else if (bonus.kind === "pachinko")
    prize = bonus.slots[bonus.slot] * 2 ** bonus.doubles;
  else prize = bonus.pointers[choice] ?? 0;
  const boost =
    outcome.topSlot.spot === outcome.winner ? outcome.topSlot.multiplier : 1;
  return Math.min(CRAZY_TIME_MAX_RETURN - 1, prize * boost);
}

/** Display and settlement share the adjusted total return; legacy audits use v1. */
export const CRAZY_TIME_RTP = Object.fromEntries(CRAZY_TIME_TYPES.map(type => [type, .85])) as Record<CrazyTimeSpot, number>;
export function crazyTimeReturn(outcome: CrazyTimeOutcome, choice = 0, payoutVersion = 2) {
  const total = 1 + crazyTimeProfit(outcome, choice);
  return payoutVersion === 1 ? total : Math.min(CRAZY_TIME_MAX_RETURN, Math.floor(total * .85 / CRAZY_TIME_BASE_RTP[outcome.winner] * 10000) / 10000);
}
