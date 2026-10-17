import type { Candle, Direction, Market } from "./store.mjs";
export type Instrument = Omit<
  Market,
  "open" | "price" | "volume" | "direction" | "candles" | "ticks"
>;
export const MARKETS: Instrument[];
export const ROUND_MS: number;
export const ORDER_MS: number;
export const STARTING_BALANCE: number;
export const MAX_STAKE: number;
export function outcomeFor(
  volume: number,
  total: number,
  count?: number,
): Direction;
export function closingPrice(
  market: Instrument,
  open: number,
  volume: number,
  total: number,
): number;
export function quoteAt(
  market: Instrument,
  open: number,
  target: number,
  elapsed: number,
): number;
export function quoteTrail(
  market: Instrument,
  candles: Candle[],
  open: number,
  target: number,
  start: number,
  elapsed: number,
): NonNullable<Market["ticks"]>;
