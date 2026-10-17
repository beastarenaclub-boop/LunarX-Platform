import type { MarketQuote } from "./quotes.mjs";
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  warmup: boolean;
}
export type Direction = "up" | "down" | "flat";
export type Side = "buy" | "sell";
export interface Market {
  /** Display-only market data, independent of the pool settlement fields below. */
  quote?: MarketQuote;
  id: string;
  name: string;
  symbol: string;
  category: string;
  icon: string;
  color: string;
  seed: number;
  decimals: number;
  volatility: number;
  open: number;
  price: number;
  volume: number;
  direction: Direction;
  candles: Candle[];
  ticks?: { time: number; price: number }[];
}
export interface Trade {
  id: string;
  roundId: number;
  asset: string;
  side: Side;
  amount: number;
  status: "open" | "won" | "lost" | "refund";
  payout: number;
  opened: number;
  openPrice: number;
  closePrice: number | null;
}
export interface RoundResult {
  economicsVersion?: number;
  outcomeSeed?: string;
  roundId: number;
  time: number;
  total: number;
  average: number;
  assets: Record<
    string,
    { volume: number; direction: Direction; open: number; close: number }
  >;
}
export interface ForexState {
  mode?: "wallet";
  currency?: "INR";
  serverTime: number;
  round: {
    economicsVersion?: number;
    returnMultiplier?: number;
    commitment?: string;
    economicsVersion?: number;
    returnMultiplier?: number;
    commitment?: string;
    id: number;
    start: number;
    lockAt: number;
    endAt: number;
    phase: "open" | "locked";
  };
  assets: Market[];
  pool: {
    total: number;
    average: number;
    orders: number;
    participants: number;
  };
  account: {
    balance: number;
    settled: number;
    wins: number;
    profit: number;
  } | null;
  trades: Trade[];
  results: RoundResult[];
}
export class ForexFault extends Error {
  status: number;
  constructor(message: string, status?: number);
}
export function createForexStore(
  filename: string,
  options?: { now?: () => number },
): {
  tick(): unknown;
  state(id?: string | null): ForexState;
  session(token?: string): string | null;
  createSession(): { token: string; id: string };
  place(id: string, input: unknown): ForexState;
  refill(id: string): ForexState;
  close(): void;
};
