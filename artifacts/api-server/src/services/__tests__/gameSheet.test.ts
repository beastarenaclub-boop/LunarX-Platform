import { test } from "node:test";
import assert from "node:assert/strict";
import { coinLiveMultiplier, collectionPayout, sevenPayout, SEVEN_SPOTS } from "@workspace/api-zod/instant-collection";
import { LUDO, ludoColors } from "@workspace/api-zod/ludo";

test("new Coin Flip wins credit stake plus 98% profit, while old rounds keep accepted RTP", () => {
  assert.equal(collectionPayout(10000n, coinLiveMultiplier(.85, 1000, 2)), 19800n);
  assert.equal(collectionPayout(10000n, coinLiveMultiplier(.85, 1000, 1)), 17000n);
  assert.equal(collectionPayout(10101n, coinLiveMultiplier(.97, 1000, 2)), 19999n);
});

test("7 Up Down settles every advertised winning spot at 1.98, once per staked spot", () => {
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
    for (const spot of SEVEN_SPOTS) {
      const sum = a + b;
      const wins = spot === "down" ? sum < 7 : spot === "up" ? sum > 7 : spot === "seven" ? sum === 7 : Number(spot) === sum;
      assert.equal(sevenPayout([{ spot, amount: "10000" }], [a, b], .85, 1000, 2), wins ? 19800n : 0n);
    }
  }
});

test("Ludo exposes all six requested entry fees and exactly 2, 3 or 4 distinct seats", () => {
  assert.deepEqual(LUDO.entries, [10000, 50000, 100000, 1000000, 2500000, 5000000]);
  for (const capacity of [2, 3, 4]) {
    assert.equal(ludoColors(capacity).length, capacity);
    assert.equal(new Set(ludoColors(capacity)).size, capacity);
  }
});
