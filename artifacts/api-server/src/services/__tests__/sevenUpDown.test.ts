import assert from "node:assert/strict";
import { test } from "node:test";
import { SEVEN_SPOTS, normalizeSevenBets, sevenMultiplier, sevenPayout, sevenWins, type SevenBet } from "@workspace/api-zod/instant-collection";

test("all 13 betting spots have the correct winning combinations and capped RTP", () => {
  for (const rtp of [.85, .97]) for (const spot of SEVEN_SPOTS) {
    let wins = 0, returns = 0n;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
      if (sevenWins(spot, a + b)) wins++;
      returns += sevenPayout([{ spot, amount: "1000000" }], [a, b], rtp);
    }
    assert.equal(wins, spot === "up" || spot === "down" ? 15 : spot === "seven" ? 6 : 6 - Math.abs(7 - Number(spot)));
    assert(Number(returns) / 36000000 <= rtp + 1e-10);
    assert(Number(returns) / 36000000 >= rtp - .005);
    assert(sevenMultiplier(spot, rtp, 2) <= 2);
  }
});
test("multiple winners pay on the same dice, rounded per spot without rounding the aggregate multiplier", () => {
  const slip: SevenBet[] = [{ spot: "up", amount: "101" }, { spot: "8", amount: "101" }, { spot: "seven", amount: "100" }];
  assert.equal(sevenPayout(slip, [5, 3], .97), 234n + 704n);
  assert.equal(sevenPayout(slip, [5, 2], .97), 582n);
  assert.equal(sevenPayout(slip, [1, 2], .97), 0n);
  assert.equal(sevenPayout(slip, [5, 3], .97, 2), 404n);
});
test("a complete number board returns its actual total, even below the stake", () => {
  const slip = SEVEN_SPOTS.filter(s => s !== "up" && s !== "down").map(spot => ({ spot, amount: "100" }));
  assert.equal(sevenPayout(slip, [3, 4], .97), 582n);
  assert.equal(slip.reduce((sum, b) => sum + BigInt(b.amount), 0n), 1100n);
});
test("slips reject malformed amounts, duplicate spots, missing bets and mismatched totals", () => {
  for (const bets of [[], [{ spot: "up", amount: "0" }], [{ spot: "up", amount: "-1" }], [{ spot: "up", amount: "1.5" }], [{ spot: "up", amount: "01" }], [{ spot: "13", amount: "100" }], [{ spot: "up", amount: "50" }, { spot: "up", amount: "50" }], [{ spot: "up", amount: "1000000000000000" }]]) {
    assert.throws(() => normalizeSevenBets(bets as SevenBet[], 100n));
  }
  assert.throws(() => normalizeSevenBets([{ spot: "up", amount: "100" }], 200n), /total/);
  assert.deepEqual(normalizeSevenBets([{ spot: "8", amount: "25" }, { spot: "up", amount: "75" }], 100n), [{ spot: "up", amount: "75" }, { spot: "8", amount: "25" }]);
});
