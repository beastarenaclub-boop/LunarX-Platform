import test from "node:test";
import assert from "node:assert/strict";
import { createQuoteFeed, parseGoogleQuote, QUOTE_MARKETS } from "../quotes.mjs";
import { createForexServer } from "../../../artifacts/3d-game/forex-server/server.mjs";

const now = Date.UTC(2026, 9, 4, 12);
function page(key, { price = 123.45, time = now - 180_000, extra = [] } = {}) {
  const record = Array(22).fill(null);
  record[0] = `/test/${key}`;
  record[5] = [price, 1.45, 1.18852];
  record[7] = 122;
  record[11] = [time / 1000];
  record[21] = key;
  return `<script>AF_initDataCallback({key: 'ds:2', hash: '7', data:${JSON.stringify([[record], ...extra])}, sideChannel: {}});</script>`;
}

test("Google parsing matches the requested instrument, timestamps and timezone, without executing scripts", () => {
  const series = [null, "/test/EUR-USD", "USD", [[
    [1, [2026, 10, 4], [2026, 10, 4]],
    [[[2026, 10, 4, 7, 55, null, null, [-14400]], [120]],
     [[2026, 10, 4, 7, 56, null, null, [-14400]], [121]],
     [[2026, 10, 4, 8, 30, null, null, [-14400]], [999]]],
  ]]];
  const html = page("BTC-USD", { price: 99 }) + page("EUR-USD", { extra: [series] }) + "<script>globalThis.quoteInjected = true</script>";
  const q = parseGoogleQuote(html, "EUR-USD", now);
  assert.equal(q.price, 123.45);
  assert.equal(q.previousClose, 122);
  assert.equal(q.quotedAt, now - 180_000);
  assert.deepEqual(q.ticks, [{ time: now - 300_000, price: 120 }, { time: now - 240_000, price: 121 }, { time: now - 180_000, price: 123.45 }]);
  assert.equal(globalThis.quoteInjected, undefined);
  assert.throws(() => parseGoogleQuote(html, "GBP-USD", now), /unavailable/);
});

test("malformed, null, nonpositive and future quotes fail closed", () => {
  for (const html of ["captcha", page("EUR-USD", { price: null }), page("EUR-USD", { price: 0 }), page("EUR-USD", { price: -1 }), page("EUR-USD", { time: now + 600_000 })]) {
    assert.throws(() => parseGoogleQuote(html, "EUR-USD", now));
  }
});

test("shared feed coalesces users, caches all 12 quotes, isolates errors and recovers without fake prices", async () => {
  let time = now, calls = 0, failedKey, regression = false;
  const feed = createQuoteFeed({ now: () => time, fetch: async url => {
    calls++;
    const key = url.split("/").at(-1);
    if (key === failedKey) return new Response("unavailable", { status: 503 });
    return new Response(page(key, { time: regression ? now - 600_000 : time - 180_000 }));
  } });
  const [first, same] = await Promise.all([feed.read(), feed.read()]);
  assert.deepEqual(first, same);
  assert.equal(calls, 12);
  assert.equal(Object.keys(first.quotes).length, 12);
  assert.equal(first.quotes.gold.name, "Gold Futures");
  assert.equal(first.quotes.gold.unit, "USD / troy oz");
  assert.equal(first.quotes.eurusd.status, "delayed");
  await feed.read();
  assert.equal(calls, 12);
  time += 30_000; failedKey = "EUR-USD";
  const failed = await feed.read();
  assert.equal(failed.quotes.eurusd.status, "stale");
  assert.equal(failed.quotes.eurusd.price, first.quotes.eurusd.price);
  assert.equal(failed.quotes.eurusd.quotedAt, first.quotes.eurusd.quotedAt);
  assert.equal(failed.quotes.eurusd.checkedAt, first.quotes.eurusd.checkedAt);
  assert.equal(failed.quotes.bitcoin.status, "delayed");
  time += 30_000; failedKey = undefined;
  const recovered = await feed.read();
  assert.equal(recovered.quotes.eurusd.status, "delayed");
  assert.ok(recovered.quotes.eurusd.quotedAt > first.quotes.eurusd.quotedAt);
  time += 30_000; regression = true;
  const older = await feed.read();
  assert.equal(older.quotes.eurusd.status, "stale");
  assert.equal(older.quotes.eurusd.quotedAt, recovered.quotes.eurusd.quotedAt);
});

test("initial outage returns unavailable, with bounded retries and no seeded fallback", async () => {
  let calls = 0, time = now;
  const feed = createQuoteFeed({ now: () => time, fetch: async () => { calls++; throw new Error("offline"); } });
  const state = await feed.read();
  for (const q of Object.values(state.quotes)) {
    assert.equal(q.price, null); assert.equal(q.quotedAt, null);
    assert.equal(q.status, "unavailable"); assert.deepEqual(q.ticks, []);
  }
  await feed.read(); assert.equal(calls, 12);
  time += 30_000; await feed.read(); assert.equal(calls, 24);
  time += 30_000; await feed.read(); assert.equal(calls, 24);
  time += 30_000; await feed.read(); assert.equal(calls, 36);
});

test("old weekend quotes retain their original time and display as last available", async () => {
  const feed = createQuoteFeed({ now: () => now, fetch: async url => new Response(page(url.split("/").at(-1), { time: now - 2 * 86400_000 })) });
  const q = (await feed.read()).quotes.gold;
  assert.equal(q.status, "stale");
  assert.equal(q.checkedAt, now);
  assert.equal(q.quotedAt, now - 2 * 86400_000);
});

test("quotes HTTP endpoint is separate from pool state and wallet mutations", async t => {
  const quotes = { serverTime: now, refreshMs: 30_000, quotes: {} };
  const server = createForexServer({ filename: ":memory:", now: () => now, quoteFeed: { read: async () => quotes } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${url}/api/forex/quotes`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), quotes);
  const state = await (await fetch(`${url}/api/forex/state`)).json();
  assert.equal(state.account, null);
  assert.equal(state.pool.total, 0);
  assert.equal(state.assets.length, Object.keys(QUOTE_MARKETS).length);
});
