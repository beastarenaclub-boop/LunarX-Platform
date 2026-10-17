export type Pick = "green" | "red" | "violet" | "big" | "small" | `${number}`;
export type History = {
  period: string;
  number: number;
  ends: number;
  commitment: string;
  secret: string;
};
export type Bet = {
  id: string;
  period: string;
  pick: Pick;
  stake: number;
  payout: number | null;
  created: number;
  duration: number;
  number: number | null;
};
export type GameState = {
  serverTime: number;
  player: { id: string; balance: number };
  round: {
    payoutVersion?: number;
    period: string;
    duration: number;
    start: number;
    ends: number;
    commitment: string;
  };
  history: History[];
  bets: Bet[];
  summary: { played: number; won: number; profit: number };
  pending: number;
  lockSeconds: number;
  minStake: number;
  maxStake: number;
};
