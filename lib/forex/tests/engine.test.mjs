import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createForexStore } from "../store.mjs";
import {
  MARKETS,
  ROUND_MS,
  closingPrice,
  outcomeFor,
  quoteAt,
} from "../market.mjs";

function setup(t, filename = ":memory:") {
  let time = 1_800_000_000_000;
  const store = createForexStore(filename, { now: () => time });
  t.after(() => store.close());
  let counter = 0;
  const order = (user, asset, side, amount, extra = {}) =>
    store.place(user, {
      asset,
      side,
      amount,
      roundId: store.state(user).round.id,
      requestId: `request-${++counter}`,
      ...extra,
    });
  return {
    store,
    order,
    setTime: (value) => (time = value),
    advance: (ms) => (time += ms),
    time: () => time,
  };
}

test("asset total, not BUY/SELL imbalance, determines direction; all 12 assets count", (t) => {
  const { store, order } = setup(t);
  order("a", "gold", "sell", 1200);
  const state = order("b", "silver", "buy", 100);
  assert.equal(state.pool.average, 1300 / 12);
  assert.equal(state.assets.find((m) => m.id === "gold").direction, "down");
  assert.equal(state.assets.find((m) => m.id === "silver").direction, "up");
  assert.equal(state.assets.find((m) => m.id === "eurusd").direction, "up");
  assert.equal(state.pool.participants, 2);
  assert.equal(store.state("a").account.balance, 8800);
});

test("exact payout, losing stake, refund, and repeat settlement preserve balances", (t) => {
  const { store, order, advance } = setup(t);
  order("winner", "gold", "sell", 1000);
  order("loser", "gold", "buy", 100);
  order("silver", "silver", "buy", 10);
  advance(60_001);
  assert.equal(store.state("winner").account.balance, 10900);
  assert.equal(store.state("loser").account.balance, 9900);
  assert.equal(store.state("silver").account.balance, 10009);
  assert.equal(store.state("winner").trades[0].status, "won");
  for (let i = 0; i < 4; i++) store.tick();
  assert.equal(store.state("winner").account.balance, 10900);
  assert.equal(store.state("winner").results[0].assets.gold.direction, "down");
  const result = store.state("winner").results[0].assets;
  assert.ok(result.gold.close < result.gold.open);
  assert.ok(result.silver.close > result.silver.open);
});

test("empty rounds grow the market without paying spectators; equal funded pools still refund", (t) => {
  const { store, order, advance } = setup(t);
  advance(60_000);
  assert.equal(store.state("a").results[0].total, 0);
  assert.ok(
    Object.values(store.state("a").results[0].assets).every(
      (a) => a.direction === "up" && a.close > a.open,
    ),
  );
  assert.equal(store.state("a").account.balance, 10000);
  assert.equal(store.state("a").account.profit, 0);
  assert.equal(store.state("a").account.wins, 0);
  assert.equal(store.state("a").trades.length, 0);
  for (const market of MARKETS) order("a", market.id, "buy", 100);
  assert.ok(store.state("a").assets.every((m) => m.direction === "flat"));
  advance(60_000);
  const state = store.state("a");
  assert.equal(state.account.balance, 10000);
  assert.equal(state.account.profit, 0);
  assert.equal(state.trades.filter((t) => t.status === "refund").length, 12);
});

test("live quotes rise and pull back, stay finite, and end at the settlement price", () => {
  for (const market of MARKETS) {
    for (const [volume, total] of [
      [0, 0],
      [1200, 1200],
      [100, 1200],
    ]) {
      const close = closingPrice(market, market.seed, volume, total);
      const prices = Array.from({ length: 61 }, (_, i) =>
        quoteAt(market, market.seed, close, i * 1000),
      );
      assert.equal(prices[0], market.seed);
      assert.equal(prices.at(-1), close);
      assert.ok(prices.every((price) => Number.isFinite(price) && price > 0));
      assert.ok(
        prices.some((price, i) => i > 0 && price > prices[i - 1]),
        `${market.id} has rising ticks`,
      );
      assert.ok(
        prices.some((price, i) => i > 0 && price < prices[i - 1]),
        `${market.id} has falling ticks`,
      );
    }
  }
});

test("live trail grows with time and carries the previous round across settlement", (t) => {
  const { store, advance, time } = setup(t);
  const first = store.state("viewer");
  advance(35_500);
  const active = store.state("viewer");
  for (const market of active.assets) {
    assert.equal(market.ticks.length, 37);
    assert.equal(market.ticks.at(-1).time, time());
    assert.equal(market.ticks.at(-1).price, market.price);
    assert.ok(
      market.ticks.every(
        (tick, i, ticks) =>
          tick.time <= time() && (!i || tick.time > ticks[i - 1].time),
      ),
    );
  }
  advance(ROUND_MS - 35_500 + 5000);
  const next = store.state("viewer");
  for (const market of next.assets) {
    assert.equal(market.ticks[0].time, first.round.start);
    assert.equal(
      market.ticks[60].price,
      next.results[0].assets[market.id].close,
    );
    assert.equal(market.ticks.at(-1).price, market.price);
    assert.ok(
      market.open > first.assets.find((asset) => asset.id === market.id).open,
    );
  }
  advance(ROUND_MS);
  assert.ok(
    store
      .state("viewer")
      .assets.every((market, i) => market.open > next.assets[i].open),
  );
  assert.equal(store.state("viewer").account.profit, 0);
});

test("idempotent retries debit once, including after cutoff and settlement", (t) => {
  const { store, order, advance } = setup(t);
  const before = store.state("a");
  const input = {
    asset: "gold",
    side: "sell",
    amount: 100,
    roundId: before.round.id,
    requestId: "same-request",
  };
  store.place("a", input);
  store.place("a", input);
  assert.equal(store.state("a").account.balance, 9900);
  assert.equal(store.state("a").trades.length, 1);
  assert.throws(
    () => store.place("a", { ...input, amount: 200 }),
    /already used/,
  );
  advance(46_000);
  store.place("a", input);
  advance(15_000);
  store.place("a", input);
  assert.equal(store.state("a").account.balance, 10090);
  assert.equal(store.state("a").trades.length, 1);
  order("b", "gold", "sell", 100);
});

test("cutoff, stale round, invalid amount and insufficient funds are rejected without debit", (t) => {
  const { store, order, advance } = setup(t);
  for (const amount of [0, -10, 10.5, 11, NaN, Infinity, 5001, "100", null])
    assert.throws(() => order("a", "gold", "buy", amount), /multiples/);
  assert.throws(() => order("a", "fake", "buy", 100), /valid asset/);
  assert.throws(() => order("a", "gold", "invalid", 100), /valid asset/);
  assert.throws(() => order("a", "gold", "buy", 100, { roundId: 1 }), /locked/);
  assert.equal(store.state("a").account.balance, 10000);
  order("a", "gold", "buy", 5000);
  order("a", "gold", "buy", 5000);
  assert.throws(() => order("a", "gold", "buy", 10), /Not enough/);
  advance(45_000);
  assert.throws(() => order("b", "silver", "buy", 10), /locked/);
  assert.equal(store.state("b").account.balance, 10000);
});

test("new stakes can flip the asset signal; cutoff freezes the accepted pool", (t) => {
  const { store, order, advance } = setup(t);
  order("a", "gold", "sell", 100);
  assert.equal(store.state("a").assets[0].direction, "down");
  order("b", "bitcoin", "buy", 2000);
  assert.equal(store.state("a").assets[0].direction, "up");
  advance(45_000);
  const locked = store.state("a");
  assert.equal(locked.round.phase, "locked");
  assert.throws(() => order("a", "gold", "buy", 5000), /locked/);
  advance(15_000);
  assert.equal(store.state("a").results[0].assets.gold.direction, "up");
});

test("refill is bounded, disallows open trades and keeps history", (t) => {
  const { store, order, advance } = setup(t);
  assert.throws(() => store.refill("a"), /already/);
  order("a", "gold", "buy", 100);
  assert.throws(() => store.refill("a"), /open positions/);
  advance(60_000);
  const state = store.refill("a");
  assert.equal(state.account.balance, 10000);
  assert.equal(state.trades.length, 1);
  assert.equal(state.account.profit, -100);
});

test("disk persistence settles missed round once after restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "aurum-test-"));
  const filename = join(dir, "forex.sqlite");
  let store;
  try {
    let time = 1_800_000_000_000;
    store = createForexStore(filename, { now: () => time });
    const { id, token } = store.createSession();
    store.place(id, {
      asset: "gold",
      side: "sell",
      amount: 100,
      roundId: store.state(id).round.id,
      requestId: "restart-test",
    });
    store.close();
    store = null;
    time += 4 * 86400_000;
    store = createForexStore(filename, { now: () => time });
    assert.equal(store.session(token), id);
    assert.equal(store.state(id).account.balance, 10090);
    assert.equal(store.state(id).results.length, 1);
    assert.equal(store.state(id).round.start, time);
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("independent connections share wallet and round state without duplicate payout", () => {
  const dir = mkdtempSync(join(tmpdir(), "aurum-shared-"));
  const filename = join(dir, "shared.sqlite");
  let time = 1_800_000_000_000;
  const one = createForexStore(filename, { now: () => time });
  const two = createForexStore(filename, { now: () => time });
  try {
    one.place("a", {
      asset: "gold",
      side: "sell",
      amount: 100,
      roundId: one.state("a").round.id,
      requestId: "two-connections",
    });
    assert.equal(two.state("a").account.balance, 9900);
    assert.equal(two.state("b").pool.total, 100);
    time += 60_000;
    one.tick();
    two.tick();
    assert.equal(two.state("a").account.balance, 10090);
    assert.equal(one.state("a").trades[0].status, "won");
  } finally {
    one.close();
    two.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("comparison handles exact ties without floating-point threshold error", () => {
  assert.equal(outcomeFor(100, 1200), "flat");
  assert.equal(outcomeFor(100, 1190), "down");
  assert.equal(outcomeFor(100, 1210), "up");
});
