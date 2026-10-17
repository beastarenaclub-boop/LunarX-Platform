// Fictional starting quotes shared by the prediction game and its standalone preview, never a price feed.
export const MARKETS = [
  {
    id: "gold",
    name: "Gold",
    symbol: "XAU/USD",
    category: "Metals",
    icon: "Au",
    color: "#e8bf62",
    seed: 2684.5,
    decimals: 2,
    volatility: 0.003,
  },
  {
    id: "silver",
    name: "Silver",
    symbol: "XAG/USD",
    category: "Metals",
    icon: "Ag",
    color: "#becbdd",
    seed: 31.42,
    decimals: 3,
    volatility: 0.004,
  },
  {
    id: "platinum",
    name: "Platinum",
    symbol: "XPT/USD",
    category: "Metals",
    icon: "Pt",
    color: "#a9c6d4",
    seed: 982.6,
    decimals: 2,
    volatility: 0.0035,
  },
  {
    id: "copper",
    name: "Copper",
    symbol: "XCU/USD",
    category: "Metals",
    icon: "Cu",
    color: "#d99b77",
    seed: 4.38,
    decimals: 4,
    volatility: 0.004,
  },
  {
    id: "eurusd",
    name: "Euro / US Dollar",
    symbol: "EUR/USD",
    category: "Forex",
    icon: "€",
    color: "#7b9dff",
    seed: 1.08462,
    decimals: 5,
    volatility: 0.001,
  },
  {
    id: "gbpusd",
    name: "Pound / US Dollar",
    symbol: "GBP/USD",
    category: "Forex",
    icon: "£",
    color: "#b8a1f5",
    seed: 1.29634,
    decimals: 5,
    volatility: 0.0012,
  },
  {
    id: "usdjpy",
    name: "US Dollar / Yen",
    symbol: "USD/JPY",
    category: "Forex",
    icon: "¥",
    color: "#ef9aaf",
    seed: 149.286,
    decimals: 3,
    volatility: 0.001,
  },
  {
    id: "usdinr",
    name: "US Dollar / Rupee",
    symbol: "USD/INR",
    category: "Forex",
    icon: "₹",
    color: "#f5af75",
    seed: 83.947,
    decimals: 3,
    volatility: 0.001,
  },
  {
    id: "oil",
    name: "Crude Oil",
    symbol: "WTI/USD",
    category: "Energy",
    icon: "Oil",
    color: "#86b9da",
    seed: 72.86,
    decimals: 2,
    volatility: 0.004,
  },
  {
    id: "gas",
    name: "Natural Gas",
    symbol: "GAS/USD",
    category: "Energy",
    icon: "Gas",
    color: "#76d8c5",
    seed: 2.874,
    decimals: 3,
    volatility: 0.005,
  },
  {
    id: "bitcoin",
    name: "Bitcoin",
    symbol: "BTC/USD",
    category: "Crypto",
    icon: "₿",
    color: "#f1aa55",
    seed: 67432.8,
    decimals: 2,
    volatility: 0.006,
  },
  {
    id: "ethereum",
    name: "Ethereum",
    symbol: "ETH/USD",
    category: "Crypto",
    icon: "Ξ",
    color: "#9caff4",
    seed: 2648.32,
    decimals: 2,
    volatility: 0.006,
  },
];
export const ROUND_MS = 60_000;
export const ORDER_MS = 45_000;
export const STARTING_BALANCE = 10_000;
export const MAX_STAKE = 5_000;

export function outcomeFor(volume, total, count = MARKETS.length) {
  if (total === 0) return "up";
  if (volume * count === total) return "flat";
  return volume * count > total ? "down" : "up";
}

export function closingPrice(market, open, volume, total) {
  const direction = outcomeFor(volume, total);
  if (direction === "flat") return open;
  const average = total / MARKETS.length;
  const strength =
    total === 0
      ? 0.6
      : Math.min(1, Math.abs(volume - average) / Math.max(average, 1));
  const change = market.volatility * (0.25 + strength * 0.75);
  // Extra internal precision avoids a flat result on low-priced markets.
  return Number(
    (open * (1 + (direction === "up" ? change : -change))).toFixed(8),
  );
}

export function quoteAt(market, open, target, elapsed) {
  const p = Math.min(1, Math.max(0, elapsed / ROUND_MS));
  if (p === 0) return open;
  if (p === 1) return target;
  const phase = MARKETS.findIndex((asset) => asset.id === market.id) * 0.73;
  const wave =
    (Math.sin(p * Math.PI * 10 + phase) * 0.34 +
      Math.sin(p * Math.PI * 24 + phase * 0.5) * 0.1) *
    Math.sin(p * Math.PI) *
    open *
    market.volatility;
  return Number((open + (target - open) * p + wave).toFixed(8));
}

// The live chart uses the same simulated quotes as settlement, never future ticks.
export function quoteTrail(market, candles, open, target, start, elapsed) {
  const ticks = [];
  const previous = candles.at(-1);
  if (previous && !previous.warmup && previous.time === start - ROUND_MS) {
    for (let second = 0; second < 60; second++) {
      ticks.push({
        time: previous.time + second * 1000,
        price: quoteAt(market, previous.open, previous.close, second * 1000),
      });
    }
  }
  const duration = Math.max(0, Math.min(ROUND_MS, elapsed));
  for (let second = 0; second <= Math.floor(duration / 1000); second++) {
    ticks.push({
      time: start + second * 1000,
      price: quoteAt(market, open, target, second * 1000),
    });
  }
  if (duration % 1000 !== 0) {
    ticks.push({
      time: start + duration,
      price: quoteAt(market, open, target, duration),
    });
  }
  return ticks;
}
