import assert from "node:assert/strict";
import { test } from "node:test";
import { SEVEN_SPOTS, normalizeSevenBets, sevenMultiplier, sevenPayout, sevenWins, type SevenBet } from "@workspace/api-zod/instant-collection";

test("every winning spot returns 198 paise per rupee, independent of the old RTP and cap", () => {
  for (const rtp of [.85, .97]) for (const cap of [1, 2, 1000]) for (const spot of SEVEN_SPOTS) {
    let wins = 0;
    assert.equal(sevenMultiplier(spot, rtp, cap), 1.98);
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
      const total = a + b;
      const won = spot === "down" ? total >= 2 && total <= 6 : spot === "up" ? total >= 8 && total <= 12 : spot === "seven" ? total === 7 : total === Number(spot);
      assert.equal(sevenPayout([{ spot, amount: "100" }], [a, b], rtp, cap), won ? 198n : 0n, `${spot} on ${a} + ${b}`);
      if (won) wins++;
    }
    assert.equal(wins, spot === "up" || spot === "down" ? 15 : spot === "seven" ? 6 : 6 - Math.abs(7 - Number(spot)));
  }
});

test("legacy rounds retain their original winning combinations and capped RTP", () => {
  for (const rtp of [.85, .97]) for (const spot of SEVEN_SPOTS) {
    let wins = 0, returns = 0n;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
      if (sevenWins(spot, a + b)) wins++;
      returns += sevenPayout([{ spot, amount: "1000000" }], [a, b], rtp, 1000, 1);
    }
    assert.equal(wins, spot === "up" || spot === "down" ? 15 : spot === "seven" ? 6 : 6 - Math.abs(7 - Number(spot)));
    assert(Number(returns) / 36000000 <= rtp + 1e-10);
    assert(Number(returns) / 36000000 >= rtp - .005);
    assert(sevenMultiplier(spot, rtp, 2, 1) <= 2);
  }
});
test("multiple winners pay on the same dice, rounded per spot without rounding the aggregate multiplier", () => {
  const slip: SevenBet[] = [{ spot: "up", amount: "101" }, { spot: "8", amount: "101" }, { spot: "seven", amount: "100" }];
  assert.equal(sevenPayout(slip, [5, 3], .97), 199n + 199n);
  assert.equal(sevenPayout(slip, [5, 2], .97), 198n);
  assert.equal(sevenPayout(slip, [1, 2], .97), 0n);
  assert.equal(sevenPayout(slip, [5, 3], .97, 2), 398n);
  assert.equal(sevenPayout(slip, [5, 3], .97, 1000, 1), 234n + 704n);
});
test("a complete number board returns its actual total, even below the stake", () => {
  const slip = SEVEN_SPOTS.filter(s => s !== "up" && s !== "down").map(spot => ({ spot, amount: "100" }));
  assert.equal(sevenPayout(slip, [3, 4], .97), 198n);
  assert.equal(slip.reduce((sum, b) => sum + BigInt(b.amount), 0n), 1100n);
});
test("slips reject malformed amounts, duplicate spots, missing bets and mismatched totals", () => {
  for (const bets of [[], [{ spot: "up", amount: "0" }], [{ spot: "up", amount: "-1" }], [{ spot: "up", amount: "1.5" }], [{ spot: "up", amount: "01" }], [{ spot: "13", amount: "100" }], [{ spot: "up", amount: "50" }, { spot: "up", amount: "50" }], [{ spot: "up", amount: "1000000000000000" }]]) {
    assert.throws(() => normalizeSevenBets(bets as SevenBet[], 100n));
  }
  assert.throws(() => normalizeSevenBets([{ spot: "up", amount: "100" }], 200n), /total/);
  assert.deepEqual(normalizeSevenBets([{ spot: "8", amount: "25" }, { spot: "up", amount: "75" }], 100n), [{ spot: "up", amount: "75" }, { spot: "8", amount: "25" }]);
});
