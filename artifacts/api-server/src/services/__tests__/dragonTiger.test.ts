import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  drawDragonTiger,
  dragonTigerWinner,
  dragonTigerStake,
  dragonTigerPayout,
  dragonTigerPayoutPaise,
} from "../dragonTigerMath";

test("Dragon Tiger: Ace low, King high, equal ranks tie across suits and decks", () => {
  assert.equal(dragonTigerWinner(0, 12), "tiger");
  assert.equal(dragonTigerWinner(51, 26), "dragon");
  assert.equal(dragonTigerWinner(12, 415), "tie");
  assert.equal(dragonTigerWinner(0, 13), "tie");
});

test("Dragon Tiger: eight-deck draw is without replacement at every boundary", () => {
  for (const first of [0, 1, 207, 414, 415]) {
    for (let second = 0; second < 415; second++) {
      const draws = [first, second];
      const pair = drawDragonTiger(() => draws.shift()!);
      assert.notEqual(pair.dragon, pair.tiger);
      assert.ok(pair.tiger >= 0 && pair.tiger < 416);
    }
  }
  for (let i = 0; i < 500; i++) {
    const pair = drawDragonTiger();
    assert.notEqual(pair.dragon, pair.tiger);
  }
});

test("Dragon Tiger: actual return includes stake; ties return half of both main bets", () => {
  const slip = { dragon: 100, tiger: 50, tie: 10 };
  assert.equal(dragonTigerStake(slip), 160);
  assert.equal(dragonTigerPayout(slip, "dragon"), 198);
  assert.equal(dragonTigerPayout(slip, "tiger"), 99);
  assert.equal(dragonTigerPayout(slip, "tie"), 205);
  assert.equal(dragonTigerPayout({ dragon: 10, tiger: 0, tie: 0 }, "tie"), 5);
});

test("Dragon Tiger: 98 paise main profit and 12 rupees tie profit preserve every paise", () => {
  for (let stake = 10; stake <= 5000; stake += 10) {
    for (const side of ["dragon", "tiger"] as const) {
      const spots = { dragon: 0, tiger: 0, tie: 0, [side]: stake };
      assert.equal(dragonTigerPayoutPaise(spots, side), BigInt(stake * 198));
      assert.equal(dragonTigerPayoutPaise(spots, side === "dragon" ? "tiger" : "dragon"), 0n);
    }
    assert.equal(dragonTigerPayoutPaise({ dragon: 0, tiger: 0, tie: stake }, "tie"), BigInt(stake * 1300));
  }
  assert.equal(dragonTigerPayout({ dragon: 10, tiger: 0, tie: 0 }, "dragon"), 19.8);
  assert.equal(dragonTigerPayout({ dragon: 0, tiger: 110, tie: 0 }, "tiger"), 217.8);
});

test("Dragon Tiger: an existing round keeps the rates accepted before migration", () => {
  const legacy = { mainProfitPaisePerRupee: 100, tieProfitPaisePerRupee: 1100 };
  const spots = { dragon: 100, tiger: 50, tie: 10 };
  assert.equal(dragonTigerPayoutPaise(spots, "dragon", legacy), 20000n);
  assert.equal(dragonTigerPayoutPaise(spots, "tie", legacy), 19500n);
});

test("Dragon Tiger: malformed, fractional, negative and excessive stakes are rejected", () => {
  for (const amount of [-10, 1, 5, 15, 10.5, NaN, Infinity, 5010])
    assert.throws(() => dragonTigerStake({ dragon: amount, tiger: 0, tie: 0 }));
  assert.throws(() => dragonTigerStake({ dragon: 0, tiger: 0, tie: 0 }));
  assert.throws(() => dragonTigerStake({ dragon: 3000, tiger: 3000, tie: 0 }));
  assert.equal(dragonTigerStake({ dragon: 5000, tiger: 0, tie: 0 }), 5000);
});
