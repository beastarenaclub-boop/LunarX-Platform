/**
 * Every engine mode against its own stated rule, on random roulette books.
 *
 * `rtpProperties.test.ts` does this for RTP. This file covers the rest, with
 * the same shape: thousands of random books, and for each decision an
 * independent restatement of what the mode promises. The promises:
 *
 *   M1  bookkeeping: a steered pick names a real candidate, and the recorded
 *       house delta is that candidate's; an honest draw names none
 *   M2  the bank floor outranks every target — when a legal result exists a
 *       steered pick is legal and no floor alert fires; when none does, the
 *       alert fires and the pick is the least bad
 *   M3  `normal` never steers; an empty book never steers in ANY mode
 *   M4  collect picks from the top-k of the legal pool by house net, where
 *       k = max(3, ceil(n(1 − aggressiveness)))
 *   M5  distribute with money owed picks a LOSING result when one is legal;
 *       with no target, or nothing owed, it draws honestly
 *   M6  determinism: one seed, one decision, in every mode
 *   M7  a stream under auto holds near its target rate; under collect the
 *       house keeps more than the wheel's natural edge, under distribute less
 *
 * Roulette-shaped books: 38 pockets, straights at 36x, even money, dozens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeExposure, type Exposure } from "../exposure";
import { DEFAULT_PARAMS, ENGINE_MODES, type EngineMode, type EngineParams } from "../params";
import { decide, type BankState } from "../selectors";
import { SeededRng } from "../rng";

function prng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x1_0000_0000;
  };
}

type Bet = { pockets: number[]; stake: bigint; mult: bigint };
type Slip = { userId: string; bets: Bet[]; stakePaise: bigint };
const POCKETS = 38;

function randomBook(rnd: () => number, maxSlips = 8): Slip[] {
  const slips: Slip[] = [];
  const n = 1 + Math.floor(rnd() * maxSlips);
  for (let s = 0; s < n; s++) {
    const bets: Bet[] = [];
    const chips = 1 + Math.floor(rnd() * 5);
    for (let c = 0; c < chips; c++) {
      const stake = BigInt(100 * (1 + Math.floor(rnd() * 50)));
      const kind = rnd();
      if (kind < 0.5) bets.push({ pockets: [Math.floor(rnd() * POCKETS)], stake, mult: 36n });
      else if (kind < 0.8) {
        const start = rnd() < 0.5 ? 1 : 2;
        const pockets: number[] = [];
        for (let p = start; p <= 36; p += 2) pockets.push(p);
        bets.push({ pockets, stake, mult: 2n });
      } else {
        const d = Math.floor(rnd() * 3);
        const pockets: number[] = [];
        for (let p = 1; p <= 12; p++) pockets.push(d * 12 + p);
        bets.push({ pockets, stake, mult: 3n });
      }
    }
    slips.push({ userId: `u${s}`, bets, stakePaise: bets.reduce((a, b) => a + b.stake, 0n) });
  }
  return slips;
}

function payoutFor(bets: unknown, outcome: unknown): bigint {
  const pocket = outcome as number;
  let paid = 0n;
  for (const b of bets as Bet[]) if (b.pockets.includes(pocket)) paid += b.stake * b.mult;
  return paid;
}

const CANDIDATES = Array.from({ length: POCKETS }, (_, i) => ({ id: String(i), label: String(i), outcome: i }));
const exposureOf = (slips: Slip[]) => computeExposure(CANDIDATES, slips, 0.6, payoutFor);

function bank(over: Partial<BankState> = {}): BankState {
  return {
    bankPaise: 10_000_000n, minBankFloorPaise: 0n, zeroBetStreak: 0,
    beneficiaryStreak: 0, lastBeneficiaryUserId: null, recentChoiceIds: [],
    windowStakedPaise: 1_000_000n, windowHouseNetPaise: 50_000n,
    cumulativeStakedPaise: 0n, cumulativePayoutPaise: 0n, ...over,
  };
}

const STEERING: EngineMode[] = ["collect", "distribute", "auto", "rtp"];
const run = (mode: EngineMode, e: Exposure, b: BankState, over: Partial<EngineParams>, seed: string) =>
  decide(mode, e, { ...DEFAULT_PARAMS, ...over }, b, new SeededRng(seed), seed);

/** Params that make every mode actually steer: a target for distribute, a rate auto is off. */
function steeringParams(rnd: () => number, b: BankState): Partial<EngineParams> {
  return {
    noiseRate: 0.02,
    aggressiveness: rnd(),
    targetBankPaise: b.bankPaise - BigInt(1 + Math.floor(rnd() * 500_000)),
    paceRounds: 1 + Math.floor(rnd() * 50),
    // auto: window hold is 5%; a target outside ±1.5% of that steers either way.
    targetHoldPct: rnd() < 0.5 ? 0.15 : -0.05,
    rtpHoldBps: Math.floor(rnd() * 3000),
  };
}

test("M1/M2 bookkeeping and the bank floor hold in every steering mode on random books", () => {
  const rnd = prng(0xA11);
  const steered: Record<string, number> = {};
  let unreachable = 0;
  for (let i = 0; i < 2500; i++) {
    const e = exposureOf(randomBook(rnd));
    const floor = rnd() < 0.5 ? 0n : BigInt(Math.floor(rnd() * 300_000));
    const b = bank({
      bankPaise: BigInt(Math.floor(rnd() * 300_000)),
      minBankFloorPaise: floor,
      cumulativeStakedPaise: 1_000_000n,
      cumulativePayoutPaise: 900_000n,
    });
    const over = steeringParams(rnd, b);
    const legal = e.outcomes.filter((o) => b.bankPaise + o.houseNetPaise >= floor);
    const leastBad = e.outcomes.reduce((a, o) => (o.houseNetPaise > a.houseNetPaise ? o : a));
    for (const mode of STEERING) {
      const d = run(mode, e, b, over, `m-${i}`);
      assert.equal(d.mode, mode);
      if (d.choiceIndex === null) {
        // Honest draw: names nothing, and only for a reason the record states.
        assert.equal(d.choiceId, null);
        assert.ok(d.noise || /left to its own draw/u.test(d.reason), `${mode}: silent honest draw: ${d.reason}`);
        continue;
      }
      steered[mode] = (steered[mode] ?? 0) + 1;
      const picked = e.outcomes[d.choiceIndex]!;
      assert.equal(d.choiceId, picked.choiceId, `${mode} case ${i}: choiceId`);
      assert.equal(d.houseDeltaPaise, picked.houseNetPaise.toString(), `${mode} case ${i}: house delta`);
      assert.equal(d.bankBeforePaise, b.bankPaise.toString());
      const pickedLegal = b.bankPaise + picked.houseNetPaise >= floor;
      if (legal.length > 0) {
        assert.ok(pickedLegal, `${mode} case ${i}: passed over a legal result for one breaching the floor`);
        assert.ok(!d.alerts.includes("BANK_FLOOR_UNREACHABLE"), `${mode} case ${i}: false floor alert`);
      } else {
        unreachable++;
        assert.ok(d.alerts.includes("BANK_FLOOR_UNREACHABLE"), `${mode} case ${i}: missing floor alert`);
        if (mode !== "rtp") {
          assert.equal(picked.houseNetPaise, leastBad.houseNetPaise, `${mode} case ${i}: not the least bad`);
        }
      }
    }
  }
  for (const mode of STEERING) assert.ok((steered[mode] ?? 0) > 500, `${mode} steered only ${steered[mode] ?? 0} times`);
  assert.ok(unreachable > 100, `only ${unreachable} unreachable-floor decisions`);
});

test("M3 normal never steers, and an empty book never steers in any mode", () => {
  const rnd = prng(0x3);
  const empty = exposureOf([{ userId: "u", bets: [], stakePaise: 0n }]);
  for (let i = 0; i < 300; i++) {
    const e = exposureOf(randomBook(rnd));
    const b = bank();
    const over = steeringParams(rnd, b);
    const n = run("normal", e, b, over, `n-${i}`);
    assert.equal(n.choiceIndex, null);
    assert.equal(n.noise, false);
    for (const mode of ENGINE_MODES) {
      const d = run(mode, empty, b, over, `e-${i}`);
      assert.equal(d.choiceIndex, null, `${mode} steered an empty book`);
    }
  }
});

test("M4 collect picks inside the top-k of the legal pool by house net", () => {
  const rnd = prng(0xC0);
  let checked = 0;
  for (let i = 0; i < 1500; i++) {
    const e = exposureOf(randomBook(rnd));
    const b = bank({ bankPaise: BigInt(Math.floor(rnd() * 300_000)), minBankFloorPaise: BigInt(Math.floor(rnd() * 100_000)) });
    const aggressiveness = rnd();
    const d = run("collect", e, b, { noiseRate: 0.02, aggressiveness }, `c-${i}`);
    if (d.choiceIndex === null) continue;
    const pool = e.outcomes.filter((o) => b.bankPaise + o.houseNetPaise >= b.minBankFloorPaise);
    if (pool.length === 0) continue;
    const k = Math.max(3, Math.ceil(e.outcomes.length * (1 - aggressiveness)));
    const ranked = [...pool].sort((x, y) => (y.houseNetPaise > x.houseNetPaise ? 1 : y.houseNetPaise < x.houseNetPaise ? -1 : 0));
    const cutoff = ranked[Math.min(k, ranked.length) - 1]!.houseNetPaise;
    const picked = e.outcomes[d.choiceIndex]!;
    assert.ok(picked.houseNetPaise >= cutoff, `case ${i}: picked ${picked.houseNetPaise} below the top-${k} cutoff ${cutoff}`);
    checked++;
  }
  assert.ok(checked > 1000, `only ${checked} collect picks checked`);
});

test("M5 distribute requires money owed and interpolates available results without fabricating a payout", () => {
  const rnd = prng(0xD1);
  let gave = 0;
  for (let i = 0; i < 1500; i++) {
    const e = exposureOf(randomBook(rnd));
    const bankPaise = BigInt(Math.floor(rnd() * 500_000));
    const b = bank({ bankPaise, minBankFloorPaise: -1_000_000_000n });
    // No target → honest. Bank at/below target → honest.
    assert.equal(run("distribute", e, b, { noiseRate: 0.02, targetBankPaise: null }, `d0-${i}`).choiceIndex, null);
    assert.equal(run("distribute", e, b, { noiseRate: 0.02, targetBankPaise: bankPaise + 1n }, `d1-${i}`).choiceIndex, null);
    const target = bankPaise - BigInt(1 + Math.floor(rnd() * 200_000));
    const d = run("distribute", e, b, { noiseRate: 0.02, targetBankPaise: target, paceRounds: 1 + Math.floor(rnd() * 20) }, `d2-${i}`);
    if (d.choiceIndex === null) {
      assert.ok(d.noise, `case ${i}: distribute with money owed drew honestly without noise: ${d.reason}`);
      continue;
    }
    const picked = e.outcomes[d.choiceIndex]!;
    const anyLosing = e.outcomes.some((o) => o.houseNetPaise < 0n);
    if (anyLosing) {
      assert.ok(d.candidates.some(c => c.choiceId === picked.choiceId), `case ${i}: picked outside recorded pool`);
      gave++;
    } else {
      // Nothing on the book loses: the cheapest win, not a fabricated payout.
      const cheapest = e.outcomes.reduce((a, o) => (o.houseNetPaise < a.houseNetPaise ? o : a));
      assert.equal(picked.houseNetPaise, cheapest.houseNetPaise, `case ${i}: not the cheapest win`);
    }
  }
  assert.ok(gave > 800, `distribute gave back only ${gave} times`);
});

test("M6 one seed, one decision, in every mode", () => {
  const rnd = prng(0x6);
  for (let i = 0; i < 300; i++) {
    const e = exposureOf(randomBook(rnd));
    const b = bank({ cumulativeStakedPaise: 500_000n, cumulativePayoutPaise: 480_000n });
    const over = steeringParams(rnd, b);
    for (const mode of ENGINE_MODES) {
      assert.deepEqual(run(mode, e, b, over, `s-${i}`), run(mode, e, b, over, `s-${i}`), mode);
    }
  }
});

/**
 * Drive a stream the way the round loop does: the decision's pick settles,
 * an honest draw lands on a uniform pocket, the bank and the rolling window
 * move by the settled house net. Returns the overall hold.
 */
function simulate(mode: EngineMode, over: Partial<EngineParams>, rounds: number, seed: number) {
  const rnd = prng(seed);
  const WINDOW = 100;
  let bankPaise = 0n;
  let S = 0n;
  let N = 0n;
  const recent: { staked: bigint; net: bigint }[] = [];
  for (let r = 0; r < rounds; r++) {
    const e = exposureOf(randomBook(rnd));
    const win = recent.reduce((a, x) => ({ staked: a.staked + x.staked, net: a.net + x.net }), { staked: 0n, net: 0n });
    const b = bank({
      bankPaise, minBankFloorPaise: -1_000_000_000_000n,
      windowStakedPaise: win.staked, windowHouseNetPaise: win.net,
      cumulativeStakedPaise: S, cumulativePayoutPaise: S - N,
    });
    const d = run(mode, e, b, over, `sim-${mode}-${seed}-${r}`);
    const landed = d.choiceIndex === null ? e.outcomes[Math.floor(rnd() * POCKETS)]! : e.outcomes[d.choiceIndex]!;
    bankPaise += landed.houseNetPaise;
    S += e.totalStakedPaise;
    N += landed.houseNetPaise;
    recent.push({ staked: e.totalStakedPaise, net: landed.houseNetPaise });
    if (recent.length > WINDOW) recent.shift();
  }
  return Number(N) / Number(S);
}

test("M7 over thousands of rounds each mode moves the hold the way it promises", () => {
  const natural = simulate("normal", {}, 4000, 0x900);
  // The wheel's own edge on these books: 2/38 ≈ 5.3%, give or take variance.
  assert.ok(natural > 0.0 && natural < 0.12, `natural hold ${natural}`);

  const collected = simulate("collect", { noiseRate: 0.02, aggressiveness: 0.6, targetBankPaise: null }, 3000, 0x901);
  assert.ok(collected > natural + 0.15, `collect held ${collected} vs natural ${natural}`);

  const distributed = simulate("distribute", { noiseRate: 0.02, targetBankPaise: -1_000_000_000_000n, paceRounds: 5 }, 3000, 0x902);
  assert.ok(distributed < natural - 0.15, `distribute held ${distributed} vs natural ${natural}`);

  for (const target of [0.05, 0.12, 0.2]) {
    const held = simulate("auto", { noiseRate: 0.02, targetHoldPct: target, windowRounds: 100 }, 6000, 0x903);
    assert.ok(Math.abs(held - target) <= 0.03, `auto at ${target}: held ${held}`);
  }

  for (const holdBps of [500, 1000, 2000]) {
    const held = simulate("rtp", { rtpHoldBps: holdBps, rtpRecoveryMode: "target" }, 3000, 0x904);
    assert.ok(Math.abs(held - holdBps / 10_000) <= 0.005, `rtp at ${holdBps}: held ${held}`);
  }
});
