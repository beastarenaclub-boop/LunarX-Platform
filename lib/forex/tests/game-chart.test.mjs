import test from "node:test";
import assert from "node:assert/strict";
import { gameIndexAt, updateGameTape, gameCandles, GAME_HISTORY_MS } from "../game-chart.mjs";
import { forexRequestId } from "../request-id.mjs";

const input = { asset: "gold", roundStart: 1_800_000, time: 1_830_000, direction: "up", idle: true };
test("idle chart has both candle directions without any market feed or wagers", () => {
  const tape = updateGameTape(undefined, input);
  const candles = gameCandles(tape.points);
  assert.ok(candles.length >= 80);
  assert.ok(candles.filter(c => c.close > c.open).length > 15);
  assert.ok(candles.filter(c => c.close < c.open).length > 15);
  assert.ok(tape.points.every(p => p.time <= input.time && Number.isFinite(p.price)));
});
test("pool changes append animation without rewriting earlier samples", () => {
  const original = updateGameTape(undefined, input);
  const next = updateGameTape(original, { ...input, direction: "down", idle: false, time: input.time + 1000 });
  assert.deepEqual(next.points.filter(p => p.time <= original.time), original.points.filter(p => p.time >= next.time - GAME_HISTORY_MS));
  assert.equal(next.points.length, 451);
  assert.notEqual(next.points.at(-1).price, original.points.at(-1).price);
  assert.deepEqual(updateGameTape(next, { ...input, time: next.time - 200 }).points, next.points);
});
test("funded chart ends on the existing pool direction and stops at the round end", () => {
  for (const [direction, target] of [["up",101.3], ["down",98.7], ["flat",100]]) {
    assert.equal(gameIndexAt({ ...input, idle: false, direction, time: input.roundStart + 60_000 }), target);
    const tape = updateGameTape(undefined, { ...input, idle: false, direction, time: input.roundStart + 90_000 });
    assert.equal(tape.time, input.roundStart + 60_000);
    assert.equal(tape.points.at(-1).price, target);
  }
});
test("candle aggregation retains sampled high/low and supports denser intervals", () => {
  const tape = updateGameTape(undefined, input);
  const fine = gameCandles(tape.points, 1), coarse = gameCandles(tape.points, 5);
  assert.ok(fine.length > coarse.length * 4);
  assert.ok(coarse.every(c => c.high >= c.open && c.high >= c.close && c.low <= c.open && c.low <= c.close));
});
test("order IDs work without secure-context randomUUID and fail visibly without crypto", () => {
  const cryptoSource = { getRandomValues: values => globalThis.crypto.getRandomValues(values) };
  const ids = Array.from({length: 50}, () => forexRequestId(cryptoSource));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => /^[a-f0-9]{32}$/.test(id)));
  assert.throws(() => forexRequestId({}), /Secure order ID unavailable/);
});
