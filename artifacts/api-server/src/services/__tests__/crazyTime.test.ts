import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CRAZY_TIME_SPOTS,
  CRAZY_TIME_WHEEL,
  CRAZY_TIME_TYPES,
  CRAZY_TIME_RTP,
  crazyTimeProfit,
  type CrazyTimeOutcome,
} from "@workspace/api-zod/crazy-time-game";
import {
  deriveCrazyTimeOutcome,
  settleCrazyTimeBets,
  validateCrazyTimeBets,
} from "../crazyTimeMath";

test("wheel has exactly 54 sectors and the published counts", () => {
  assert.equal(CRAZY_TIME_WHEEL.length, 54);
  for (const spot of CRAZY_TIME_SPOTS)
    assert.equal(
      CRAZY_TIME_WHEEL.filter((s) => s === spot.id).length,
      spot.count,
    );
  for (const rtp of Object.values(CRAZY_TIME_RTP))
    assert.ok(rtp > 0.75 && rtp < 1);
});
test("committed seed replays all eight outcomes and valid bonus boards", () => {
  const seen = new Set<string>();
  for (let nonce = 0; nonce < 700; nonce++) {
    const outcome = deriveCrazyTimeOutcome("test-server", "test-client", nonce);
    assert.deepEqual(
      outcome,
      deriveCrazyTimeOutcome("test-server", "test-client", nonce),
    );
    assert.equal(outcome.winner, CRAZY_TIME_WHEEL[outcome.segment]);
    seen.add(outcome.winner);
    if (outcome.bonus?.kind === "cash-hunt")
      assert.equal(outcome.bonus.grid.length, 108);
    if (outcome.bonus?.kind === "pachinko") {
      assert.equal(
        outcome.bonus.path.reduce((a, b) => a + b, 0),
        outcome.bonus.slot,
      );
      assert.equal(outcome.bonus.slots.length, 16);
      assert.ok(outcome.bonus.doubles <= 2);
    }
    if (outcome.bonus?.kind === "crazy-time") {
      assert.equal(outcome.bonus.pointers.length, 3);
      assert.ok(outcome.bonus.boosts.length <= 2);
    }
  }
  assert.deepEqual([...seen].sort(), [...CRAZY_TIME_TYPES].sort());
});
test("number returns include stake, top slot boosts only a matching winner, and losers pay zero", () => {
  const outcome: CrazyTimeOutcome = {
    version: 1,
    segment: 0,
    winner: "5",
    topSlot: { spot: "5", multiplier: 3 },
    bonus: null,
  };
  const result = settleCrazyTimeBets(
    [
      { type: "5", amountPaise: 101n },
      { type: "1", amountPaise: 100n },
    ],
    outcome,
  );
  assert.equal(result.totalPayout, 1616n);
  assert.equal(result.totalStake, 201n);
  assert.equal(result.settled[1].didWin, false);
  assert.equal(
    settleCrazyTimeBets([{ type: "5", amountPaise: 101n }], {
      ...outcome,
      topSlot: { spot: "1", multiplier: 10 },
    }).totalPayout,
    606n,
  );
});
test("cash cells, crazy pointers, coin sides and pachinko doubles determine exact prizes", () => {
  const base = {
    version: 1,
    segment: 0,
    topSlot: { spot: "1", multiplier: 2 },
  } as const;
  const cash: CrazyTimeOutcome = {
    ...base,
    winner: "cash-hunt",
    bonus: {
      kind: "cash-hunt",
      grid: Array.from({ length: 108 }, (_, i) => i + 1),
    },
  };
  assert.equal(
    settleCrazyTimeBets(
      [{ type: "cash-hunt", amountPaise: 100n, choice: 107 }],
      cash,
    ).totalPayout,
    10900n,
  );
  const crazy: CrazyTimeOutcome = {
    ...base,
    winner: "crazy-time",
    topSlot: { spot: "crazy-time", multiplier: 10 },
    bonus: { kind: "crazy-time", pointers: [10, 250, 900], boosts: [3, 3] },
  };
  assert.equal(crazyTimeProfit(crazy, 2), 5000);
  assert.equal(
    settleCrazyTimeBets(
      [{ type: "crazy-time", amountPaise: 1_000_000_000_000n, choice: 2 }],
      crazy,
    ).totalPayout,
    5_001_000_000_000_000n,
  );
  assert.equal(
    crazyTimeProfit({
      ...base,
      winner: "coin-flip",
      bonus: { kind: "coin-flip", sides: [7, 25], side: 1 },
    }),
    25,
  );
  assert.equal(
    crazyTimeProfit({
      ...base,
      winner: "pachinko",
      bonus: {
        kind: "pachinko",
        slots: [10, 25],
        slot: 1,
        path: [1],
        doubles: 2,
      },
    }),
    100,
  );
});
test("reject invalid/duplicate stakes, forged bonus picks and unsupported versions", () => {
  assert.throws(() => validateCrazyTimeBets([]), /NO_BETS/);
  assert.throws(
    () => validateCrazyTimeBets([{ type: "1", amountPaise: -100n }]),
    /STAKE_TOO_SMALL/,
  );
  assert.throws(
    () =>
      validateCrazyTimeBets([
        { type: "1", amountPaise: 100n },
        { type: "1", amountPaise: 100n },
      ]),
    /DUPLICATE/,
  );
  for (const [type, choice] of [
    ["1", 0],
    ["cash-hunt", 108],
    ["crazy-time", 3],
    ["cash-hunt", -0.1],
  ] as const)
    assert.throws(
      () => validateCrazyTimeBets([{ type, amountPaise: 100n, choice }]),
      /INVALID_BONUS_CHOICE/,
    );
  assert.throws(
    () => deriveCrazyTimeOutcome("a", "b", 0, 2 as 1),
    /INVALID_CRAZY_TIME_VERSION/,
  );
});
