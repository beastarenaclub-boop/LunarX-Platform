/** Twenty seconds to bet, followed by dealing and the result hold. */
export const BACCARAT_ROUND_TIMING = Object.freeze({
  bettingWindowMs: 20_000,
  revealDurationMs: 8_000,
  settleDurationMs: 2_000,
});

/** Score markets use the winning hand's final total. Every score bet loses on a tie. */
export const BACCARAT_SCORE_BETS = [
  { type: "score1_4", label: "Score 1-4", min: 1, max: 4 },
  { type: "score5_6", label: "Score 5-6", min: 5, max: 6 },
  { type: "score7", label: "Score 7", min: 7, max: 7 },
  { type: "score8", label: "Score 8", min: 8, max: 8 },
  { type: "score9", label: "Score 9", min: 9, max: 9 },
] as const;
export type BaccaratScoreBetType = (typeof BACCARAT_SCORE_BETS)[number]["type"];

/** Fixed reference odds, including returned stake, in hundredths. */
export const BACCARAT_SCORE_RETURNS: Record<BaccaratScoreBetType, number> = {
  score1_4: 850,
  score5_6: 500,
  score7: 550,
  score8: 400,
  score9: 350,
};

export const BACCARAT_BET_TYPES = [
  "player", "banker", "tie", "playerPair", "bankerPair",
  "score1_4", "score5_6", "score7", "score8", "score9",
] as const;
export type BaccaratBetType = (typeof BACCARAT_BET_TYPES)[number];

/** Reference rules: even-money main bets, with half profit on a Banker 6 win. */
export const BACCARAT_PAYOUT_VERSION = 3;
export const BACCARAT_BANKER_SIX_RETURN = 150;
export const BACCARAT_PAYTABLE: Record<BaccaratBetType, number> = {
  player: 200,
  banker: 200,
  tie: 900,
  playerPair: 1200,
  bankerPair: 1200,
  ...BACCARAT_SCORE_RETURNS,
};
export interface BaccaratPayouts {
  payoutVersion: number;
  /** Total returns, including stake. */
  payouts: Record<BaccaratBetType, number>;
  bankerSixReturn: number;
}

export function baccaratWinningScoreBet(deal: {
  winner: "player" | "banker" | "tie";
  playerTotal: number;
  bankerTotal: number;
}): BaccaratScoreBetType | null {
  if (deal.winner === "tie") return null;
  const total = deal.winner === "player" ? deal.playerTotal : deal.bankerTotal;
  return BACCARAT_SCORE_BETS.find((spot) => total >= spot.min && total <= spot.max)?.type ?? null;
}
