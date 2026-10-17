import type { SportId } from "./catalog.mjs";
import type { MatchFixture } from './fixtures.mjs';
export interface MatchEvent {
  at: number;
  team: number;
  points: number;
  text: string;
  kind: string;
  score: number[];
  order?: number[];
}
export interface Round {
  fixture?: MatchFixture;
  id: string;
  sport: SportId;
  starts: number;
  closes: number;
  ends: number;
  next: number;
  phase: "betting" | "live" | "result";
  odds: number[];
  events: MatchEvent[];
  score: number[];
  winner: number | null;
  order: number[];
}
export interface SportsBet {
  fixture?: MatchFixture;
  selectionName?: string;
  id: string;
  requestId: string;
  roundId: string;
  sport: SportId;
  choice: number;
  stake: number;
  odds: number;
  status: "pending" | "won" | "lost";
  payout: number;
  created: number;
}
export interface SportsState {
  mode?: "practice" | "wallet";
  currency?: "INR";
  accountId?: string;
  serverTime: number;
  account: { balance: number; refillAt: number };
  rounds: Round[];
  matches?: Round[];
  bets: SportsBet[];
  results: { id: string; sport: SportId; winner: number; score: number[]; fixture?:MatchFixture }[];
}
export interface BetInput {
  requestId: string;
  roundId: string;
  sport: SportId;
  choice: number;
  stake: number;
}
export class SportsError extends Error {
  status: number;
}
export function makeMatch(sport: import("./catalog.mjs").Sport): {
  winner: number;
  events: MatchEvent[];
  score: number[];
};
export function createSportsStore(
  filename: string,
  options?: { now?: () => number },
): {
  state(id: string): SportsState;
  place(id: string, input: unknown): SportsState;
  refill(id: string): SportsState;
  session(token?: string): { token: string; accountId: string };
  tick(): void;
  close(): void;
};
