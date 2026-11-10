/** Platform Ice Fish rules, version 1. The reference supplies the visual design;
 * these published payout rules are independently implemented, not provider math. */
export const ICE_FISH_VERSION = 1;
export const ICE_FISH_TIMING = {
  bettingWindowMs: 12000,
  revealDurationMs: 14000,
  settleDurationMs: 4000,
} as const;
export const ICE_FISH_SPOTS = [
  "white",
  "grey",
  "blue",
  "green",
  "red",
] as const;
export type IceFishSpot = (typeof ICE_FISH_SPOTS)[number];
export const ICE_FISH_LABELS: Record<IceFishSpot, string> = {
  white: "White anchor",
  grey: "Grey anchor",
  blue: "LIL’ BLUES",
  green: "BIG GREEN",
  red: "HUGE REDS",
};
let anchor = 0;
export const ICE_FISH_WHEEL: readonly IceFishSpot[] = Array.from(
  { length: 45 },
  (_, i) =>
    [3, 16, 30, 43].includes(i)
      ? "blue"
      : [10, 37].includes(i)
        ? "green"
        : i === 22
          ? "red"
          : anchor++ % 2 === 0
            ? "white"
            : "grey",
);
export const ICE_FISH_COUNTS = {
  white: 19,
  grey: 19,
  blue: 4,
  green: 2,
  red: 1,
} as const;
export const ICE_FISH_VALUES = {
  blue: [3, 5, 10, 20, 50, 100],
  green: [5, 10, 20, 50, 100, 200],
  red: [10, 20, 50, 100, 200, 500],
} as const;
export const ICE_FISH_WEIGHTS = [50, 25, 15, 7, 2, 1] as const;
// Exact natural-draw expected raw returns. Fish boost: 90% 1x, 10% uniform 2..10x.
export const ICE_FISH_RAW_RTP = {
  white: [955n, 1000n],
  grey: [955n, 1000n],
  blue: [102n, 100n],
  green: [31n, 30n],
  red: [67n, 60n],
} as const;
export interface IceFishOutcome {
  version: 1;
  segment: number;
  boosts: number[];
  fishValue: number;
}
export interface IceFishBet {
  type: IceFishSpot;
  amountPaise: string;
}
export function isFish(spot: IceFishSpot): spot is "blue" | "green" | "red" {
  return spot === "blue" || spot === "green" || spot === "red";
}
export function iceFishBets(raw: unknown): IceFishBet[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100)
    throw new Error("INVALID_ICE_FISH_BET");
  return raw.map((b) => {
    if (
      !b ||
      typeof b !== "object" ||
      !ICE_FISH_SPOTS.includes(b.type) ||
      typeof b.amountPaise !== "string" ||
      !/^\d{1,12}$/.test(b.amountPaise) ||
      BigInt(b.amountPaise) < 1n
    )
      throw new Error("INVALID_ICE_FISH_BET");
    return { type: b.type, amountPaise: b.amountPaise };
  });
}
export function iceFishRawReturn(outcome: IceFishOutcome) {
  const spot = ICE_FISH_WHEEL[outcome.segment],
    boost = outcome.boosts[outcome.segment];
  return isFish(spot) ? outcome.fishValue * boost : 1 + boost;
}
export function iceFishMultiplier(outcome: IceFishOutcome, houseEdge = 0.045) {
  const spot = ICE_FISH_WHEEL[outcome.segment],
    [num, den] = ICE_FISH_RAW_RTP[spot];
  return (
    (iceFishRawReturn(outcome) * (1 - houseEdge) * Number(den)) / Number(num)
  );
}
export function settleIceFish(
  raw: unknown,
  outcome: IceFishOutcome,
  houseEdge = 0.045,
  cap = 5000,
) {
  const bets = iceFishBets(raw),
    winner = ICE_FISH_WHEEL[outcome.segment];
  if (!winner || outcome.version !== 1 || outcome.boosts.length !== 45)
    throw new Error("INVALID_ICE_FISH_RESULT");
  const rtpBps = BigInt(Math.round((1 - houseEdge) * 10000)),
    [num, den] = ICE_FISH_RAW_RTP[winner];
  const rawReturn = BigInt(iceFishRawReturn(outcome));
  const settled = bets.map((bet) => {
    const amount = BigInt(bet.amountPaise),
      payout =
        bet.type === winner
          ? (amount * rawReturn * rtpBps * den) / (10000n * num)
          : 0n;
    const max = (amount * BigInt(Math.floor(cap * 10000))) / 10000n;
    return { ...bet, payoutPaise: (payout < max ? payout : max).toString() };
  });
  return {
    settled,
    totalStake: bets.reduce((n, b) => n + BigInt(b.amountPaise), 0n),
    totalPayout: settled.reduce((n, b) => n + BigInt(b.payoutPaise), 0n),
  };
}
