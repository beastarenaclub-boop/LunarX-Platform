/** Shared public contract. Odds are decimal TOTAL returns, including the stake. */
export const OD_GAME = "dragon-tiger-one-day";
export const OD_TIMING = {
  first: 20_000,
  revealDragon: 3_000,
  second: 15_000,
  revealTiger: 3_000,
  result: 7_000,
};
export const OD_MAX_STAKE = 500_000; // paise, per round across both windows
export const OD_RTP = 0.95;
export type ODStage = "first" | "second";
export type ODPhase = ODStage | "dragon-reveal" | "tiger-reveal" | "result";
export const OD_RANKS = [
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
];
export const OD_SUITS = ["♠", "♥", "♦", "♣"];
export interface ODMarket {
  id: string;
  label: string;
  group: string;
  side: "match" | "dragon" | "tiger";
}
const cardOptions = [
  ["odd", "Odd", "Odd / Even"],
  ["even", "Even", "Odd / Even"],
  ["red", "Red", "Colour"],
  ["black", "Black", "Colour"],
  ["low", "Low · A–6", "Size"],
  ["seven", "Seven", "Size"],
  ["high", "High · 8–K", "Size"],
  ["spades", "♠ Spades", "Suit"],
  ["hearts", "♥ Hearts", "Suit"],
  ["diamonds", "♦ Diamonds", "Suit"],
  ["clubs", "♣ Clubs", "Suit"],
  ["face", "Face · J Q K", "Card type"],
  ["number", "Number · A–10", "Card type"],
  ...OD_RANKS.map((rank, i) => [`rank-${i + 1}`, rank, "Exact rank"]),
];
export const OD_MARKETS: ODMarket[] = [
  { id: "dragon", label: "Dragon", group: "Match winner", side: "match" },
  { id: "tiger", label: "Tiger", group: "Match winner", side: "match" },
  { id: "tie", label: "Tie", group: "Match winner", side: "match" },
  {
    id: "suited-tie",
    label: "Suited tie",
    group: "Match winner",
    side: "match",
  },
  ...(["dragon", "tiger"] as const).flatMap((side) =>
    cardOptions.map(([id, label, group]) => ({
      id: `${side}-${id}`,
      label,
      group,
      side,
    })),
  ),
];
export interface ODQuote extends ODMarket {
  oddsHundredths: number;
  probability: number;
  available: boolean;
}
export interface ODSelection {
  market: string;
  amountPaise: string;
}
export interface ODAcceptedSelection extends ODSelection {
  oddsHundredths: number;
}
export interface ODSlip {
  id: number;
  roundId: number;
  stage: ODStage;
  selections: ODAcceptedSelection[];
  stakePaise: string;
  payoutPaise: string | null;
}
export interface ODPublicRound {
  id: number;
  phase: ODPhase;
  phaseEndsAt: number;
  firstClosesAt: number;
  secondOpensAt: number;
  secondClosesAt: number;
  revealsAt: number;
  endsAt: number;
  commitment: string;
  dragon?: number;
  tiger?: number;
  winner?: "dragon" | "tiger" | "tie";
  nonce?: string;
}
export interface ODTable {
  serverNow: number;
  balancePaise: string;
  round: ODPublicRound;
  quoteId: string;
  quotes: ODQuote[];
  slips: ODSlip[];
  history: {
    id: number;
    dragon: number;
    tiger: number;
    winner: "dragon" | "tiger" | "tie";
  }[];
  recent: ODSlip[];
}
