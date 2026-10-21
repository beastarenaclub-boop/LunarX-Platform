/** Public poker protocol. Amounts are integer paise; odds include returned stake. */
export const POKER_GAMES = [
  "poker-one-day",
  "poker-20-20",
  "poker-six-players",
] as const;
export type PokerGame = (typeof POKER_GAMES)[number];
export const POKER_TITLES: Record<PokerGame, string> = {
  "poker-one-day": "POKER 1-DAY",
  "poker-20-20": "20-20 POKER",
  "poker-six-players": "POKER 6 PLAYERS",
};
export const HAND_NAMES = [
  "High Card",
  "One Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
  "Royal Flush",
];
// Reference only supplies the two bonus paytables. Other prices/timings are
// explicit product defaults, not claimed to be the reference provider's rules.
export const POKER_CONFIG = {
  bettingMs: {
    "poker-one-day": 20_000,
    "poker-20-20": 20_000,
    "poker-six-players": 20_000,
  },
  dealMs: 2_000,
  streetMs: 3_000,
  resultMs: 7_000,
  minStakePaise: 1_000,
  maxStakePaise: 500_000,
  backOdds: 198,
  layOdds: 202,
  categoryOdds: [0, 220, 400, 2000, 2000, 3000, 3500, 50000, 300000],
  sixPlayerReturn: 0.95,
};
/** Profit multiples, exactly as shown in the supplied Poker 1-Day rules. */
export const TWO_CARD_BONUS = [
  { label: "Pair (2–10)", profit: 3 },
  { label: "A/Q or A/J Off Suited", profit: 5 },
  { label: "Pair (JQK)", profit: 10 },
  { label: "A/K Off Suited", profit: 15 },
  { label: "A/Q or A/J Suited", profit: 20 },
  { label: "A/K Suited", profit: 25 },
  { label: "A/A", profit: 30 },
];
export const SEVEN_CARD_BONUS = [
  { label: "Three of a Kind", profit: 3, category: 3 },
  { label: "Straight", profit: 4, category: 4 },
  { label: "Flush", profit: 6, category: 5 },
  { label: "Full House", profit: 8, category: 6 },
  { label: "Four of a Kind", profit: 30, category: 7 },
  { label: "Straight Flush", profit: 50, category: 8 },
  { label: "Royal Flush", profit: 100, category: 9 },
];
export type PokerPhase =
  | "betting"
  | "deal"
  | "flop"
  | "turn"
  | "river"
  | "result";
export interface PokerQuote {
  id: string;
  label: string;
  player: number;
  kind: "back" | "lay" | "bonus2" | "bonus7" | "category";
  odds: number;
  category?: number;
}
export interface PokerSelection {
  market: string;
  amountPaise: string;
}
export interface PokerAccepted extends PokerSelection {
  quote: PokerQuote;
  debitPaise: string;
}
export interface PokerBetInput {
  roundId: number;
  quoteId: string;
  requestId: string;
  selections: PokerSelection[];
}
export interface PokerSlip {
  id: number;
  requestId: string;
  roundId: number;
  selections: PokerAccepted[];
  stakePaise: string;
  payoutPaise: string | null;
}
export interface PokerOutcome {
  winners: number[];
  categories: number[];
}
export interface PokerPublicRound {
  id: number;
  game: PokerGame;
  phase: PokerPhase;
  phaseEndsAt: number;
  closesAt: number;
  revealsAt: number;
  endsAt: number;
  commitment: string;
  hands: (number | null)[][];
  board: (number | null)[];
  outcome?: PokerOutcome;
  nonce?: string;
}
export interface PokerTable {
  enabled: boolean;
  serverNow: number;
  balancePaise: string;
  round: PokerPublicRound;
  quoteId: string;
  quotes: PokerQuote[];
  slips: PokerSlip[];
  recent: PokerSlip[];
  history: { id: number; winners: number[]; categories: number[] }[];
}
export const playerName = (game: PokerGame, player: number) =>
  `Player ${game === "poker-six-players" ? player + 1 : player === 0 ? "A" : "B"}`;
export function selectionDebit(amount: bigint, quote: PokerQuote): bigint {
  // Lay stake is potential profit; the wallet reserves the full liability.
  return quote.kind === "lay"
    ? (amount * BigInt(quote.odds - 100) + 99n) / 100n
    : amount;
}
