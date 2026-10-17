import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LUCKY7_BET_TYPES,
  LUCKY7_TOTAL_COMBINATIONS,
  LUCKY7_WINNING_COMBINATIONS,
  lucky7Payouts as versionedPayouts,
  lucky7Result,
  lucky7ReturnHundredths as versionedHundredths,
  lucky7ReturnMultiplier as versionedMultiplier,
  settleLucky7Bets as versionedSettlement,
  type Lucky7BetInput,
  type Lucky7Roll,
  type Lucky7BetType,
} from "../lucky7Math";
import { deriveLucky7Outcome, sha256Hex } from "../rtp";

const EDGE = 0.03; // shipped default
const CAP = 12; // shipped maxMultiplier

// Preserve regression coverage for version 1 history and interrupted rounds.
const lucky7Payouts = (edge: number, cap: number) => versionedPayouts(edge, cap, 1);
const lucky7ReturnHundredths = (type: Lucky7BetType, edge: number, cap: number) => versionedHundredths(type, edge, cap, 1);
const lucky7ReturnMultiplier = (type: Lucky7BetType, edge: number, cap: number) => versionedMultiplier(type, edge, cap, 1);
const settleLucky7Bets = (bets: Lucky7BetInput[], roll: Lucky7Roll, edge: number, cap: number) => versionedSettlement(bets, roll, edge, cap, 1);

// ── Dice derivation ────────────────────────────────────────────────────────

test("derivation returns two dice in 1..6 and their total", () => {
  for (let nonce = 0; nonce < 200; nonce++) {
    const { dice, total } = deriveLucky7Outcome("server-seed", "client", nonce);
    assert.equal(dice.length, 2);
    for (const d of dice) {
      assert.ok(Number.isInteger(d), `die must be an integer, got ${d}`);
      assert.ok(d >= 1 && d <= 6, `die out of range: ${d}`);
    }
    assert.equal(total, dice[0]! + dice[1]!);
    assert.ok(total >= 2 && total <= 12);
  }
});

test("derivation is deterministic per seed tuple and moves with the nonce", () => {
  const a = deriveLucky7Outcome("s", "c", 7);
  const b = deriveLucky7Outcome("s", "c", 7);
  assert.deepEqual(a, b);

  // Different nonces must not all collapse to the same roll.
  const rolls = new Set(
    Array.from({ length: 50 }, (_, n) =>
      JSON.stringify(deriveLucky7Outcome("s", "c", n)),
    ),
  );
  assert.ok(rolls.size > 5, `derivation looks constant (${rolls.size} rolls)`);

  // Changing the client seed changes the stream.
  const withOtherClient = deriveLucky7Outcome("s", "other", 7);
  assert.notDeepEqual(a, withOtherClient);
});

test("two dice are uniform over the 36 combinations (chi-square sanity)", () => {
  const counts = new Map<number, number>();
  const N = 36_000;
  for (let n = 0; n < N; n++) {
    const { dice } = deriveLucky7Outcome("uniformity", "seed", n);
    const key = dice[0]! * 10 + dice[1]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  assert.equal(counts.size, LUCKY7_TOTAL_COMBINATIONS);
  const expected = N / LUCKY7_TOTAL_COMBINATIONS;
  let chi2 = 0;
  for (const c of counts.values()) chi2 += (c - expected) ** 2 / expected;
  // 35 dof: the 99.9th percentile is ≈ 66.6 — a fair generator sits well below.
  assert.ok(chi2 < 66.6, `dice distribution looks skewed (chi2=${chi2})`);
});

// ── Spot resolution ────────────────────────────────────────────────────────

test("totals resolve to the correct spot", () => {
  for (let t = 2; t <= 6; t++) assert.equal(lucky7Result(t), "under");
  assert.equal(lucky7Result(7), "exactly");
  for (let t = 8; t <= 12; t++) assert.equal(lucky7Result(t), "over");
});

test("winning combinations match the two-dice distribution", () => {
  const tally: Record<Lucky7BetType, number> = { under: 0, exactly: 0, over: 0 };
  for (let d1 = 1; d1 <= 6; d1++) {
    for (let d2 = 1; d2 <= 6; d2++) tally[lucky7Result(d1 + d2)] += 1;
  }
  assert.deepEqual(tally, LUCKY7_WINNING_COMBINATIONS);
  assert.equal(
    tally.under + tally.exactly + tally.over,
    LUCKY7_TOTAL_COMBINATIONS,
  );
});

// ── Edge-scaled payout math ────────────────────────────────────────────────

test("default 3% edge pays 2.33× under/over and 5.82× exactly-7", () => {
  assert.deepEqual(lucky7Payouts(EDGE, CAP), {
    under: 2.33,
    exactly: 5.82,
    over: 2.33,
  });
});

test("payouts move when the configured house edge moves", () => {
  // Zero edge → the fair price: 36/15 = 2.4×, 36/6 = 6×.
  assert.deepEqual(lucky7Payouts(0, CAP), { under: 2.4, exactly: 6, over: 2.4 });
  // Heavier edge → strictly smaller payouts on every spot.
  const fat = lucky7Payouts(0.1, CAP);
  assert.deepEqual(fat, { under: 2.16, exactly: 5.4, over: 2.16 });
  for (const type of LUCKY7_BET_TYPES) {
    assert.ok(
      fat[type] < lucky7Payouts(EDGE, CAP)[type],
      `${type} should shrink as the edge grows`,
    );
  }
});

test("payout = (1 − edge) × 36 / winning combinations for every spot and edge", () => {
  for (const edge of [0, 0.01, 0.03, 0.05, 0.12, 0.25]) {
    for (const type of LUCKY7_BET_TYPES) {
      const expected =
        Math.round(
          ((1 - edge) * LUCKY7_TOTAL_COMBINATIONS * 100) /
            LUCKY7_WINNING_COMBINATIONS[type],
        ) / 100;
      assert.equal(
        lucky7ReturnMultiplier(type, edge, 1000),
        expected,
        `${type} @ edge ${edge}`,
      );
    }
  }
});

test("absurd edges are clamped instead of producing negative payouts", () => {
  assert.equal(lucky7ReturnHundredths("under", -5, CAP) > 0n, true);
  assert.deepEqual(lucky7Payouts(-5, CAP), lucky7Payouts(0, CAP));
  // 99% edge is the floor of the clamp — still a positive payout.
  const crushed = lucky7Payouts(2, CAP);
  assert.ok(crushed.exactly > 0);
  assert.deepEqual(crushed, lucky7Payouts(0.99, CAP));
  assert.deepEqual(lucky7Payouts(Number.NaN, CAP), lucky7Payouts(0, CAP));
});

test("maxMultiplier caps the return (and never drops below 1×)", () => {
  // Cap of 3 truncates exactly-7 (5.82×) but leaves under/over (2.33×) alone.
  assert.deepEqual(lucky7Payouts(EDGE, 3), {
    under: 2.33,
    exactly: 3,
    over: 2.33,
  });
  // A nonsense cap floors at 1× rather than zeroing out winners.
  assert.deepEqual(lucky7Payouts(EDGE, 0), { under: 1, exactly: 1, over: 1 });
});

test("settlement pays the winning spot only, in whole paise", () => {
  const bets = [
    { type: "under" as const, amountPaise: 1_000n },
    { type: "exactly" as const, amountPaise: 1_000n },
    { type: "over" as const, amountPaise: 1_000n },
  ];
  const res = settleLucky7Bets(bets, { dice: [1, 1], total: 2 }, EDGE, CAP);
  assert.equal(res.totalStake, 3_000n);
  assert.equal(res.totalPayout, 2_330n); // 1000 × 2.33
  assert.deepEqual(
    res.settled.map((b) => [b.type, b.payoutPaise, b.didWin]),
    [
      ["under", "2330", true],
      ["exactly", "0", false],
      ["over", "0", false],
    ],
  );

  const seven = settleLucky7Bets(bets, { dice: [3, 4], total: 7 }, EDGE, CAP);
  assert.equal(seven.totalPayout, 5_820n); // 1000 × 5.82

  const high = settleLucky7Bets(bets, { dice: [6, 6], total: 12 }, EDGE, CAP);
  assert.equal(high.totalPayout, 2_330n);
});

test("settlement floors fractional paise rather than rounding up", () => {
  // 7 paise × 2.33 = 16.31 → 16
  const res = settleLucky7Bets(
    [{ type: "under", amountPaise: 7n }],
    { dice: [1, 2], total: 3 },
    EDGE,
    CAP,
  );
  assert.equal(res.totalPayout, 16n);
});

test("settlement respects the round's max multiplier snapshot", () => {
  const capped = settleLucky7Bets(
    [{ type: "exactly", amountPaise: 1_000n }],
    { dice: [3, 4], total: 7 },
    EDGE,
    2, // operator lowered the cap below the exactly-7 return
  );
  assert.equal(capped.totalPayout, 2_000n);
});

test("bad bet types and stakes are rejected", () => {
  assert.throws(
    () =>
      settleLucky7Bets(
        [{ type: "sideways" as unknown as Lucky7BetType, amountPaise: 100n }],
        { dice: [1, 1], total: 2 },
        EDGE,
        CAP,
      ),
    /INVALID_LUCKY7_BET/,
  );
  assert.throws(
    () =>
      settleLucky7Bets(
        [{ type: "under", amountPaise: 0n }],
        { dice: [1, 1], total: 2 },
        EDGE,
        CAP,
      ),
    /INVALID_LUCKY7_BET/,
  );
});

// ── Realized RTP (Monte-Carlo over the real derivation) ────────────────────

for (const edge of [0.03, 0.08]) {
  test(`realized RTP tracks the configured ${edge * 100}% edge on every spot`, () => {
    const ROUNDS = 60_000;
    const STAKE = 10_000n; // large enough that flooring is negligible
    const staked: Record<Lucky7BetType, bigint> = {
      under: 0n,
      exactly: 0n,
      over: 0n,
    };
    const returned: Record<Lucky7BetType, bigint> = {
      under: 0n,
      exactly: 0n,
      over: 0n,
    };
    for (let n = 0; n < ROUNDS; n++) {
      const roll = deriveLucky7Outcome(`rtp-${edge}`, "client", n);
      for (const type of LUCKY7_BET_TYPES) {
        const { totalStake, totalPayout } = settleLucky7Bets(
          [{ type, amountPaise: STAKE }],
          roll,
          edge,
          CAP,
        );
        staked[type] += totalStake;
        returned[type] += totalPayout;
      }
    }
    for (const type of LUCKY7_BET_TYPES) {
      const rtp = Number(returned[type]) / Number(staked[type]);
      // Exactly-7 is the high-variance spot; 4 points of slack covers it at
      // this sample size while still catching a mispriced paytable.
      assert.ok(
        Math.abs(rtp - (1 - edge)) < 0.04,
        `${type} RTP ${rtp.toFixed(4)} should be ≈ ${(1 - edge).toFixed(2)}`,
      );
    }
  });
}

// ── Verify replay (pure half — the DB-backed half lives in the
//    tableRounds integration test) ──────────────────────────────────────────

test("a stored round can be replayed from its seeds alone", () => {
  const serverSeed = "9f8e7d6c5b4a39281706";
  const clientSeed = "player-chosen";
  const nonce = 41;
  const roll = deriveLucky7Outcome(serverSeed, clientSeed, nonce);
  const settled = settleLucky7Bets(
    [
      { type: "under", amountPaise: 2_500n },
      { type: "exactly", amountPaise: 500n },
    ],
    roll,
    EDGE,
    CAP,
  );

  // Replay: same seeds → same dice → same payout, and the commitment holds.
  const replayRoll = deriveLucky7Outcome(serverSeed, clientSeed, nonce);
  const replay = settleLucky7Bets(
    settled.settled.map((b) => ({
      type: b.type,
      amountPaise: BigInt(b.amountPaise),
    })),
    replayRoll,
    EDGE,
    CAP,
  );
  assert.deepEqual(replayRoll, roll);
  assert.equal(replay.totalPayout, settled.totalPayout);
  assert.deepEqual(replay.settled, settled.settled);
  assert.equal(sha256Hex(serverSeed).length, 64);
});
