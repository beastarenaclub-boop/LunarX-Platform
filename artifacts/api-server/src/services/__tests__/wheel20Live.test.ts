import { test } from "node:test";
import assert from "node:assert/strict";
import {
  W20_SPOTS,
  W20_WHEEL,
  W20_RTP,
  W20_BOOSTS,
  w20Payout,
  normalizeW20Bets,
  validW20Outcome,
} from "@workspace/api-zod/wheel20-live";
import { deriveW20Outcome } from "../wheel20LiveMath";

test("all 54 pockets, nine selections and four boosts settle exact integer returns", () => {
  assert.equal(W20_WHEEL.length, 54);
  for (let segment = 0; segment < 54; segment++)
    for (const boostSpot of W20_SPOTS)
      for (const boost of W20_BOOSTS) {
        const winner = W20_WHEEL[segment],
          outcome = { version: 1, segment, winner, boostSpot, boost };
        assert.ok(validW20Outcome(outcome));
        for (const spot of W20_SPOTS)
          assert.equal(
            w20Payout([{ spot, amountPaise: "1001" }], outcome),
            spot === winner
              ? 1001n *
                  (1n + BigInt(spot) * BigInt(winner === boostSpot ? boost : 1))
              : 0n,
          );
      }
  const o = {
    version: 1,
    segment: W20_WHEEL.indexOf("40"),
    winner: "40" as const,
    boostSpot: "40" as const,
    boost: 8,
  };
  assert.equal(
    w20Payout(
      [
        { spot: "40", amountPaise: "1000" },
        { spot: "1", amountPaise: "5000" },
      ],
      o,
    ),
    321000n,
  );
  assert.throws(() =>
    w20Payout([{ spot: "1", amountPaise: "1000" }], { ...o, winner: "1" }),
  );
  assert.throws(() => w20Payout([{ spot: "1", amountPaise: "1000" }], o, 2));
});
test("canonical receipts reject malformed, duplicate and out-of-range stakes", () => {
  assert.deepEqual(
    normalizeW20Bets([
      { spot: "20", amountPaise: "1000" },
      { spot: "1", amountPaise: "2000" },
    ]),
    [
      { spot: "1", amountPaise: "2000" },
      { spot: "20", amountPaise: "1000" },
    ],
  );
  for (const amountPaise of [
    "0",
    "01",
    "-10",
    "1.5",
    "NaN",
    "9999999999999999",
  ])
    assert.throws(() => normalizeW20Bets([{ spot: "1", amountPaise }]));
  assert.throws(() =>
    normalizeW20Bets([
      { spot: "1", amountPaise: "1" },
      { spot: "1", amountPaise: "2" },
    ]),
  );
  assert.throws(() => normalizeW20Bets([]));
  assert.throws(() =>
    normalizeW20Bets([{ spot: "3" as any, amountPaise: "1" }]),
  );
});
test("seed replay is deterministic and spans the complete wheel and boost set", () => {
  const segments = new Set<number>(),
    boosts = new Set<number>();
  for (let i = 0; i < 3000; i++) {
    const a = deriveW20Outcome("test-server-seed", "client", i);
    assert.deepEqual(a, deriveW20Outcome("test-server-seed", "client", i));
    assert.ok(validW20Outcome(a));
    segments.add(a.segment);
    boosts.add(a.boost);
  }
  assert.equal(segments.size, 54);
  assert.equal(boosts.size, 4);
  assert.notDeepEqual(
    deriveW20Outcome("a", "b", 1),
    deriveW20Outcome("a", "b", 2),
  );
});
test("published RTP agrees with complete weighted payout enumeration", () => {
  for (const spot of W20_SPOTS) {
    let returnTotal = 0;
    for (let segment = 0; segment < 54; segment++)
      for (const boostSpot of W20_SPOTS)
        for (const [boost, weight] of [
          [2, 75],
          [3, 20],
          [5, 4],
          [8, 1],
        ])
          returnTotal +=
            Number(
              w20Payout([{ spot, amountPaise: "100" }], {
                version: 1,
                segment,
                winner: W20_WHEEL[segment],
                boostSpot,
                boost,
              }),
            ) * weight;
    assert.ok(
      Math.abs(returnTotal / (54 * 9 * 100 * 100) - W20_RTP[spot]) < 1e-12,
    );
    assert.ok(W20_RTP[spot] > 0 && W20_RTP[spot] < 1);
  }
});
