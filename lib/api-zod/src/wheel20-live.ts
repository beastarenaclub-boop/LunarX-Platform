/** Wheel 2.0's independent, versioned paytable. Amounts are integer paise. */
export const W20_GAME = "wheel-2-live";
export const W20_VERSION = 1;
export const W20_TIMING = {
  bettingWindowMs: 20_000,
  revealDurationMs: 14_000,
  settleDurationMs: 6_000,
};
export const W20_SPOTS = [
  "1",
  "2",
  "5",
  "8",
  "10",
  "15",
  "20",
  "30",
  "40",
] as const;
export type W20Spot = (typeof W20_SPOTS)[number];
export type W20Bet = { spot: W20Spot; amountPaise: string };
export const W20_COLORS: Record<W20Spot, string> = {
  "1": "#fff2b4",
  "2": "#ffc835",
  "5": "#71b5f0",
  "8": "#c36be6",
  "10": "#f47783",
  "15": "#ff9c3d",
  "20": "#54d9a3",
  "30": "#ec86d1",
  "40": "#b7a2ff",
};
// Interleave the 54 physical segments; the same array drives server and renderer.
export const W20_WHEEL: readonly W20Spot[] = [
  "1",
  "2",
  "1",
  "5",
  "2",
  "1",
  "8",
  "1",
  "10",
  "2",
  "1",
  "5",
  "15",
  "20",
  "1",
  "2",
  "1",
  "2",
  "1",
  "5",
  "8",
  "1",
  "2",
  "1",
  "1",
  "2",
  "5",
  "10",
  "30",
  "40",
  "1",
  "2",
  "1",
  "8",
  "1",
  "5",
  "2",
  "1",
  "2",
  "1",
  "15",
  "20",
  "1",
  "5",
  "2",
  "1",
  "10",
  "8",
  "1",
  "2",
  "1",
  "5",
  "2",
  "1",
];
export const W20_BOOSTS = [2, 3, 5, 8] as const;
export type W20Outcome = {
  version: number;
  segment: number;
  winner: W20Spot;
  boostSpot: W20Spot;
  boost: number;
};
export const W20_PROFIT = Object.fromEntries(
  W20_SPOTS.map((s) => [s, `${s}:1`]),
) as Record<W20Spot, string>;
export function validW20Outcome(o: W20Outcome): boolean {
  return (
    !!o &&
    o.version === W20_VERSION &&
    Number.isInteger(o.segment) &&
    o.segment >= 0 &&
    o.segment < W20_WHEEL.length &&
    o.winner === W20_WHEEL[o.segment] &&
    W20_SPOTS.includes(o.boostSpot) &&
    (W20_BOOSTS as readonly number[]).includes(o.boost)
  );
}
export function normalizeW20Bets(raw: W20Bet[]): W20Bet[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 9)
    throw new Error("Select between one and nine bets.");
  const seen = new Set<string>();
  for (const b of raw) {
    if (!b || !W20_SPOTS.includes(b.spot) || seen.has(b.spot))
      throw new Error("Invalid or duplicate selection.");
    if (
      typeof b.amountPaise !== "string" ||
      !/^[1-9]\d{0,14}$/.test(b.amountPaise)
    )
      throw new Error("Invalid stake.");
    seen.add(b.spot);
  }
  return raw
    .map((b) => ({ spot: b.spot, amountPaise: b.amountPaise }))
    .sort((a, b) => Number(a.spot) - Number(b.spot));
}
export const w20Stake = (bets: W20Bet[]) =>
  bets.reduce((n, b) => n + BigInt(b.amountPaise), 0n);
export const w20Profit = (o: W20Outcome) =>
  Number(o.winner) * (o.winner === o.boostSpot ? o.boost : 1);
export function w20Payout(
  bets: W20Bet[],
  outcome: W20Outcome,
  version = W20_VERSION,
): bigint {
  if (version !== W20_VERSION || !validW20Outcome(outcome))
    throw new Error("Invalid Wheel 2.0 outcome or paytable version");
  return normalizeW20Bets(bets).reduce(
    (sum, b) =>
      sum +
      (b.spot === outcome.winner
        ? BigInt(b.amountPaise) * BigInt(w20Profit(outcome) + 1)
        : 0n),
    0n,
  );
}
// One uniformly selected boost spot each round; 2x/3x/5x/8x weights 75/20/4/1.
export const W20_RTP = Object.fromEntries(
  W20_SPOTS.map((s) => [
    s,
    (W20_WHEEL.filter((v) => v === s).length / W20_WHEEL.length) *
      (1 + Number(s) * (1 + 1.38 / 9)),
  ]),
) as Record<W20Spot, number>;
export type W20History = {
  roundId: string;
  outcome: W20Outcome | null;
  bets: W20Bet[];
  totalStake: string;
  payoutAmount: string;
  status: string;
  createdAt: string;
};
