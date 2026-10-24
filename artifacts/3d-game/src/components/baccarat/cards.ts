import { BACCARAT_PAYTABLE, type BaccaratBetType } from "@workspace/api-zod/baccarat-game";
export type { BaccaratBetType } from "@workspace/api-zod/baccarat-game";
/**
 * Baccarat client-side card helpers. Card encoding matches the server:
 * shoe card id 0..415; `id % 52` is the canonical card, rank =
 * (id % 52) % 13 with 0=A .. 12=K; suit = floor((id % 52) / 13).
 */

export interface PlacedBaccaratBet {
  type: BaccaratBetType;
  amount: number; // rupees
}

export const BET_LABELS: Record<BaccaratBetType, string> = {
  player: "Player",
  banker: "Banker",
  tie: "Tie",
  playerPair: "P Pair",
  bankerPair: "B Pair",
  score1_4: "Score 1-4",
  score5_6: "Score 5-6",
  score7: "Score 7",
  score8: "Score 8",
  score9: "Score 9",
};

export const profitOdds = (totalReturn: number) => `${Number((totalReturn - 1).toFixed(2))}:1`;
export const BET_PAYOUT_LABELS = Object.fromEntries(Object.entries(BACCARAT_PAYTABLE).map(([key, value]) => [key, profitOdds(value / 100)])) as Record<BaccaratBetType, string>;

const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
] as const;
const SUITS = ["♠", "♥", "♦", "♣"] as const;

export function cardRankLabel(card: number): string {
  return RANKS[(card % 52) % 13]!;
}

export function cardSuitSymbol(card: number): string {
  return SUITS[Math.floor((card % 52) / 13)]!;
}

export function cardIsRed(card: number): boolean {
  const s = Math.floor((card % 52) / 13);
  return s === 1 || s === 2; // hearts, diamonds
}

export function baccaratCardValue(card: number): number {
  const r = (card % 52) % 13;
  if (r === 0) return 1;
  if (r <= 8) return r + 1;
  return 0;
}
