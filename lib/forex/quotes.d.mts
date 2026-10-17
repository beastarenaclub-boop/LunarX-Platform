export interface MarketQuote {
  key: string;
  name: string;
  symbol: string;
  unit: string;
  delayMinutes: number;
  source: string;
  sourceUrl: string;
  price: number | null;
  previousClose: number | null;
  changePercent: number | null;
  quotedAt: number | null;
  checkedAt: number | null;
  status: "delayed" | "stale" | "unavailable";
  ticks: { time: number; price: number }[];
}
export interface QuoteSnapshot {
  serverTime: number;
  refreshMs: number;
  quotes: Record<string, MarketQuote>;
}
export const QUOTE_REFRESH_MS: number;
export const QUOTE_MARKETS: Record<string, Pick<MarketQuote, "key" | "name" | "symbol" | "unit" | "delayMinutes">>;
export function parseGoogleQuote(html: string, key: string, now?: number): Pick<MarketQuote, "price" | "previousClose" | "changePercent" | "quotedAt" | "ticks">;
export function createQuoteFeed(options?: { fetch?: typeof fetch; now?: () => number }): { read(): Promise<QuoteSnapshot> };
export const forexQuoteFeed: ReturnType<typeof createQuoteFeed>;
