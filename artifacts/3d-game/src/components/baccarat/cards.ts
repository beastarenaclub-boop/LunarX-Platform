import { BACCARAT_RETURNS } from "@workspace/api-zod/game-economics";
/**
 * Baccarat client-side card helpers. Card encoding matches the server:
 * shoe card id 0..415; `id % 52` is the canonical card, rank =
 * (id % 52) % 13 with 0=A .. 12=K; suit = floor((id % 52) / 13).
 */

export type BaccaratBetType =
  | "player"
  | "banker"
  | "tie"
  | "playerPair"
  | "bankerPair";

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
};

export const BET_PAYOUT_LABELS = Object.fromEntries(Object.entries(BACCARAT_RETURNS).map(([key, value]) => [key, `${(value / 100).toFixed(2)}× return`])) as Record<BaccaratBetType, string>;

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
