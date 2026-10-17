// Display-only Google Finance quotes. Never used to decide pool-game payouts.
export const QUOTE_REFRESH_MS = 30_000;
export const QUOTE_MARKETS = {
  gold: { key: "GCW00:COMEX", name: "Gold Futures", symbol: "GC · COMEX", unit: "USD / troy oz", delayMinutes: 10 },
  silver: { key: "SIW00:COMEX", name: "Silver Futures", symbol: "SI · COMEX", unit: "USD / troy oz", delayMinutes: 10 },
  platinum: { key: "PLW00:NYMEX", name: "Platinum Futures", symbol: "PL · NYMEX", unit: "USD / troy oz", delayMinutes: 10 },
  copper: { key: "HGW00:COMEX", name: "Copper Futures", symbol: "HG · COMEX", unit: "USD / lb", delayMinutes: 10 },
  eurusd: { key: "EUR-USD", name: "Euro / US Dollar", symbol: "EUR/USD", unit: "USD / EUR", delayMinutes: 3 },
  gbpusd: { key: "GBP-USD", name: "Pound / US Dollar", symbol: "GBP/USD", unit: "USD / GBP", delayMinutes: 3 },
  usdjpy: { key: "USD-JPY", name: "US Dollar / Yen", symbol: "USD/JPY", unit: "JPY / USD", delayMinutes: 3 },
  usdinr: { key: "USD-INR", name: "US Dollar / Rupee", symbol: "USD/INR", unit: "INR / USD", delayMinutes: 3 },
  oil: { key: "CLW00:NYMEX", name: "Crude Oil Futures", symbol: "CL · NYMEX", unit: "USD / barrel", delayMinutes: 10 },
  gas: { key: "NGW00:NYMEX", name: "Natural Gas Futures", symbol: "NG · NYMEX", unit: "USD / MMBtu", delayMinutes: 10 },
  bitcoin: { key: "BTC-USD", name: "Bitcoin", symbol: "BTC/USD", unit: "USD / BTC", delayMinutes: 3 },
  ethereum: { key: "ETH-USD", name: "Ethereum", symbol: "ETH/USD", unit: "USD / ETH", delayMinutes: 3 },
};

const positive = value => typeof value === "number" && Number.isFinite(value) && value > 0;
function visit(value, fn) {
  if (!Array.isArray(value)) return;
  fn(value);
  for (const child of value) if (Array.isArray(child)) visit(child, fn);
}

export function parseGoogleQuote(html, key, now = Date.now()) {
  // Parse only JSON data literals. Never execute third-party page JavaScript.
  const payloads = [];
  for (const match of html.matchAll(/<script\b[^>]*>\s*AF_initDataCallback\(([\s\S]*?)<\/script>/g)) {
    const start = match[1].indexOf("data:");
    const end = match[1].lastIndexOf(", sideChannel:");
    if (start < 0 || end < start) continue;
    try { payloads.push(JSON.parse(match[1].slice(start + 5, end))); } catch { /* fail closed if Google changes its format */ }
  }
  let record;
  for (const payload of payloads) visit(payload, node => {
    if (node[21] !== key || !positive(node[5]?.[0]) || !positive(node[11]?.[0])) return;
    if (!record || node[11][0] > record[11][0]) record = node;
  });
  if (!record) throw new Error("Google Finance quote unavailable");
  const quotedAt = record[11][0] * 1000;
  if (quotedAt > now + 60_000 || quotedAt < Date.UTC(2000, 0, 1)) throw new Error("Invalid quote time");
  const ticks = new Map();
  for (const payload of payloads) visit(payload, node => {
    if (node[1] !== record[0] || !Array.isArray(node[3])) return;
    for (const segment of node[3]) {
      // Intraday series have explicit start/end dates. Daily/monthly points are not minute candles.
      if (!Array.isArray(segment?.[0]?.[1])) continue;
      for (const point of segment[1] || []) {
        const date = point?.[0], price = point?.[1]?.[0];
        if (!Array.isArray(date) || date[0] < 2000 || !positive(price)) continue;
        const offset = date[7]?.[0] ?? record[13] ?? 0;
        const time = Date.UTC(date[0], date[1] - 1, date[2], date[3] ?? 0, date[4] ?? 0, date[5] ?? 0) - offset * 1000;
        if (Number.isFinite(time) && time <= quotedAt && time >= quotedAt - 24 * 60 * 60_000) ticks.set(time, price);
      }
    }
  });
  ticks.set(quotedAt, record[5][0]);
  return {
    price: record[5][0],
    previousClose: positive(record[7]) ? record[7] : null,
    changePercent: Number.isFinite(record[5][2]) ? record[5][2] : null,
    quotedAt,
    ticks: [...ticks].sort((a, b) => a[0] - b[0]).slice(-1500).map(([time, price]) => ({ time, price })),
  };
}

async function readPage(response) {
  if (!response.ok) throw new Error(`Google Finance HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4_000_000) throw new Error("Quote page exceeds size limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => {}); }
}

export function createQuoteFeed({ fetch: fetchPage = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map();
  let inFlight;
  const snapshot = () => ({
    serverTime: now(), refreshMs: QUOTE_REFRESH_MS,
    quotes: Object.fromEntries(Object.entries(QUOTE_MARKETS).map(([id, spec]) => {
      const entry = cache.get(id);
      const quote = entry?.quote;
      const stale = quote && (entry.error || now() - quote.quotedAt > (spec.delayMinutes + 5) * 60_000 || now() - entry.checkedAt > QUOTE_REFRESH_MS * 3);
      return [id, {
        ...spec, source: "Google Finance", sourceUrl: `https://www.google.com/finance/quote/${spec.key}`,
        price: null, previousClose: null, changePercent: null, quotedAt: null, ticks: [], ...quote,
        checkedAt: entry?.checkedAt ?? null,
        status: !quote ? "unavailable" : stale ? "stale" : "delayed",
      }];
    })),
  });
  async function read() {
    if (inFlight) return inFlight;
    const due = Object.entries(QUOTE_MARKETS).filter(([id]) => (cache.get(id)?.nextAt ?? 0) <= now());
    if (!due.length) return snapshot();
    inFlight = (async () => {
      // Limit outbound concurrency; a single refresh is shared by all users in this process.
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, due.length) }, async () => {
        while (index < due.length) {
          const [id, spec] = due[index++];
          const old = cache.get(id);
          try {
            const response = await fetchPage(`https://www.google.com/finance/quote/${spec.key}`, {
              signal: AbortSignal.timeout(8000),
              headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9", "Cache-Control": "no-cache" },
            });
            const quote = parseGoogleQuote(await readPage(response), spec.key, now());
            if (old?.quote && quote.quotedAt < old.quote.quotedAt) throw new Error("Out-of-order quote");
            cache.set(id, { quote, checkedAt: now(), nextAt: now() + QUOTE_REFRESH_MS, errors: 0, error: false });
          } catch {
            const errors = (old?.errors ?? 0) + 1;
            cache.set(id, { ...old, errors, error: true, nextAt: now() + Math.min(300_000, QUOTE_REFRESH_MS * 2 ** (errors - 1)) });
          }
        }
      }));
      return snapshot();
    })();
    try { return await inFlight; } finally { inFlight = undefined; }
  }
  return { read };
}

export const forexQuoteFeed = createQuoteFeed();
