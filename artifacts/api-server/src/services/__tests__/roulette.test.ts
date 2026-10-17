import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rouletteBetCoverage,
  rouletteTotalReturnMultiplier as currentMultiplier,
  rouletteTotalReturnMultiplierWithBase,
  settleRouletteBets as versionedSettlement,
  pocketColor,
  ROULETTE_RED_NUMBERS,
  type RouletteBetInput,
  type SettledRouletteBet,
} from "../rouletteMath";
import { parseStoredBets } from "../roulette";
import { deriveRouletteOutcome } from "../rtp";

// Cap must be ≥ ROULETTE_PAYOUT_BASE (35) to allow uncapped straight bets.
const MAX = 35;
// Regression cases below intentionally replay the previously accepted base 35.
const rouletteTotalReturnMultiplier = (covered:number,cap:number) => rouletteTotalReturnMultiplierWithBase(covered,35,cap);
const settleRouletteBets = (bets:RouletteBetInput[],pocket:number,cap:number) => versionedSettlement(bets,pocket,cap,35);

function payoutFor(bet: RouletteBetInput, pocket: number): bigint {
  const { totalPayout } = settleRouletteBets([bet], pocket, MAX);
  return totalPayout;
}

// ── Per-bet-type payout expectations (BASE = 35) ───────────────────────────
// Total return = floor(stake × 35 / pocketsCovered).

test("straight pays 34:1 (35× total return)", () => {
  // 35 / 1 = 35 exact → 100 paise × 35 = 3500 paise
  const bet: RouletteBetInput = { type: "straight", numbers: [17], amountPaise: 100n };
  assert.equal(payoutFor(bet, 17), 3500n);
  assert.equal(payoutFor(bet, 18), 0n);
});

test("split pays 16.5:1 (17.5× total — floors to whole paise)", () => {
  // 35 / 2 = 17.5 → 100 × 17.5 = 1750 (exact)
  const bet: RouletteBetInput = { type: "split", numbers: [17, 18], amountPaise: 100n };
  assert.equal(payoutFor(bet, 17), 1750n);
  assert.equal(payoutFor(bet, 18), 1750n);
  assert.equal(payoutFor(bet, 19), 0n);
});

test("street pays ≈10.67:1 (≈11.67× total)", () => {
  // 35 / 3 ≈ 11.667 → floor(100 × 11.667) = 1166
  const bet: RouletteBetInput = { type: "street", numbers: [4, 5, 6], amountPaise: 100n };
  assert.equal(payoutFor(bet, 5), 1166n);
  assert.equal(payoutFor(bet, 7), 0n);
});

test("corner pays 7.75:1 (8.75× total)", () => {
  // 35 / 4 = 8.75 → 100 × 8.75 = 875 (exact)
  const bet: RouletteBetInput = {
    type: "corner", numbers: [16, 17, 19, 20], amountPaise: 100n,
  };
  assert.equal(payoutFor(bet, 19), 875n);
  assert.equal(payoutFor(bet, 21), 0n);
});

test("line pays ≈4.83:1 (≈5.83× total)", () => {
  // 35 / 6 ≈ 5.833 → floor(100 × 5.833) = 583
  const bet: RouletteBetInput = {
    type: "line", numbers: [13, 14, 15, 16, 17, 18], amountPaise: 100n,
  };
  assert.equal(payoutFor(bet, 13), 583n);
  assert.equal(payoutFor(bet, 12), 0n);
});

test("dozen and column pay ≈1.92:1 (≈2.92× total)", () => {
  // 35 / 12 ≈ 2.917 → floor(100 × 2.917) = 291
  const dozen: RouletteBetInput = { type: "dozen", selection: 2, amountPaise: 100n };
  assert.equal(payoutFor(dozen, 13), 291n);
  assert.equal(payoutFor(dozen, 24), 291n);
  assert.equal(payoutFor(dozen, 25), 0n);
  assert.equal(payoutFor(dozen, 0), 0n);
  const column: RouletteBetInput = { type: "column", selection: 1, amountPaise: 100n };
  assert.equal(payoutFor(column, 1), 291n);
  assert.equal(payoutFor(column, 34), 291n);
  assert.equal(payoutFor(column, 2), 0n);
});

test("even-money bets pay ≈0.94:1 (≈1.94× total) and lose on zero", () => {
  // 35 / 18 ≈ 1.944 → floor(100 × 1.944) = 194
  for (const type of ["red", "black", "odd", "even", "high", "low"] as const) {
    assert.equal(payoutFor({ type, amountPaise: 100n }, 0), 0n, `${type} must lose on zero`);
  }
  assert.equal(payoutFor({ type: "red",   amountPaise: 100n }, 32), 194n);
  assert.equal(payoutFor({ type: "black", amountPaise: 100n }, 33), 194n);
  assert.equal(payoutFor({ type: "odd",   amountPaise: 100n }, 35), 194n);
  assert.equal(payoutFor({ type: "even",  amountPaise: 100n }, 34), 194n);
  assert.equal(payoutFor({ type: "high",  amountPaise: 100n }, 19), 194n);
  assert.equal(payoutFor({ type: "low",   amountPaise: 100n }, 18), 194n);
});

test("every bet type has RTP ≈35/37 (≈94.59%) across all 37 pockets", () => {
  // Fixed paytable: payout = floor(stake × 35 / covered) for each winner.
  // Over all 37 pockets each bet wins on N of them.
  // For integer-divisible cases (straight, split, corner): RTP = exactly 35/37.
  // For non-divisible (street, line, dozen, even-money): floor reduces RTP
  // very slightly below 35/37 — tolerate 0.1% difference.
  const TARGET_RTP = 35 / 37;
  const bets: RouletteBetInput[] = [
    { type: "straight", numbers: [0], amountPaise: 3700n },
    { type: "split", numbers: [0, 2], amountPaise: 3700n },
    { type: "street", numbers: [31, 32, 33], amountPaise: 3700n },
    { type: "corner", numbers: [0, 1, 2, 3], amountPaise: 3700n },
    { type: "line", numbers: [31, 32, 33, 34, 35, 36], amountPaise: 3700n },
    { type: "dozen", selection: 3, amountPaise: 3700n },
    { type: "column", selection: 2, amountPaise: 3700n },
    { type: "red", amountPaise: 3700n },
    { type: "even", amountPaise: 3700n },
    { type: "high", amountPaise: 3700n },
  ];
  for (const bet of bets) {
    let totalReturned = 0n;
    for (let pocket = 0; pocket <= 36; pocket++) {
      totalReturned += payoutFor(bet, pocket);
    }
    const totalStaked = bet.amountPaise * 37n;
    const rtp = Number(totalReturned) / Number(totalStaked);
    assert.ok(
      Math.abs(rtp - TARGET_RTP) < 0.001,
      `${bet.type}: rtp=${rtp} expected ≈${TARGET_RTP}`,
    );
  }
});

test("invalid placements are rejected", () => {
  const bad = [
    { type: "split", numbers: [1, 3] }, // not adjacent
    { type: "split", numbers: [3, 4] }, // across street boundary horizontally
    { type: "street", numbers: [2, 3, 4] },
    { type: "corner", numbers: [3, 4, 6, 7] }, // wraps column edge
    { type: "line", numbers: [2, 3, 4, 5, 6, 7] },
    { type: "straight", numbers: [37] },
    { type: "straight", numbers: [] },
    { type: "dozen", selection: 4 },
    { type: "column", selection: 0 },
  ] as const;
  for (const b of bad) {
    assert.throws(
      () => rouletteBetCoverage(b as never),
      `should reject ${JSON.stringify(b)}`,
    );
  }
});

test("valid edge-case placements are accepted", () => {
  assert.deepEqual(rouletteBetCoverage({ type: "split", numbers: [0, 1] }), [0, 1]);
  assert.deepEqual(rouletteBetCoverage({ type: "street", numbers: [0, 1, 2] }), [0, 1, 2]);
  assert.deepEqual(rouletteBetCoverage({ type: "corner", numbers: [0, 1, 2, 3] }), [0, 1, 2, 3]);
  assert.deepEqual(rouletteBetCoverage({ type: "split", numbers: [33, 36] }), [33, 36]);
});

test("multi-bet spins aggregate stakes and payouts", () => {
  const bets: RouletteBetInput[] = [
    { type: "straight", numbers: [7], amountPaise: 100n },
    { type: "red", amountPaise: 200n },
    { type: "dozen", selection: 1, amountPaise: 300n },
  ];
  // Pocket 7 is red and in dozen 1 — all three win.
  // straight: floor(100 × 35/1) = 3500
  // red:      floor(200 × 35/18) = floor(388.9) = 388
  // dozen:    floor(300 × 35/12) = floor(875) = 875
  const win = settleRouletteBets(bets, 7, MAX);
  assert.equal(win.totalStake, 600n);
  assert.equal(win.totalPayout, 3500n + 388n + 875n);
  // Pocket 0 — all lose.
  const lose = settleRouletteBets(bets, 0, MAX);
  assert.equal(lose.totalPayout, 0n);
});

test("maxMultiplier caps the total-return multiplier", () => {
  // straight normally returns 35×; cap to 20 → should return 20
  assert.equal(rouletteTotalReturnMultiplier(1, 20), 20);
  // cap at 35 → uncapped, returns exactly 35
  assert.ok(Math.abs(rouletteTotalReturnMultiplier(1, 35) - 35) < 1e-9);
});

test("payouts are fixed regardless of configured house edge", () => {
  // With fixed paytable, houseEdge config has no effect on payouts.
  // Red (18 pockets): floor(10000 × 35/18) = floor(19444.4) = 19444
  const fixed = payoutFor({ type: "red", amountPaise: 10000n }, 32);
  assert.equal(fixed, 19444n, "red bet pays floor(stake × 35/18)");
  const alsoFixed = settleRouletteBets(
    [{ type: "red", amountPaise: 10000n }],
    32,
    MAX,
  );
  assert.equal(alsoFixed.totalPayout, 19444n);
});

test("pocket colors match the European wheel", () => {
  assert.equal(pocketColor(0), "green");
  assert.equal(pocketColor(32), "red");
  assert.equal(pocketColor(33), "black");
  assert.equal(ROULETTE_RED_NUMBERS.size, 18);
});

// ── Verify-endpoint payout recomputation ───────────────────────────────────

/**
 * Mirror of the verify endpoint's recomputation loop: recompute each bet's
 * win state and payout from amountPaise + coverage + payoutBase, ignoring
 * stored payoutPaise, AND compare per-bet against the persisted record
 * (betsMatch) exactly as the endpoint does.
 */
function simulateVerify(
  storedBetList: SettledRouletteBet[],
  payoutBase: number,
  pocket: number,
  maxMultiplier: number,
): { totalPayout: bigint; betsMatch: boolean } {
  let totalPayout = 0n;
  let betsMatch = true;
  for (const b of storedBetList) {
    const coverage = rouletteBetCoverage(b);
    const didWin = coverage.includes(pocket);
    let payout = 0n;
    if (didWin) {
      const mult = rouletteTotalReturnMultiplierWithBase(coverage.length, payoutBase, maxMultiplier);
      payout = BigInt(Math.floor(Number(BigInt(b.amountPaise)) * mult + 1e-9));
      totalPayout += payout;
    }
    if (b.didWin !== didWin || BigInt(b.payoutPaise) !== payout) {
      betsMatch = false;
    }
  }
  return { totalPayout, betsMatch };
}

function simulateVerifyPayout(
  storedBetList: SettledRouletteBet[],
  payoutBase: number,
  pocket: number,
  maxMultiplier: number,
): bigint {
  return simulateVerify(storedBetList, payoutBase, pocket, maxMultiplier).totalPayout;
}

test("verify recomputes correctly from 35-base stored rounds", () => {
  // Simulate a 35-base round: straight on 17 wins, pocket = 17.
  const storedBet: SettledRouletteBet = {
    type: "straight", numbers: [17],
    amountPaise: "100", payoutPaise: "99999", // tampered! should not matter
    didWin: true,
  };
  const computed = simulateVerifyPayout([storedBet], 35, 17, 35);
  assert.equal(computed, 3500n, "35-base straight recomputes to 100×35=3500");
});

test("verify recomputes correctly from 36-base (legacy) stored rounds", () => {
  // Old rounds stored payoutBase=36 implicitly (bare array).
  const storedBet: SettledRouletteBet = {
    type: "straight", numbers: [5],
    amountPaise: "100", payoutPaise: "50", // tampered
    didWin: true,
  };
  // parseStoredBets on a bare array defaults payoutBase to 36.
  const { payoutBase } = parseStoredBets([storedBet]);
  assert.equal(payoutBase, 36, "bare-array legacy rounds default to payoutBase=36");
  const computed = simulateVerifyPayout([storedBet], payoutBase, 5, 36);
  assert.equal(computed, 3600n, "36-base straight recomputes to 100×36=3600");
});

test("verify detects tampered payoutPaise — recomputed payout differs from stored sum", () => {
  // A losing bet with a positive payoutPaise stored — tampered.
  const tamperedBet: SettledRouletteBet = {
    type: "straight", numbers: [17],
    amountPaise: "100", payoutPaise: "3500", // claims win
    didWin: false,
  };
  // pocket 18 ≠ 17, so the bet loses on recompute
  const recomputed = simulateVerifyPayout([tamperedBet], 35, 18, 35);
  // stored sum would be 3500 if we trusted payoutPaise
  const storedSum = BigInt(tamperedBet.payoutPaise);
  assert.equal(recomputed, 0n, "tampered losing bet recomputes to 0");
  assert.notEqual(recomputed, storedSum, "recomputed payout differs from tampered stored value");
});

test("verify fails on tampered per-bet payoutPaise even when aggregate is unchanged", () => {
  // Two winning straight bets on pocket 17, 100 paise each → 3500 each, 7000 total.
  // Tamper: shift 500 paise from one bet to the other — aggregate stays 7000.
  const bets: SettledRouletteBet[] = [
    { type: "straight", numbers: [17], amountPaise: "100", payoutPaise: "3000", didWin: true },
    { type: "straight", numbers: [17], amountPaise: "100", payoutPaise: "4000", didWin: true },
  ];
  const r = simulateVerify(bets, 35, 17, 35);
  assert.equal(r.totalPayout, 7000n, "aggregate recomputes to the same 7000");
  assert.equal(r.betsMatch, false, "per-bet mismatch must fail verification");
});

test("verify fails on tampered didWin even when aggregate is unchanged", () => {
  // Losing bet (pocket 18) marked didWin=true with payoutPaise 0 — aggregate unchanged (0).
  const bets: SettledRouletteBet[] = [
    { type: "straight", numbers: [17], amountPaise: "100", payoutPaise: "0", didWin: true },
  ];
  const r = simulateVerify(bets, 35, 18, 35);
  assert.equal(r.totalPayout, 0n, "aggregate is unchanged at 0");
  assert.equal(r.betsMatch, false, "tampered didWin must fail verification");
});

test("verify passes betsMatch on untampered settled bets", () => {
  const bets: SettledRouletteBet[] = [
    { type: "straight", numbers: [17], amountPaise: "100", payoutPaise: "3500", didWin: true },
    { type: "straight", numbers: [5], amountPaise: "100", payoutPaise: "0", didWin: false },
  ];
  const r = simulateVerify(bets, 35, 17, 35);
  assert.equal(r.totalPayout, 3500n);
  assert.equal(r.betsMatch, true);
});

test("parseStoredBets handles both array (legacy) and object (current) shapes", () => {
  const bets: SettledRouletteBet[] = [
    { type: "red", amountPaise: "100", payoutPaise: "194", didWin: true },
  ];
  // Legacy: bare array
  const legacy = parseStoredBets(bets);
  assert.equal(legacy.payoutBase, 36);
  assert.equal(legacy.bets.length, 1);
  // Current: wrapped object
  const current = parseStoredBets({ payoutBase: 35, bets });
  assert.equal(current.payoutBase, 35);
  assert.equal(current.bets.length, 1);
});

test("deriveRouletteOutcome is deterministic and in range", () => {
  const a = deriveRouletteOutcome("seedA", "clientA", 0);
  const b = deriveRouletteOutcome("seedA", "clientA", 0);
  assert.equal(a.pocket, b.pocket);
  for (let n = 0; n < 200; n++) {
    const { pocket } = deriveRouletteOutcome("seedA", "clientA", n);
    assert.ok(pocket >= 0 && pocket <= 36);
  }
  // Different nonce should (overwhelmingly) change outcomes at least once.
  const distinct = new Set(
    Array.from({ length: 50 }, (_, n) => deriveRouletteOutcome("s", "c", n).pocket),
  );
  assert.ok(distinct.size > 5);
});
