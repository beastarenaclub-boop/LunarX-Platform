/**
 * The RTP selector against a brute-force oracle, on random books.
 *
 * `rtp.test.ts` pins the documented examples. This file asks the questions an
 * auditor would: for thousands of random books, histories, targets and
 * floors, is the pick ALWAYS the one the rule names, and does a stream that
 * runs under it actually land on its target? Every check is against an
 * independent re-statement of the rule written here in plain loops, not
 * against the selector's own helpers.
 *
 *   Q1  target policy: the pick is one of the two floor-legal payouts either
 *       side of this round's aim — its share of the return plus
 *       `aggressiveness` of the running gap, exactly, in integer paise (at
 *       aggressiveness 1 the aim is r(S + B) − P) — or the closest when the
 *       board sits all on one side of it
 *   Q2  recover policy: with P > S the pick is the smallest legal payout;
 *       otherwise Q1 unless every legal result loses, then the smallest
 *   Q3  the floor: a legal result is never passed over for an illegal one,
 *       and only an empty legal pool falls back (flagged)
 *   Q4  determinism: the same seed gives the same pick, and only the two
 *       sides of the aim and exact ties ever differ between seeds; a noise
 *       round names nothing
 *   Q5  convergence: a stream of random roulette-shaped books settles within
 *       ±0.5 point of its target at 80 / 90 / 95 / 97.5 %, both policies,
 *       at every aggressiveness and with noise, and the recover policy never
 *       lets cumulative payouts run ahead of stakes when the book allows a
 *       house win
 *   Q6  the decision record can replay the pick: its recorded inputs and the
 *       evaluated list reproduce the bracket and the odds, and the seed
 *       replays the draw to the same side
 *   R1  the repeat guard: a fixed layout replayed against a stream in deficit
 *       — the Prev-Bet exploit — never lands the same result more than
 *       `rtpMaxRepeat` rounds running, at any cap, while the plain argmin
 *       (the control) runs the same result four or more times; the guard
 *       only ever sets a result aside when another floor-legal one exists,
 *       and the record names the run it read and what it set aside
 *   R2  the near-tie band: every pick's payout is within the band of the one
 *       the draw landed on (restated), the recorded pool is exactly the
 *       band, band 0 is the exact rule, and a non-zero band does spread
 *       the picks
 *   R3  with both guards at their shipped values, a stream of random books
 *       with its history threaded still lands within half a point of target
 *       and never shows a run past the cap
 *   R4  history scope `none`: every round aims for its own share and nothing
 *       is carried, so the draw alone holds the target on random books —
 *       and the shipped repeat guard, which only ever swaps in a cheaper
 *       result, pulls it about a point under (measured; the panel copy says
 *       so); the record names the scope
 *
 * The book generator is roulette-shaped on purpose — 38 pockets, straight
 * bets paying 36x, even-money and dozens — because on a wheel most results
 * are unbacked and identical, which is the tie-heavy shape that breaks naive
 * "closest" implementations.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeExposure, type Exposure } from "../exposure";
import { DEFAULT_PARAMS, type EngineParams } from "../params";
import { decide, leadingRun, rtpCorrectionBps, type BankState } from "../selectors";
import { SeededRng } from "../rng";

/** xorshift32 — the same generator the audit runner uses, so runs repeat. */
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
/** A random roulette book: 1–8 slips, each 1–5 chips across the layout. */
function randomBook(rnd: () => number): Slip[] {
  const slips: Slip[] = [];
  const n = 1 + Math.floor(rnd() * 8);
  for (let s = 0; s < n; s++) {
    const bets: Bet[] = [];
    const chips = 1 + Math.floor(rnd() * 5);
    for (let c = 0; c < chips; c++) {
      const stake = BigInt(100 * (1 + Math.floor(rnd() * 50))); // ₹1..₹50
      const kind = rnd();
      if (kind < 0.5) {
        bets.push({ pockets: [Math.floor(rnd() * POCKETS)], stake, mult: 36n });
      } else if (kind < 0.8) {
        // even money: 18 of the 36 numbered pockets
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
    slips.push({
      userId: `u${s}`,
      bets,
      stakePaise: bets.reduce((a, b) => a + b.stake, 0n),
    });
  }
  return slips;
}

function payoutFor(bets: unknown, outcome: unknown): bigint {
  const pocket = outcome as number;
  let paid = 0n;
  for (const b of bets as Bet[]) if (b.pockets.includes(pocket)) paid += b.stake * b.mult;
  return paid;
}

function exposureOf(slips: Slip[]): Exposure {
  const candidates = Array.from({ length: POCKETS }, (_, i) => ({
    id: String(i),
    label: String(i),
    outcome: i,
  }));
  return computeExposure(candidates, slips, 0.6, payoutFor, true);
}

function bank(over: Partial<BankState> = {}): BankState {
  return {
    bankPaise: 10_000_000n, minBankFloorPaise: 0n, zeroBetStreak: 0,
    beneficiaryStreak: 0, lastBeneficiaryUserId: null, recentChoiceIds: [],
    windowStakedPaise: 0n, windowHouseNetPaise: 0n,
    cumulativeStakedPaise: 0n, cumulativePayoutPaise: 0n, ...over,
  };
}

const abs = (v: bigint) => (v < 0n ? -v : v);

/**
 * The rule, restated. Returns the set of payouts the rule allows — the
 * smallest when minimising, otherwise the two either side of the aim (or
 * the one closest when the board is all on one side) — so a pick is correct
 * iff its payout is in the set (which side, and ties within it, are the
 * selector's to draw).
 */
function oracle(e: Exposure, b: BankState, p: EngineParams): { payouts: Set<bigint>; fell: boolean } {
  const S = b.cumulativeStakedPaise!;
  const P = b.cumulativePayoutPaise!;
  let pool = e.outcomes.filter((o) => b.bankPaise + o.houseNetPaise >= b.minBankFloorPaise);
  const fell = pool.length === 0;
  if (fell) pool = [...e.outcomes];
  const recovering = p.rtpRecoveryMode === "recover" && P > S;
  const allLose = pool.every((o) => o.houseNetPaise < 0n);
  const minimise = fell || recovering || (p.rtpRecoveryMode === "recover" && allLose);
  // Restated in plain rational arithmetic: wanted = r·B + a·(r·S − P), with
  // r and a as fractions; scaled by 10^8 so it stays integer. `a` is the
  // EFFECTIVE share (5% floor), restated here rather than read off the
  // selector's own helper.
  const r = BigInt(10_000 - p.rtpHoldBps);
  const a = p.rtpAggressivenessEnabled ? BigInt(500 + Math.round(p.aggressiveness * 9_500)) : 10_000n;
  if (p.rtpAggressivenessEnabled) assert.equal(Number(a), rtpCorrectionBps(p.aggressiveness));
  const wanted = r * e.totalStakedPaise * 10_000n + a * (r * S - 10_000n * P);
  const payouts = new Set<bigint>();
  if (minimise) {
    let min: bigint | null = null;
    for (const o of pool) if (min === null || o.payoutPaise < min) min = o.payoutPaise;
    payouts.add(min!);
  } else {
    const { lo, hi } = bracket(pool.map((o) => o.payoutPaise), wanted);
    if (lo !== null) payouts.add(lo);
    if (hi !== null) payouts.add(hi);
  }
  return { payouts, fell };
}

/** The two payouts either side of `wanted` (which is payout × 10^8); null on a side nothing reaches. */
function bracket(payouts: readonly bigint[], wanted: bigint): { lo: bigint | null; hi: bigint | null } {
  let lo: bigint | null = null;
  let hi: bigint | null = null;
  for (const pay of payouts) {
    const v = pay * 100_000_000n;
    if (v <= wanted && (lo === null || pay > lo)) lo = pay;
    if (v >= wanted && (hi === null || pay < hi)) hi = pay;
  }
  return { lo, hi };
}

/** The odds of the high side, in parts per billion, restated: (wanted − lo) / (hi − lo). */
function highChance(lo: bigint | null, hi: bigint | null, wanted: bigint): bigint {
  if (lo === null) return 1_000_000_000n;
  if (hi === null || hi === lo) return 0n;
  return ((wanted - lo * 100_000_000n) * 1_000_000_000n) / ((hi - lo) * 100_000_000n);
}

/**
 * Both knobs ON with the minimum noise unless a test says otherwise — the
 * defaults switch them off, and these tests exercise the knobs' rules. The
 * two pattern guards are pinned OFF here for the same reason (Q1's oracle is
 * the exact argmin); R1–R3 turn them on and restate their rules.
 */
const GUARDS_OFF = { rtpMaxRepeat: 50, rtpTieBandPct: 0 } as const;
function run(e: Exposure, b: BankState, over: Partial<EngineParams>, seed: string) {
  return decide(
    "rtp",
    e,
    { ...DEFAULT_PARAMS, rtpAggressivenessEnabled: true, rtpNoiseEnabled: true, noiseRate: 0.02, ...GUARDS_OFF, ...over },
    b,
    new SeededRng(seed),
    seed,
  );
}
const KNOBS_ON = { rtpAggressivenessEnabled: true, rtpNoiseEnabled: true, noiseRate: 0.02, ...GUARDS_OFF } as const;

const CASES = 3000;

test("Q1/Q2/Q3 the pick is always one the rule allows, on random books, histories, targets and floors", () => {
  const rnd = prng(0xC0FFEE);
  let floorFalls = 0;
  let recoveries = 0;
  for (let i = 0; i < CASES; i++) {
    const e = exposureOf(randomBook(rnd));
    const S = BigInt(Math.floor(rnd() * 5_000_000));
    // History either side of break-even, so both recovery branches are hit.
    const P = (S * BigInt(70 + Math.floor(rnd() * 60))) / 100n;
    const bankPaise = BigInt(Math.floor(rnd() * 200_000));
    const floor = rnd() < 0.5 ? 0n : BigInt(Math.floor(rnd() * 200_000));
    const b = bank({ cumulativeStakedPaise: S, cumulativePayoutPaise: P, bankPaise, minBankFloorPaise: floor });
    const over: Partial<EngineParams> = {
      rtpHoldBps: Math.floor(rnd() * 10_001),
      rtpRecoveryMode: rnd() < 0.5 ? "recover" : "target",
      aggressiveness: [0, 0.25, 0.5, 1][Math.floor(rnd() * 4)]!,
      rtpAggressivenessEnabled: rnd() < 0.8,
      rtpNoiseEnabled: rnd() < 0.8,
    };
    const d = run(e, b, over, `q-${i}`);
    if (d.noise) {
      assert.equal(over.rtpNoiseEnabled, true, `case ${i}: a noise round with noise switched off`);
      assert.equal(d.choiceIndex, null);
      continue;
    }
    const o = oracle(e, b, { ...DEFAULT_PARAMS, ...KNOBS_ON, ...over });
    const picked = e.outcomes[d.choiceIndex!]!;
    assert.ok(
      o.payouts.has(picked.payoutPaise),
      `case ${i}: picked payout ${picked.payoutPaise} not in ${[...o.payouts].join(",")} (${over.rtpRecoveryMode}, hold ${over.rtpHoldBps})`,
    );
    // Q3: the floor. A legal result exists → the pick is legal and not flagged.
    const legal = b.bankPaise + picked.houseNetPaise >= b.minBankFloorPaise;
    assert.equal(legal, !o.fell, `case ${i}: floor legality`);
    assert.equal(d.alerts.includes("BANK_FLOOR_UNREACHABLE"), o.fell, `case ${i}: floor alert`);
    if (o.fell) floorFalls++;
    if (d.alerts.includes("RTP_LOSS_RECOVERY")) {
      recoveries++;
      assert.equal(over.rtpRecoveryMode, "recover");
      assert.ok(P > S);
    }
    // The record explains itself.
    assert.equal(d.rtp?.selectedPayoutPaise, picked.payoutPaise.toString());
    assert.equal(d.rtp?.roundStakesPaise, e.totalStakedPaise.toString());
    assert.equal(d.houseDeltaPaise, picked.houseNetPaise.toString());
  }
  // The generator actually exercised both branches — otherwise the loop above proves less than it reads.
  assert.ok(floorFalls > 20, `only ${floorFalls} unreachable-floor cases`);
  assert.ok(recoveries > 200, `only ${recoveries} recovery cases`);
});

test("Q4 the same seed replays the same pick; different seeds differ only between the two sides of the aim and on exact ties", () => {
  const rnd = prng(0xBEEF);
  let tieRounds = 0;
  for (let i = 0; i < 500; i++) {
    const e = exposureOf(randomBook(rnd));
    const b = bank({ cumulativeStakedPaise: 1_000_000n, cumulativePayoutPaise: 850_000n });
    const over: Partial<EngineParams> = { rtpHoldBps: 1000, rtpRecoveryMode: "target" };
    const a1 = run(e, b, over, `s-${i}`);
    const a2 = run(e, b, over, `s-${i}`);
    assert.deepEqual(a1, a2);
    const allowed = oracle(e, b, { ...DEFAULT_PARAMS, ...KNOBS_ON, ...over }).payouts;
    const seen = new Set<number>();
    for (let k = 0; k < 6; k++) {
      const d = run(e, b, over, `s-${i}-${k}`);
      if (d.noise) continue;
      seen.add(d.choiceIndex!);
    }
    for (const idx of seen) assert.ok(allowed.has(e.outcomes[idx]!.payoutPaise));
    if (seen.size > 1) tieRounds++;
  }
  assert.ok(tieRounds > 50, `a drawn side or a tie is the common case on a wheel; saw ${tieRounds}`);
});

/**
 * Drive a stream: each round's chosen payout and stake accrue exactly as
 * settleBank records them, and the landed result is pushed onto the history
 * the way `noteRoundOutcome` does (newest first, 40 kept), so the repeat
 * guard sees what the real engine would.
 */
function simulate(
  holdBps: number,
  policy: EngineParams["rtpRecoveryMode"],
  rounds: number,
  seed: number,
  extra: Partial<EngineParams> = {},
) {
  const rnd = prng(seed);
  let S = 0n;
  let P = 0n;
  let bankPaise = 0n;
  let aheadWhileAvoidable = 0;
  let recent: string[] = [];
  let longestRun = 0;
  for (let r = 0; r < rounds; r++) {
    const e = exposureOf(randomBook(rnd));
    const b = bank({ cumulativeStakedPaise: S, cumulativePayoutPaise: P, bankPaise, minBankFloorPaise: -1_000_000_000n, recentChoiceIds: recent });
    const d = run(e, b, { rtpHoldBps: holdBps, rtpRecoveryMode: policy, ...extra }, `sim-${seed}-${r}`);
    // A noise round is the game's own draw: a uniform pocket.
    const picked = d.choiceIndex === null ? e.outcomes[Math.floor(rnd() * POCKETS)]! : e.outcomes[d.choiceIndex]!;
    // Q5b: under recover, a house loss while already behind is only taken when unavoidable.
    if (policy === "recover" && P > S && picked.houseNetPaise < 0n && !d.noise) {
      if (e.outcomes.some((o) => o.houseNetPaise >= 0n)) aheadWhileAvoidable++;
    }
    S += e.totalStakedPaise;
    P += picked.payoutPaise;
    bankPaise += picked.houseNetPaise;
    recent = [picked.choiceId, ...recent].slice(0, 40);
    longestRun = Math.max(longestRun, leadingRun(recent)!.count);
  }
  return { S, P, aheadWhileAvoidable, longestRun, rtpBps: Number((P * 10_000n) / S) };
}

test("Q5 a stream settles on its target at several holds, under both policies, and with the shipped defaults", () => {
  for (const holdBps of [2000, 1000, 500, 250]) {
    // The defaults: knobs off, target policy. The tightest tracking of all.
    const shipped = simulate(holdBps, DEFAULT_PARAMS.rtpRecoveryMode, 3000, 0x1000 + holdBps, {
      rtpAggressivenessEnabled: DEFAULT_PARAMS.rtpAggressivenessEnabled,
      rtpNoiseEnabled: DEFAULT_PARAMS.rtpNoiseEnabled,
      rtpMaxRepeat: DEFAULT_PARAMS.rtpMaxRepeat,
      rtpTieBandPct: DEFAULT_PARAMS.rtpTieBandPct,
    });
    assert.ok(Math.abs(shipped.rtpBps - (10_000 - holdBps)) <= 20, `defaults at hold ${holdBps}: ${shipped.rtpBps} bps`);
    // R3, in passing: with the guards at their shipped values the stream never
    // shows a run past the cap on random books either.
    assert.ok(shipped.longestRun <= DEFAULT_PARAMS.rtpMaxRepeat, `defaults at hold ${holdBps}: a run of ${shipped.longestRun}`);
    for (const policy of ["recover", "target"] as const) {
      const { rtpBps, aheadWhileAvoidable } = simulate(holdBps, policy, 3000, 0x1234 + holdBps);
      const target = 10_000 - holdBps;
      assert.ok(
        Math.abs(rtpBps - target) <= 50,
        `hold ${holdBps} ${policy}: landed at ${rtpBps} bps, target ${target}`,
      );
      assert.equal(aheadWhileAvoidable, 0, `${policy}: took an avoidable loss while behind`);
    }
  }
});

test("Q5d every aggressiveness converges, and noise costs accuracy but not the target", () => {
  for (const aggressiveness of [0, 0.1, 0.3, 0.6, 1]) {
    const { rtpBps } = simulate(1000, "target", 3000, 0x777, { aggressiveness });
    assert.ok(Math.abs(rtpBps - 9000) <= 50, `aggressiveness ${aggressiveness}: ${rtpBps} bps`);
  }
  for (const noiseRate of [0.1, 0.2, 0.3]) {
    for (const policy of ["recover", "target"] as const) {
      const { rtpBps, aheadWhileAvoidable } = simulate(1000, policy, 4000, 0x778, { noiseRate });
      assert.ok(Math.abs(rtpBps - 9000) <= 50, `noise ${noiseRate} ${policy}: ${rtpBps} bps`);
      assert.equal(aheadWhileAvoidable, 0);
    }
  }
  // Both switched off: the original rule, and the tightest tracking of all.
  const off = simulate(1000, "target", 3000, 0x779, { rtpNoiseEnabled: false, rtpAggressivenessEnabled: false, noiseRate: 1, aggressiveness: 0 });
  assert.ok(Math.abs(off.rtpBps - 9000) <= 20, `both off: ${off.rtpBps} bps`);
});

test("Q5c a stream that starts deep in house loss is pulled back under recover and converges under target", () => {
  const rnd = prng(0x51);
  for (const policy of ["recover", "target"] as const) {
    let S = 100_000n;
    let P = 200_000n; // the house is ₹1,000 behind before the first round
    let bankPaise = -100_000n;
    for (let r = 0; r < 2000; r++) {
      const e = exposureOf(randomBook(rnd));
      const b = bank({ cumulativeStakedPaise: S, cumulativePayoutPaise: P, bankPaise, minBankFloorPaise: -1_000_000_000n });
      const d = run(e, b, { rtpHoldBps: 1000, rtpRecoveryMode: policy }, `deep-${policy}-${r}`);
      const picked = d.choiceIndex === null ? e.outcomes[Math.floor(rnd() * POCKETS)]! : e.outcomes[d.choiceIndex]!;
      S += e.totalStakedPaise;
      P += picked.payoutPaise;
      bankPaise += picked.houseNetPaise;
    }
    const rtpBps = Number((P * 10_000n) / S);
    assert.ok(Math.abs(rtpBps - 9000) <= 50, `${policy}: ${rtpBps} bps after a deep start`);
    assert.ok(P < S, `${policy}: still behind after 2000 rounds`);
  }
});

test("Q6 a decision record replays to the same pick through the oracle", () => {
  const rnd = prng(0x77);
  for (let i = 0; i < 300; i++) {
    const e = exposureOf(randomBook(rnd));
    const S = BigInt(Math.floor(rnd() * 5_000_000));
    const P = (S * BigInt(70 + Math.floor(rnd() * 60))) / 100n;
    const b = bank({ cumulativeStakedPaise: S, cumulativePayoutPaise: P });
    const over: Partial<EngineParams> = {
      rtpHoldBps: 500 + Math.floor(rnd() * 2000),
      rtpRecoveryMode: rnd() < 0.5 ? "recover" : "target",
      aggressiveness: rnd(),
      rtpAggressivenessEnabled: rnd() < 0.5,
    };
    const d = run(e, b, over, `r-${i}`);
    if (d.noise) continue;
    const rec = d.rtp!;
    // Replay from the RECORD alone: history, hold, policy, aggressiveness,
    // round stakes and the evaluated payouts.
    const S2 = BigInt(rec.settledStakesPaise);
    const P2 = BigInt(rec.settledPayoutsPaise);
    const B2 = BigInt(rec.roundStakesPaise);
    const r2 = BigInt(10_000 - rec.holdBps);
    const target = (S2 + B2) * r2;
    const wanted = r2 * B2 * 10_000n + BigInt(rec.aggressivenessBps) * (r2 * S2 - 10_000n * P2);
    const recovering = rec.recoveryMode === "recover" && P2 > S2;
    const allLose = rec.evaluated.every((c) => B2 - BigInt(c.payoutPaise) < 0n);
    const minimise = recovering || (rec.recoveryMode === "recover" && allLose);
    const evaluated = rec.evaluated.map((c) => BigInt(c.payoutPaise));
    const pay = BigInt(rec.selectedPayoutPaise);
    assert.equal(rec.wantedPayoutPaise, (wanted / 100_000_000n).toString());
    if (minimise) {
      let min: bigint | null = null;
      for (const v of evaluated) if (min === null || v < min) min = v;
      assert.equal(pay, min, `case ${i}: the record does not justify its own pick`);
      assert.equal(rec.bracketLowPaise, null);
      assert.equal(rec.bracketHighPaise, null);
      assert.equal(rec.highChanceBps, 0);
      assert.equal(rec.drawnPayoutPaise, pay.toString());
    } else {
      // The bracket and the odds, from the evaluated list alone.
      const { lo, hi } = bracket(evaluated, wanted);
      const chance = highChance(lo, hi, wanted);
      assert.equal(rec.bracketLowPaise, lo === null ? null : lo.toString(), `case ${i}: low side`);
      assert.equal(rec.bracketHighPaise, hi === null ? null : hi.toString(), `case ${i}: high side`);
      assert.equal(rec.highChanceBps, Number(chance / 100_000n), `case ${i}: odds`);
      // The draw itself, replayed from the seed: the rng's draws are the
      // noise roll (the knob is on here), then the side. Band 0, so the
      // pick IS the drawn side.
      const rng = new SeededRng(`r-${i}`);
      assert.ok(rng.next() >= 0.02, "not a noise round");
      const drawn = lo !== null && hi !== null && lo !== hi
        ? (BigInt(Math.floor(rng.next() * 1e9)) < chance ? hi : lo)
        : (lo ?? hi)!;
      assert.equal(rec.drawnPayoutPaise, drawn.toString(), `case ${i}: the draw does not replay from the seed`);
      assert.equal(pay, drawn, `case ${i}: the record does not justify its own pick`);
    }
    assert.equal(rec.evaluated.length, e.outcomes.length);
    assert.equal(rec.targetErrorBpsPaise, abs((P2 + pay) * 10_000n - target).toString());
  }
});

// ── R1–R3: the pattern guards ───────────────────────────────────────────────

/**
 * The Prev-Bet exploit, reproduced: ONE book, replayed round after round
 * against a stream that starts behind its target. The stream wants more than
 * the board pays, so the plain argmin is the max-payout result every time.
 */
function replayFixedBook(book: Slip[], rounds: number, seed: string, over: Partial<EngineParams>) {
  const e = exposureOf(book);
  // Behind by ten times the most this board can pay: the shape of the live
  // stream, whose debt took six max-payout rounds to clear.
  const maxPay = e.outcomes.reduce((m, o) => (o.payoutPaise > m ? o.payoutPaise : m), 0n);
  let S = 1_000_000n + maxPay * 100n;
  let P = (S * 9n) / 10n - maxPay * 10n;
  let bankPaise = 0n;
  let recent: string[] = [];
  let longestRun = 0;
  let setAsides = 0;
  let capHits = 0;
  for (let r = 0; r < rounds; r++) {
    const b = bank({ cumulativeStakedPaise: S, cumulativePayoutPaise: P, bankPaise, minBankFloorPaise: -1_000_000_000n, recentChoiceIds: recent });
    const d = run(e, b, { rtpHoldBps: 1000, rtpRecoveryMode: "target", rtpNoiseEnabled: false, rtpTieBandPct: 0, ...over }, `${seed}-${r}`);
    assert.notEqual(d.choiceIndex, null, "no noise, so every round is a pick");
    const picked = e.outcomes[d.choiceIndex!]!;
    const rec = d.rtp!;
    // Every time the run reached the cap with another result on the board,
    // the guard had to act — and it may act at no other time.
    const runNow = leadingRun(recent);
    if (runNow && runNow.count >= rec.maxRepeat && e.outcomes.length > 1) capHits++;
    else assert.deepEqual(rec.repeatExcluded, [], `round ${r}: set aside under the cap`);
    // The record explains the guard: the run it read is the head of the
    // history it was given, and anything set aside is that run's result.
    assert.deepEqual(rec.recentChoiceIds, recent.slice(0, rec.maxRepeat));
    for (const id of rec.repeatExcluded) {
      assert.equal(id, recent[0], "set aside something other than the running result");
      assert.ok(leadingRun(recent)!.count >= rec.maxRepeat, "set aside a result under the cap");
      assert.notEqual(picked.choiceId, id, "picked the result it set aside");
      // Only ever with another floor-legal result to take instead.
      assert.ok(e.outcomes.some((o) => o.choiceId !== id && bankPaise + o.houseNetPaise >= -1_000_000_000n));
      setAsides++;
    }
    S += e.totalStakedPaise;
    P += picked.payoutPaise;
    bankPaise += picked.houseNetPaise;
    recent = [picked.choiceId, ...recent].slice(0, 40);
    longestRun = Math.max(longestRun, leadingRun(recent)!.count);
  }
  assert.equal(setAsides, capHits, "the guard did not act on every cap hit");
  return { longestRun, setAsides };
}

test("R1 the repeat guard: a replayed layout never runs past the cap, and without it the same layout repeats", () => {
  const rnd = prng(0x9E7);
  let controlRuns = 0;
  let guarded = 0;
  for (let i = 0; i < 40; i++) {
    const book = randomBook(rnd);
    // The control: the plain argmin on a fixed book is a fixed answer while
    // the deficit lasts — the 2026-09-16 shape.
    const control = replayFixedBook(book, 60, `ctl-${i}`, { rtpMaxRepeat: 50 });
    if (control.longestRun >= 4) controlRuns++;
    for (const cap of [1, 2, 3]) {
      const { longestRun, setAsides } = replayFixedBook(book, 60, `cap${cap}-${i}`, { rtpMaxRepeat: cap });
      assert.ok(longestRun <= cap, `book ${i}, cap ${cap}: a run of ${longestRun}`);
      if (setAsides > 0) guarded++;
    }
  }
  assert.ok(controlRuns >= 30, `the control reproduced the exploit on only ${controlRuns} of 40 books`);
  assert.ok(guarded >= 60, `the guard acted on only ${guarded} of 120 replays`);
});

test("R2 the near-tie band: picks stay inside it, the recorded pool is exactly it, band 0 is the exact rule, and it spreads the picks", () => {
  const rnd = prng(0xBA9D);
  let spread = 0;
  let exactOnly = 0;
  for (let i = 0; i < 1500; i++) {
    const e = exposureOf(randomBook(rnd));
    const S = BigInt(Math.floor(rnd() * 5_000_000));
    const P = (S * BigInt(70 + Math.floor(rnd() * 60))) / 100n;
    const b = bank({ cumulativeStakedPaise: S, cumulativePayoutPaise: P });
    const bandPct = [0, 0.01, 0.02, 0.05, 0.2][i % 5]!;
    const over: Partial<EngineParams> = {
      rtpHoldBps: Math.floor(rnd() * 10_001),
      rtpRecoveryMode: rnd() < 0.5 ? "recover" : "target",
      rtpNoiseEnabled: false,
      rtpTieBandPct: bandPct,
    };
    // The rule, restated: the draw lands on one of the two payouts either
    // side of the aim (the smallest when minimising); the tolerance is the
    // band's share of THIS ROUND's stake, in paise; a result is in the pool
    // iff its payout is within that of the drawn one.
    const p = { ...DEFAULT_PARAMS, ...KNOBS_ON, ...over };
    const r = BigInt(10_000 - p.rtpHoldBps);
    const a = BigInt(500 + Math.round(p.aggressiveness * 9_500));
    const wanted = r * e.totalStakedPaise * 10_000n + a * (r * S - 10_000n * P);
    const minimise = p.rtpRecoveryMode === "recover" && (P > S || e.outcomes.every((o) => o.houseNetPaise < 0n));
    const payouts = e.outcomes.map((o) => o.payoutPaise);
    const { lo, hi } = bracket(payouts, wanted);
    const sides: bigint[] = minimise ? [payouts.reduce((m, v) => (v < m ? v : m))] : [lo, hi].filter((v): v is bigint => v !== null);
    const tolPaise = (BigInt(Math.round(bandPct * 10_000)) * e.totalStakedPaise) / 10_000n;
    const seen = new Set<number>();
    let lonePool = false;
    for (let k = 0; k < 4; k++) {
      const d = run(e, b, over, `band-${i}-${k}`);
      const picked = e.outcomes[d.choiceIndex!]!;
      const drawn = BigInt(d.rtp!.drawnPayoutPaise);
      assert.ok(sides.includes(drawn), `case ${i}: drew ${drawn}, not a side of the aim (${sides.join(",")})`);
      const pool = e.outcomes.filter((o) => abs(o.payoutPaise - drawn) <= tolPaise).map((o) => o.choiceId).sort();
      assert.ok(abs(picked.payoutPaise - drawn) <= tolPaise, `case ${i}: picked outside the band`);
      assert.deepEqual(d.candidates.map((c) => c.choiceId).sort(), pool, `case ${i}: the recorded pool is not the band`);
      assert.equal(d.rtp!.tieBandPaise, tolPaise.toString());
      assert.equal(d.rtp!.tieBandBps, Math.round(bandPct * 10_000));
      if (bandPct === 0) assert.equal(picked.payoutPaise, drawn, `case ${i}: band 0 is not the exact rule`);
      if (pool.length === 1) lonePool = true;
      seen.add(d.choiceIndex!);
    }
    if (bandPct > 0 && seen.size > 1) spread++;
    if (bandPct === 0 && lonePool) exactOnly++;
  }
  assert.ok(spread > 100, `a non-zero band spread the picks on only ${spread} rounds`);
  // On a wheel most results tie at zero, so a lone exact answer is the
  // minority case; enough of them that the band-0 check above meant something.
  assert.ok(exactOnly > 30, `band 0 rarely had a single exact answer (${exactOnly}) — the generator changed`);
});

test("R4 with no history every round aims for its own share; the draw alone holds the target, and the shipped repeat guard pulls it under", () => {
  // `cumulativeFor` answers zero totals under `none` before any query; the
  // selector then sees S = P = 0 every round. Simulated here by handing it
  // exactly that, with the history still threaded for the repeat guard.
  const noMemory = (over: Partial<EngineParams>, seed: number) => {
    const rnd = prng(seed);
    let S = 0n;
    let P = 0n;
    let recent: string[] = [];
    for (let r = 0; r < 3000; r++) {
      const e = exposureOf(randomBook(rnd));
      const b = bank({ cumulativeStakedPaise: 0n, cumulativePayoutPaise: 0n, minBankFloorPaise: -1_000_000_000n, recentChoiceIds: recent });
      const d = run(e, b, { rtpHoldBps: 1000, rtpRecoveryMode: "target", rtpHistoryScope: "none", rtpNoiseEnabled: false, ...over }, `none-${seed}-${r}`);
      assert.equal(d.rtp!.historyScope, "none");
      assert.equal(d.rtp!.settledStakesPaise, "0");
      assert.ok(!d.alerts.includes("RTP_LOSS_RECOVERY"), "nothing to recover with no history");
      const picked = e.outcomes[d.choiceIndex!]!;
      S += e.totalStakedPaise;
      P += picked.payoutPaise;
      recent = [picked.choiceId, ...recent].slice(0, 40);
    }
    return Number((P * 10_000n) / S);
  };
  // The draw's whole claim: with nothing carried, the expected payout of
  // every round is its share, so the stream lands on target anyway. Before
  // the draw (2026-10-14) "closest" with no memory settled at 84% on this
  // seed, because a board's payout steps biased every pick the same way.
  for (const seed of [0x0A11, 0x0A12]) {
    const bps = noMemory({ rtpMaxRepeat: 50, rtpTieBandPct: 0 }, seed);
    assert.ok(Math.abs(bps - 9000) <= 50, `no-memory RTP with the guards off: ${bps} bps`);
    const banded = noMemory({ rtpMaxRepeat: 50, rtpTieBandPct: 0.02 }, seed);
    assert.ok(Math.abs(banded - 9000) <= 50, `no-memory RTP with the band on: ${banded} bps`);
  }
  // The shipped repeat guard only ever swaps in a CHEAPER result, and under
  // `none` nothing carries the difference — so it pulls the stream about a
  // point under (measured 8875–8938 bps over three seeds). Both panels say
  // so; move that copy if this band moves.
  const shipped = noMemory({ rtpMaxRepeat: 2, rtpTieBandPct: 0.02 }, 0x0A11);
  assert.ok(shipped >= 8700 && shipped <= 9000, `no-memory RTP with the shipped guards ${shipped} bps — the panels say about a point under`);
});

test("R3 with both guards on, a stream of random books still lands on target under both policies", () => {
  for (const policy of ["recover", "target"] as const) {
    const { rtpBps, longestRun, aheadWhileAvoidable } = simulate(1000, policy, 3000, 0xF00D, {
      rtpNoiseEnabled: false, rtpMaxRepeat: 2, rtpTieBandPct: 0.02,
    });
    assert.ok(Math.abs(rtpBps - 9000) <= 50, `${policy}: ${rtpBps} bps with the guards on`);
    assert.ok(longestRun <= 2, `${policy}: a run of ${longestRun} with the cap at 2`);
    assert.equal(aheadWhileAvoidable, 0, `${policy}: took an avoidable loss while behind`);
  }
});
