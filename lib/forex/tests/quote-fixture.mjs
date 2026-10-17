import { QUOTE_MARKETS } from "../quotes.mjs";
// Deterministic test data only. Runtime never imports this fixture.
export function quoteFixture(time = Date.now()) {
  return { serverTime: time, refreshMs: 30_000, quotes: Object.fromEntries(Object.entries(QUOTE_MARKETS).map(([id, spec], index) => {
    const price = id === "gold" ? 4200.25 : id === "eurusd" ? 1.12345 : 30 + index;
    return [id, { ...spec, source: "Google Finance", sourceUrl: `https://www.google.com/finance/quote/${spec.key}`,
      price, previousClose: price / 1.01, changePercent: 1, quotedAt: time - 180_000, checkedAt: time, status: "delayed",
      ticks: Array.from({ length: 61 }, (_, i) => ({ time: time - 180_000 - (60 - i) * 60_000, price: price * (1 - (60 - i) / 6000) })) }];
  })) };
}
