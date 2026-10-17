export type Side = "andar" | "bahar";
export const RANGES = [
  ["range1_5", 1, 5],
  ["range6_10", 6, 10],
  ["range11_15", 11, 15],
  ["range16_25", 16, 25],
  ["range26_30", 26, 30],
  ["range31_35", 31, 35],
  ["range36_40", 36, 40],
  ["range41_49", 41, 49],
] as const;
export type Spot = Side | (typeof RANGES)[number][0];
export type Slip = Partial<Record<Spot, number>>;
export type Bet = { type: Spot; amountPaise: string };
export interface Deal {
  joker: number;
  andarCards: number[];
  baharCards: number[];
  firstSide: Side;
  winner: Side;
  cardsDealt: number;
}
export interface TableConfig {
  enabled: boolean;
  maxBetsPerDeal: number;
  maxMultiplier: number;
  maxStakePaise: string;
  payouts: {
    firstSide: number;
    secondSide: number;
    ranges: Record<string, { min: number; max: number; multiplier: number }>;
  };
}
export interface HistoryRound {
  id: string;
  winner: Side;
  joker: number;
  cardsDealt: number;
  totalStake: string;
  payoutAmount: string;
  createdAt: string;
}
export const total = (slip: Slip) =>
  Object.values(slip).reduce((a, b) => a + (b ?? 0), 0);
export const money = (n: number | string) =>
  `₹${(Number(n) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const label = (spot: Spot) =>
  spot === "andar"
    ? "Andar"
    : spot === "bahar"
      ? "Bahar"
      : spot.replace("range", "").replace("_", "–");
export const fromBets = (bets: Bet[]) =>
  bets.reduce<Slip>(
    (slip, b) => ({
      ...slip,
      [b.type]: (slip[b.type] ?? 0) + Number(b.amountPaise),
    }),
    {},
  );
export function orderedCards(deal: Deal) {
  const result: { side: Side; card: number; index: number }[] = [];
  for (let i = 0; i < deal.cardsDealt; i++) {
    const side =
      i % 2 === 0
        ? deal.firstSide
        : deal.firstSide === "andar"
          ? "bahar"
          : "andar";
    const index = Math.floor(i / 2);
    result.push({
      side,
      card: (side === "andar" ? deal.andarCards : deal.baharCards)[index],
      index,
    });
  }
  return result;
}
