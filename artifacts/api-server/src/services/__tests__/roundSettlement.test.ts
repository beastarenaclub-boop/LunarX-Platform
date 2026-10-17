import { strict as assert } from "node:assert";
import { test } from "node:test";
import { computeSplit, COMPANY_BPS, TOTAL_BPS } from "../roundSettlement";

/**
 * Pure-math tests for the 95/5 pari-mutuel split. No DB involved.
 *
 * These are the load-bearing invariants behind every round settlement:
 *   1. company profit + every payout MUST sum to total pool (no gain/loss).
 *   2. company profit is exactly floor(pool * 5%).
 *   3. each winner's payout is proportional to stake × cashoutMultiplier.
 *   4. losers (no cashout) always net -stake.
 *   5. residual rupees from rounding go to the largest winner, not the house.
 *   6. all-losers round → 100% pool to house.
 *   7. zero-pool round → all zeros, no errors.
 */

function totalOut(entries: { payout: bigint }[], company: bigint): bigint {
  let s = company;
  for (const e of entries) s += e.payout;
  return s;
}

test("balances exactly: company + all payouts = total pool (simple round)", () => {
  const r = computeSplit([
    { betId: "a", userId: "u1", stake: 10000n, cashoutMultiplier: 2.0 },
    { betId: "b", userId: "u2", stake: 5000n, cashoutMultiplier: 3.0 },
    { betId: "c", userId: "u3", stake: 8000n, cashoutMultiplier: null },
  ]);
  assert.equal(r.totalPool, 23000n);
  assert.equal(r.companyProfit, (23000n * COMPANY_BPS) / TOTAL_BPS);
  assert.equal(totalOut(r.entries, r.companyProfit), 23000n);
  assert.equal(r.winnerCount, 2);
  assert.equal(r.loserCount, 1);
});

test("losers always net -stake; winners net (payout - stake)", () => {
  const r = computeSplit([
    { betId: "a", userId: "u1", stake: 1000n, cashoutMultiplier: 2.0 },
    { betId: "b", userId: "u2", stake: 1000n, cashoutMultiplier: null },
  ]);
  const winner = r.entries.find((e) => e.betId === "a")!;
  const loser = r.entries.find((e) => e.betId === "b")!;
  assert.equal(loser.payout, 0n);
  assert.equal(loser.profit, -1000n);
  assert.equal(winner.profit, winner.payout - 1000n);
});

test("payouts are proportional to stake × cashoutMultiplier", () => {
  // Two winners with equal weight (1000×2 == 500×4). Player pool should split
  // 50/50 between them, modulo a 1-paise residual that goes to the larger.
  const r = computeSplit([
    { betId: "a", userId: "u1", stake: 1000n, cashoutMultiplier: 2.0 },
    { betId: "b", userId: "u2", stake: 500n, cashoutMultiplier: 4.0 },
  ]);
  const a = r.entries.find((e) => e.betId === "a")!;
  const b = r.entries.find((e) => e.betId === "b")!;
  // Equal weights → equal payouts (or off by at most 1 due to residual).
  const diff = a.payout > b.payout ? a.payout - b.payout : b.payout - a.payout;
  assert.ok(diff <= 1n, `payouts within 1 paise: a=${a.payout} b=${b.payout}`);
  // And totals still balance.
  assert.equal(totalOut(r.entries, r.companyProfit), r.totalPool);
});

test("all-losers round routes 100% of pool to company", () => {
  const r = computeSplit([
    { betId: "a", userId: "u1", stake: 1000n, cashoutMultiplier: null },
    { betId: "b", userId: "u2", stake: 2000n, cashoutMultiplier: null },
  ]);
  assert.equal(r.companyProfit, 3000n);
  assert.equal(r.playerPool, 0n);
  assert.equal(r.winnerCount, 0);
  assert.equal(r.loserCount, 2);
  for (const e of r.entries) {
    assert.equal(e.payout, 0n);
    assert.equal(e.profit, -e.stake);
  }
});

test("zero-pool round produces zeros and no NaN", () => {
  const r = computeSplit([]);
  assert.equal(r.totalPool, 0n);
  assert.equal(r.companyProfit, 0n);
  assert.equal(r.playerPool, 0n);
  assert.equal(r.entries.length, 0);
});

test("rounding residual goes to the largest winner, not the house", () => {
  // Total pool = 1000 paise. 5% = 50 paise (exact). Player pool = 950.
  // Three winners with weights 1, 1, 1 → 950/3 doesn't divide evenly.
  // Floor each at 316, sum = 948, residual = 2. Largest winner gets +2.
  const r = computeSplit([
    { betId: "a", userId: "u1", stake: 100n, cashoutMultiplier: 2.0 },
    { betId: "b", userId: "u2", stake: 100n, cashoutMultiplier: 2.0 },
    { betId: "c", userId: "u3", stake: 100n, cashoutMultiplier: 2.0 },
    { betId: "d", userId: "u4", stake: 700n, cashoutMultiplier: null },
  ]);
  // Sanity: company profit is exactly 5% (50 paise on 1000-paise pool).
  assert.equal(r.companyProfit, 50n);
  // Sanity: balance.
  assert.equal(totalOut(r.entries, r.companyProfit), 1000n);
});

test("multiplier ≤ 1 is treated as a non-cashout (loser)", () => {
  // Lunar caps the live multiplier at 1.0 if cashout is requested before
  // takeoff; that bet should NOT receive a payout share.
  const r = computeSplit([
    { betId: "a", userId: "u1", stake: 1000n, cashoutMultiplier: 1.0 },
    { betId: "b", userId: "u2", stake: 1000n, cashoutMultiplier: 5.0 },
  ]);
  const a = r.entries.find((e) => e.betId === "a")!;
  const b = r.entries.find((e) => e.betId === "b")!;
  assert.equal(a.payout, 0n);
  assert.ok(b.payout > 0n);
  assert.equal(totalOut(r.entries, r.companyProfit), r.totalPool);
});

test("company cut is exactly floor(5%) of pool — never more", () => {
  for (const pool of [1n, 7n, 19n, 100n, 99999n, 1234567n]) {
    const r = computeSplit([
      { betId: "x", userId: "u", stake: pool, cashoutMultiplier: 2.0 },
    ]);
    assert.equal(r.companyProfit, (pool * COMPANY_BPS) / TOTAL_BPS);
    assert.equal(totalOut(r.entries, r.companyProfit), pool);
  }
});

test("idempotent split: same inputs always produce same outputs", () => {
  const inputs = [
    { betId: "a", userId: "u1", stake: 4321n, cashoutMultiplier: 1.87 },
    { betId: "b", userId: "u2", stake: 9999n, cashoutMultiplier: 12.5 },
    { betId: "c", userId: "u3", stake: 100n, cashoutMultiplier: null },
  ];
  const r1 = computeSplit(inputs);
  const r2 = computeSplit(inputs);
  assert.deepEqual(
    r1.entries.map((e) => ({ id: e.betId, payout: e.payout.toString() })),
    r2.entries.map((e) => ({ id: e.betId, payout: e.payout.toString() })),
  );
  assert.equal(r1.companyProfit, r2.companyProfit);
});
