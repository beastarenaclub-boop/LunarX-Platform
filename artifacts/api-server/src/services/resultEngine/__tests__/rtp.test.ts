import { test } from "node:test";
import assert from "node:assert/strict";
import { computeExposure, type Exposure } from "../exposure";
import { DEFAULT_PARAMS, resolveParams, toEngineMode, type EngineParams } from "../params";
import { decide, leadingRun, type BankState } from "../selectors";
import { SeededRng } from "../rng";

function book(stake: bigint, payouts: bigint[]): Exposure {
  return computeExposure(payouts.map((payout, i) => ({ id: String(i), label: String(i), outcome: payout })),
    [{ userId: "one", bets: [], stakePaise: stake }], 0.6, (_bets, outcome) => outcome as bigint);
}
function bank(over: Partial<BankState> = {}): BankState {
  return {
    bankPaise: 1000000n, minBankFloorPaise: 0n, zeroBetStreak: 0,
    beneficiaryStreak: 0, lastBeneficiaryUserId: null, recentChoiceIds: [],
    windowStakedPaise: 0n, windowHouseNetPaise: 0n,
    cumulativeStakedPaise: 0n, cumulativePayoutPaise: 0n, ...over,
  };
}
/**
 * Aggressiveness 1 and the minimum noise, unless a test says otherwise: these
 * pin the documented examples, which close the whole running gap in one round,
 * and a noise round would replace the pick under test with an honest draw.
 * The repeat guard and the near-tie band are pinned OFF too (a 50-round cap
 * no history here reaches; a zero band), because the examples describe the
 * exact argmin; the two guards have their own examples below.
 */
function run(e: Exposure, state = bank(), over: Partial<EngineParams> = {}, seed = "rtp") {
  return decide(
    "rtp",
    e,
    { ...DEFAULT_PARAMS, rtpRecoveryMode: "recover", rtpAggressivenessEnabled: true, rtpNoiseEnabled: true, aggressiveness: 1, noiseRate: 0.02, rtpMaxRepeat: 50, rtpTieBandPct: 0, ...over },
    state,
    new SeededRng(seed),
    seed,
  );
}

test("RTP defaults to 90% player return, tried for on EVERY round, and accepts both loss policies", () => {
  assert.equal(toEngineMode("rtp"), "rtp");
  assert.equal(resolveParams(null).rtpHoldBps, 1000);
  // The defaults: no honest rounds, the whole gap carried, never a
  // deliberate minimum-payout round — every round aims at the target.
  assert.equal(resolveParams(null).rtpRecoveryMode, "target");
  assert.equal(resolveParams(null).rtpNoiseEnabled, false);
  assert.equal(resolveParams(null).rtpAggressivenessEnabled, false);
  assert.equal(resolveParams({ rtpRecoveryMode: "recover" }).rtpRecoveryMode, "recover");
  assert.equal(resolveParams({ rtpRecoveryMode: "invalid", rtpHoldBps: 10001 }).rtpRecoveryMode, "target");
  assert.equal(resolveParams({ rtpHoldBps: 100.5 }).rtpHoldBps, 1000);
  // The two pattern guards ship ON: no result three rounds running, and
  // results within 2% of the round's stake of the best drawn at random.
  assert.equal(resolveParams(null).rtpMaxRepeat, 2);
  assert.equal(resolveParams(null).rtpTieBandPct, 0.02);
  assert.equal(resolveParams({ rtpMaxRepeat: 3 }).rtpMaxRepeat, 3);
  assert.equal(resolveParams({ rtpMaxRepeat: 0 }).rtpMaxRepeat, 2, "the cap cannot be zero — that is every round set aside");
  assert.equal(resolveParams({ rtpMaxRepeat: 2.5 }).rtpMaxRepeat, 2);
  assert.equal(resolveParams({ rtpTieBandPct: 0 }).rtpTieBandPct, 0, "zero is legal: exact ties only");
  assert.equal(resolveParams({ rtpTieBandPct: 0.5 }).rtpTieBandPct, 0.02, "a band wider than a fifth of the stake is refused");
  // The history the target is measured over: every round by default, a
  // rolling week or day, or none at all; anything else is the default.
  assert.equal(resolveParams(null).rtpHistoryScope, "all");
  for (const scope of ["all", "7d", "24h", "none"] as const) assert.equal(resolveParams({ rtpHistoryScope: scope }).rtpHistoryScope, scope);
  assert.equal(resolveParams({ rtpHistoryScope: "30d" }).rtpHistoryScope, "all");
  assert.equal(resolveParams({ rtpHistoryScope: 24 }).rtpHistoryScope, "all");
});

/**
 * THE PREV-BET EXPLOIT (2026-09-16). A stream in deficit wants more than any
 * result on the board pays, so "closest" is the highest-paying result for
 * that layout — a fixed answer for a fixed book. A player re-staging the same
 * layout saw pocket 10 land six rounds running, paid at 118% each time.
 */
test("the repeat guard sets aside a result that has run rtpMaxRepeat rounds and takes the next-closest", () => {
  // Deficit: the stream has paid 80% against a 90% target, so it wants far
  // more than the 1800 the board can pay — the argmin is the max payout.
  const e = book(1000n, [0n, 900n, 1800n]);
  const behind = { cumulativeStakedPaise: 100_000n, cumulativePayoutPaise: 80_000n };
  const guard = (recent: string[], over: Partial<EngineParams> = {}) =>
    run(e, bank({ ...behind, recentChoiceIds: recent }), { rtpRecoveryMode: "target", rtpMaxRepeat: 2, ...over });
  assert.equal(guard([]).choiceId, "2", "no history: the max payout, as before");
  assert.equal(guard(["2"]).choiceId, "2", "one repeat is under the cap");
  const d = guard(["2", "2"]);
  assert.equal(d.choiceId, "1", "at the cap the next-closest lands instead");
  assert.deepEqual(d.rtp!.repeatExcluded, ["2"]);
  assert.deepEqual(d.rtp!.recentChoiceIds, ["2", "2"], "the record carries the history the guard read");
  assert.equal(d.rtp!.maxRepeat, 2);
  assert.ok(d.alerts.includes("RTP_REPEAT_GUARD"), "the guard changed the answer, so the round is flagged");
  assert.match(d.reason, /set aside 2, which had landed 2 rounds running/u);
  assert.deepEqual(d.candidates.map((c) => c.choiceId), ["1"], "the set-aside result is not in the pool the pick was drawn from");
  // The history counts every landed round, so an older run does not matter,
  // and a broken run resets: 2, 1, 2 is not a run of two.
  assert.equal(guard(["2", "1", "2", "2", "2"]).choiceId, "2");
  // A higher cap is the operator's to set.
  assert.equal(guard(["2", "2"], { rtpMaxRepeat: 3 }).choiceId, "2");
  assert.equal(guard(["2", "2", "2"], { rtpMaxRepeat: 3 }).choiceId, "1");
  // A run of the CHEAPEST result is never set aside: nothing pays less, so
  // the only swap available would make the round dearer (2026-10-12).
  const quiet = guard(["0", "0"]);
  assert.equal(quiet.choiceId, "2");
  assert.deepEqual(quiet.rtp!.repeatExcluded, []);
  assert.ok(!quiet.alerts.includes("RTP_REPEAT_GUARD"));
  // Under recover with the house losing, the minimum payout lands however
  // long its run — the guard used to force 900 here instead of 0.
  const losing = bank({ cumulativeStakedPaise: 1000n, cumulativePayoutPaise: 2000n, recentChoiceIds: ["0", "0"] });
  const r = run(e, losing, { rtpMaxRepeat: 2 });
  assert.equal(r.choiceId, "0", "the smallest payout, run or no run");
  assert.deepEqual(r.rtp!.repeatExcluded, []);
  // A middle-cost run swaps only toward cheaper results, never the dearer one.
  const mid = guard(["1", "1"], { rtpRecoveryMode: "target" });
  assert.notEqual(mid.choiceId, "1");
  assert.equal(mid.choiceId, "0", "1800 pays more than the run it replaces, so only 0 may stand in");
});

/**
 * THE FORCED-FLIP EXPLOIT (2026-10-12, andar-bahar, one partner stream). With
 * two results and a cap of 2, two landings of one side meant the other side
 * was forced next. A player read the history strip, staked ₹100 on the side
 * that would make a run of two (the engine, holding 90%, let him lose it),
 * then ₹500 on the side the guard had to land — 12 of 12 forced rounds won,
 * ₹7,100 staked, ₹12,400 paid. Replayed here at 1.95x: the guard may only
 * make a round cheaper, so the forced round is no longer a free win and the
 * player settles near the target like anyone else.
 */
test("the repeat guard never forces a payout: the andar-bahar build-a-run, bet-the-flip cycle settles near target", () => {
  const sides = ["andar", "bahar"] as const;
  const other = (s: string) => (s === "andar" ? "bahar" : "andar");
  let S = 0n;
  let P = 0n;
  let staked = 0n;
  let paid = 0n;
  let bigBets = 0;
  let bigWins = 0;
  let recent: string[] = [];
  for (let r = 0; r < 600; r++) {
    // His rule: two of one side on the strip → ₹500 on the other side;
    // otherwise ₹100 on the side opposite the last result, so the engine's
    // pick builds the run.
    const last = recent[0] ?? "andar";
    const runOfTwo = recent.length >= 2 && recent[0] === recent[1];
    const side = other(last);
    const stake = runOfTwo ? 50_000n : 10_000n;
    const e = computeExposure(
      sides.map((s) => ({ id: s, label: s, outcome: s })),
      [{ userId: "one", bets: [], stakePaise: stake }],
      0.6,
      (_bets, outcome) => (outcome === side ? (stake * 195n) / 100n : 0n),
    );
    const d = decide(
      "rtp",
      e,
      { ...DEFAULT_PARAMS, rtpHoldBps: 1000, rtpRecoveryMode: "target", rtpHistoryScope: "all", rtpMaxRepeat: 2, rtpTieBandPct: 0, rtpNoiseEnabled: false, rtpAggressivenessEnabled: false, maxBeneficiaryStreak: 50 },
      bank({ bankPaise: 0n, minBankFloorPaise: -1_000_000_000n, cumulativeStakedPaise: S, cumulativePayoutPaise: P, recentChoiceIds: recent }),
      new SeededRng(`flip-${r}`),
      `flip-${r}`,
    );
    const picked = e.outcomes[d.choiceIndex!]!;
    // Whatever the guard set aside, what landed instead paid no more than it.
    for (const id of d.rtp!.repeatExcluded) {
      const cheapestRun = e.outcomes.filter((o) => o.choiceId === id).reduce((m, o) => (o.payoutPaise < m ? o.payoutPaise : m), picked.payoutPaise + 1n);
      assert.ok(picked.payoutPaise <= cheapestRun, `round ${r}: the guard swapped in a dearer result`);
    }
    if (runOfTwo) {
      bigBets++;
      if (picked.payoutPaise > 0n) bigWins++;
    }
    S += e.totalStakedPaise;
    P += picked.payoutPaise;
    staked += stake;
    paid += picked.payoutPaise;
    recent = [picked.choiceId!, ...recent].slice(0, 40);
  }
  const rtpBps = Number((paid * 10_000n) / staked);
  assert.ok(bigBets > 50, `the strategy placed only ${bigBets} big bets`);
  assert.ok(bigWins < bigBets * 0.75, `the forced round still wins: ${bigWins} of ${bigBets}`);
  assert.ok(rtpBps <= 9500, `the cycle still beats the target: ${rtpBps} bps`);
});

test("the bank floor outranks the repeat guard: the only floor-legal result lands however long its run", () => {
  const e = book(1000n, [0n, 900n, 1800n]);
  // Bank 0, floor 500: only the zero payout (house net +1000) is legal.
  const state = bank({ bankPaise: 0n, minBankFloorPaise: 500n, cumulativeStakedPaise: 100_000n, cumulativePayoutPaise: 80_000n, recentChoiceIds: ["0", "0", "0", "0"] });
  const d = run(e, state, { rtpRecoveryMode: "target", rtpMaxRepeat: 2 });
  assert.equal(d.choiceId, "0");
  assert.deepEqual(d.rtp!.repeatExcluded, [], "nothing was set aside — there was nothing else legal");
  assert.ok(!d.alerts.includes("RTP_REPEAT_GUARD"));
  assert.ok(!d.alerts.includes("BANK_FLOOR_UNREACHABLE"), "the floor was reachable, by exactly one result");
  assert.deepEqual(leadingRun(["0", "0", "0", "0"]), { id: "0", count: 4 });
  assert.deepEqual(leadingRun(["0", "1", "0"]), { id: "0", count: 1 });
  assert.equal(leadingRun([]), null);
});

test("the near-tie band draws at random among results within it, and zero keeps exact ties only", () => {
  // On target: this round wants 900. 900 is exact; 890 is 10 off, inside a
  // 2% band on a 1000 stake (20); 0 and 1800 are far outside it.
  const e = book(1000n, [0n, 890n, 900n, 1800n]);
  const state = bank({ cumulativeStakedPaise: 10_000n, cumulativePayoutPaise: 9_000n });
  const seen = (band: number) => {
    const ids = new Set<string | null>();
    let record: ReturnType<typeof run> | null = null;
    for (let i = 0; i < 60; i++) {
      const d = run(e, state, { rtpRecoveryMode: "target", rtpTieBandPct: band, rtpNoiseEnabled: false }, `band-${band}-${i}`);
      ids.add(d.choiceId);
      record ??= d;
    }
    return { ids, record: record! };
  };
  const wide = seen(0.02);
  assert.deepEqual([...wide.ids].sort(), ["1", "2"], "both results inside the band land; nothing outside it does");
  assert.equal(wide.record.rtp!.tieBandBps, 200);
  assert.equal(wide.record.rtp!.tieBandPaise, "20");
  assert.deepEqual(wide.record.candidates.map((c) => c.choiceId).sort(), ["1", "2"], "the recorded pool is exactly the band");
  const exact = seen(0);
  assert.deepEqual([...exact.ids], ["2"], "band 0: the exact argmin, as before");
  assert.equal(exact.record.rtp!.tieBandPaise, "0");
  // The band is a share of THIS round's stake, not of the history: the same
  // 10 paise off was inside the band on a stake of 1000 (2% = 20) and is
  // outside it on a stake of 100 (2% = 2).
  const small = book(100n, [0n, 80n, 90n, 180n]);
  const ids = new Set<string | null>();
  for (let i = 0; i < 30; i++) ids.add(run(small, state, { rtpRecoveryMode: "target", rtpTieBandPct: 0.02, rtpNoiseEnabled: false }, `s-${i}`).choiceId);
  assert.deepEqual([...ids], ["2"]);
});

test("with the defaults every round pays as close to its share of the target as the book allows", () => {
  const defaults = (e: Exposure, state: BankState, seed = "d") =>
    decide("rtp", e, { ...DEFAULT_PARAMS, noiseRate: 1, aggressiveness: 0 }, state, new SeededRng(seed), seed);
  // On target so far: this round's own 90%.
  assert.equal(defaults(book(1000n, [0n, 900n, 1800n]), bank({ cumulativeStakedPaise: 10000n, cumulativePayoutPaise: 9000n })).choiceId, "1");
  // Behind by ₹1 after a player win: the aim is its share less the gap
  // (900 − 100 = 800), which the board brackets with 0 and 900 — so the
  // round is drawn, 900 eight times in nine, and the miss carries.
  const ids = new Map<string | null, number>();
  for (let i = 0; i < 180; i++) {
    const d = defaults(book(1000n, [0n, 900n, 1800n]), bank({ cumulativeStakedPaise: 1000n, cumulativePayoutPaise: 1000n }), `behind-${i}`);
    ids.set(d.choiceId, (ids.get(d.choiceId) ?? 0) + 1);
    assert.equal(d.rtp!.highChanceBps, 8888, "800 / 900, floored to a basis point");
  }
  assert.deepEqual([...ids.keys()].sort(), ["0", "1"], "only the two sides of the aim land");
  assert.ok(ids.get("1")! >= 180 * 0.75, `900 landed ${ids.get("1")} of 180 at 8 in 9`);
  // A round whose book cannot pay its share (one ₹10 straight: 0 or 360)
  // is drawn at 9 in 360 for the 360 and otherwise pays 0 with the ₹9
  // carried; forty zero rounds later the aim is past the 360 and it lands.
  const single = book(10n, [0n, 360n]);
  let hits = 0;
  for (let i = 0; i < 400; i++) if (defaults(single, bank(), `single-${i}`).choiceId === "1") hits++;
  assert.ok(hits <= 40, `the 360 landed ${hits} of 400 at 2.5%`);
  assert.equal(defaults(single, bank({ cumulativeStakedPaise: 400n, cumulativePayoutPaise: 0n })).choiceId, "1");
  // Never a noise round with the defaults, even at noiseRate 1.
  for (let i = 0; i < 200; i++) assert.equal(defaults(book(1000n, [0n, 900n]), bank(), `n-${i}`).noise, false);
});

test("RTP prices the whole current round and includes returned stakes", () => {
  const d = run(book(10000n, [0n, 9000n, 18000n]));
  assert.equal(d.choiceId, "1");
  assert.equal(d.houseDeltaPaise, "1000");
  assert.equal(d.rtp?.targetErrorBpsPaise, "0");
});

test("RTP carries earlier excess hold forward instead of restarting each round", () => {
  const d = run(book(1000n, [0n, 900n, 1800n]), bank({ cumulativeStakedPaise: 10000n, cumulativePayoutPaise: 8100n }));
  assert.equal(d.choiceId, "2"); // 9900 / 11000 = 90%
});

test("RTP has distinct loss-recovery and closest-target behavior", () => {
  const state = bank({ cumulativeStakedPaise: 1000n, cumulativePayoutPaise: 1100n });
  const e = book(1000n, [0n, 700n, 1000n]);
  const recover = run(e, state, { rtpRecoveryMode: "recover" });
  const target = run(e, state, { rtpRecoveryMode: "target" });
  assert.equal(recover.choiceId, "0");
  assert.ok(recover.alerts.includes("RTP_LOSS_RECOVERY"));
  assert.equal(target.choiceId, "1"); // 1800 / 2000 = 90%
  assert.equal(target.rtp?.targetErrorBpsPaise, "0");
});

test("recovery minimises unavoidable losses; target mode can return previous excess hold", () => {
  const e = book(1000n, [1100n, 1900n, 2500n]);
  const state = bank({ cumulativeStakedPaise: 10000n, cumulativePayoutPaise: 8000n });
  const recover = run(e, state, { rtpRecoveryMode: "recover" });
  assert.equal(recover.choiceId, "0");
  assert.ok(recover.alerts.includes("RTP_MINIMUM_LOSS"));
  assert.equal(run(e, state, { rtpRecoveryMode: "target" }).choiceId, "1");
});

test("RTP honours the bank floor; an unreachable floor takes the minimum loss", () => {
  const e = book(1000n, [1100n, 1300n, 1400n]);
  for (const rtpRecoveryMode of ["recover", "target"] as const) {
    const d = run(e, bank({ bankPaise: 0n }), { rtpRecoveryMode });
    assert.equal(d.choiceId, "0");
    assert.ok(d.alerts.includes("BANK_FLOOR_UNREACHABLE"));
  }
  const d = run(book(1000n, [0n, 1800n]), bank({ bankPaise: 500n, cumulativeStakedPaise: 10000n, cumulativePayoutPaise: 8100n }));
  assert.equal(d.choiceId, "0", "the exact RTP result would breach the floor");
});

test("manual bank edits do not change cumulative RTP or trigger loss recovery", () => {
  const e = book(1000n, [0n, 900n]);
  for (const balance of [0n, 1000000n]) {
    assert.equal(run(e, bank({ bankPaise: balance })).choiceId, "1");
  }
});

test("RTP compares large money totals without floating-point loss", () => {
  const large = 100000000000000000000n;
  const d = run(book(10n, [8n, 9n, 10n]), bank({ cumulativeStakedPaise: large, cumulativePayoutPaise: large * 9n / 10n }));
  assert.equal(d.choiceId, "1");
  assert.equal(d.rtp?.targetErrorBpsPaise, "0");
});

test("0% and 100% RTP and fractional percentages use basis points", () => {
  const e = book(10000n, [0n, 9123n, 10000n]);
  assert.equal(run(e, bank(), { rtpHoldBps: 10000 }).choiceId, "0");
  assert.equal(run(e, bank(), { rtpHoldBps: 0 }).choiceId, "2");
  assert.equal(run(e, bank(), { rtpHoldBps: 877 }).choiceId, "1");
});

test("RTP preserves natural draws for empty books and missing candidates", () => {
  assert.equal(run(book(0n, [0n])).choiceIndex, null);
  assert.equal(run(book(100n, [])).choiceIndex, null);
  assert.throws(() => run(book(100n, [0n]), bank({ cumulativeStakedPaise: undefined })), /totals are required/);
});

test("streak settings cannot defeat RTP's loss policy; exact ties remain replayable", () => {
  const e = book(100n, [0n, 0n, 100n]);
  const state = bank({ cumulativeStakedPaise: 100n, cumulativePayoutPaise: 200n, recentChoiceIds: Array(20).fill("0"), zeroBetStreak: 50 });
  const seen = new Set<string | null>();
  for (let i = 0; i < 50; i++) {
    const seed = `tie-${i}`;
    const d = run(e, state, {}, seed);
    if (d.noise) continue; // the 2% floor; an honest draw names nothing
    assert.notEqual(d.choiceId, "2");
    assert.deepEqual(d, run(e, state, {}, seed));
    seen.add(d.choiceId);
  }
  assert.equal(seen.size, 2);
});

test("noise rounds draw honestly at the configured rate, before anything is ranked", () => {
  const e = book(1000n, [0n, 900n, 1800n]);
  const state = bank({ cumulativeStakedPaise: 1000n, cumulativePayoutPaise: 1100n });
  let noisy = 0;
  for (let i = 0; i < 2000; i++) {
    const d = run(e, state, { noiseRate: 0.3 }, `noise-${i}`);
    if (d.noise) {
      noisy++;
      assert.equal(d.choiceIndex, null, "a noise round must not name a result");
      assert.equal(d.mode, "rtp");
      assert.equal(d.rtp, undefined);
    } else {
      // Recovering (P > S): every steered round takes the minimum payout.
      assert.equal(d.choiceId, "0");
    }
  }
  assert.ok(noisy > 500 && noisy < 700, `expected ~600 noise rounds in 2000, saw ${noisy}`);
  // Noise 1 means the engine never steers at all.
  assert.equal(run(e, state, { noiseRate: 1 }).choiceIndex, null);
});

test("either knob can be switched off: no noise at all, or the gap closed in full every round", () => {
  assert.equal(resolveParams({ rtpNoiseEnabled: true }).rtpNoiseEnabled, true);
  assert.equal(resolveParams({ rtpAggressivenessEnabled: true }).rtpAggressivenessEnabled, true);
  assert.equal(resolveParams({ rtpNoiseEnabled: false }).rtpNoiseEnabled, false);
  assert.equal(resolveParams({ rtpNoiseEnabled: "yes" }).rtpNoiseEnabled, false, "only an explicit true switches it on");
  const e = book(1000n, [0n, 900n, 1800n]);
  const behind = bank({ cumulativeStakedPaise: 1000n, cumulativePayoutPaise: 1100n });
  // Noise off: 2000 rounds at noiseRate 1 and not one honest draw.
  for (let i = 0; i < 2000; i++) {
    const d = run(e, behind, { noiseRate: 1, rtpNoiseEnabled: false }, `off-${i}`);
    assert.equal(d.noise, false);
    assert.equal(d.choiceId, "0");
    assert.equal(d.rtp?.noiseRate, 0);
  }
  // Aggressiveness off: the setting is ignored and the whole gap closes now.
  const state = bank({ cumulativeStakedPaise: 1_000_000n, cumulativePayoutPaise: 810_000n });
  const wide = book(100_000n, [0n, 90_000n, 135_000n, 180_000n]);
  const d = run(wide, state, { aggressiveness: 0, rtpAggressivenessEnabled: false });
  assert.equal(d.choiceId, "3");
  assert.equal(d.rtp?.aggressivenessBps, 10000);
  assert.equal(run(wide, state, { aggressiveness: 0 }).choiceId, "1", "on, the setting is read");
});

test("aggressiveness is the share of the running gap repaid this round", () => {
  // 90% target: the house has held ₹1,900 of ₹10,000 (gap ₹900 owed to
  // players); this round stakes ₹1,000, whose own share is ₹900.
  const state = bank({ cumulativeStakedPaise: 1_000_000n, cumulativePayoutPaise: 810_000n });
  // Each setting's aim sits exactly on a payout, so no draw is involved.
  const e = book(100_000n, [0n, 94_500n, 137_250n, 180_000n]);
  assert.equal(run(e, state, { aggressiveness: 0 }).choiceId, "1", "0 repays only 5% of the gap: this round's share plus ₹45");
  assert.equal(run(e, state, { aggressiveness: 0.5 }).choiceId, "2", "0.5 repays a little over half the gap");
  assert.equal(run(e, state, { aggressiveness: 1 }).choiceId, "3", "1 closes the gap in one round");
  const d = run(e, state, { aggressiveness: 0.5 });
  assert.equal(d.rtp?.aggressivenessBps, 5250, "5% floor + 95% of the setting");
  assert.equal(d.rtp?.wantedPayoutPaise, "137250");
  assert.equal(run(e, state, { aggressiveness: 0 }).rtp?.aggressivenessBps, 500);
  assert.equal(run(e, state, { aggressiveness: 1 }).rtp?.aggressivenessBps, 10000);
  // The record still measures distance from the CUMULATIVE target.
  assert.equal(d.rtp?.targetErrorBpsPaise, ((1_000_000n + 100_000n) * 9_000n - (810_000n + 137_250n) * 10_000n).toString());
  // Recovery outranks it: behind, the smallest payout whatever the setting.
  const behind = bank({ cumulativeStakedPaise: 1000n, cumulativePayoutPaise: 1100n });
  for (const aggressiveness of [0, 0.5, 1]) {
    assert.equal(run(book(1000n, [0n, 700n, 1000n]), behind, { aggressiveness }).choiceId, "0");
  }
});

test("unpriceable RTP candidates fail rather than masquerading as zero payout", () => {
  assert.throws(() => computeExposure([{ id: "bad", label: "bad", outcome: {} }],
    [{ userId: "one", bets: [], stakePaise: 100n }], 0.6, () => { throw new Error("invalid payout"); }, true), /invalid payout/);
});

test("discrete payouts converge through carried error on a repeatable 2000-round book", () => {
  for (const aggressiveness of [1, 0.5]) {
    let stakes = 0n;
    let payouts = 0n;
    for (let i = 0; i < 2000; i++) {
      const e = book(1000n, [0n, 2000n]);
      const d = run(e, bank({ cumulativeStakedPaise: stakes, cumulativePayoutPaise: payouts }), { rtpRecoveryMode: "target", aggressiveness }, String(i));
      stakes += e.totalStakedPaise;
      // A noise round (2%) lands on either result by the game's own draw.
      const landed = d.choiceIndex === null ? e.outcomes[i % 2]! : e.outcomes[d.choiceIndex]!;
      payouts += landed.payoutPaise;
      // Never more than one honest round plus one payout step off target.
      assert.ok((payouts * 10n - stakes * 9n) ** 2n <= (40_000n) ** 2n, `round ${i}: ${payouts * 10n - stakes * 9n}`);
    }
    const bps = (payouts * 10_000n) / stakes;
    assert.ok(bps >= 8_950n && bps <= 9_050n, `aggressiveness ${aggressiveness}: ${bps} bps`);
  }
});

/**
 * THE COVER-AND-HOLES STREAK (2026-09-19). One account covered 16 of 19
 * pockets at the ceiling, another sat on the three it left open. The holes
 * paid less than the cover, so they were the closest result every round and
 * the second account was paid 6x on 14 of 15 rounds — a different pocket each
 * time, so the repeat guard never fired; only the winner repeated.
 */
test("the beneficiary guard sets aside every result the streaking account would top and takes the closest of the rest", () => {
  // B = 1000, target 90 %, no history: wanted 900. "holes" tops result 3 at
  // exactly 900 (the aim itself, so no draw); "cover" tops 0, 1 and 2 at 880
  // each — cheaper, so the guard may stand them in.
  const cands = [0, 1, 2, 3].map((i) => ({ id: String(i), label: String(i), outcome: i }));
  const e = computeExposure(cands, [
    { userId: "cover", bets: [880n, 880n, 880n, 0n], stakePaise: 800n },
    { userId: "holes", bets: [0n, 0n, 0n, 900n], stakePaise: 200n },
  ], 0.6, (bets, o) => (bets as bigint[])[o as number]!);
  const guard = (beneficiaryStreak: number, lastBeneficiaryUserId: string | null, over: Partial<EngineParams> = {}) =>
    run(e, bank({ beneficiaryStreak, lastBeneficiaryUserId }), { rtpRecoveryMode: "target", maxBeneficiaryStreak: 3, ...over });
  assert.equal(guard(0, null).choiceId, "3", "no streak: the closest result, as before");
  assert.equal(guard(2, "holes").choiceId, "3", "two in a row is under the cap");
  const d = guard(3, "holes");
  assert.ok(["0", "1", "2"].includes(d.choiceId!), `at the cap a result somebody else tops lands instead, got ${d.choiceId}`);
  assert.deepEqual(d.rtp!.beneficiaryExcluded, ["3"]);
  assert.equal(d.rtp!.beneficiaryStreak, 3);
  assert.equal(d.rtp!.lastBeneficiaryUserId, "holes");
  assert.equal(d.rtp!.maxBeneficiaryStreak, 3);
  assert.ok(d.alerts.includes("BENEFICIARY_STREAK"));
  assert.ok(!d.candidates.some((c) => c.choiceId === "3"), "the set-aside result is not in the pool the pick was drawn from");
  // A higher cap is the operator's to set; a streak on somebody else changes nothing.
  assert.equal(guard(3, "holes", { maxBeneficiaryStreak: 4 }).choiceId, "3");
  assert.equal(guard(5, "cover").choiceId, "3");
  // The filter holds only if it leaves something: an account topping EVERY
  // result keeps winning rather than the round having no answer.
  const only = computeExposure(cands, [{ userId: "holes", bets: [950n, 950n, 950n, 880n], stakePaise: 1000n }], 0.6, (bets, o) => (bets as bigint[])[o as number]!);
  const alone = run(only, bank({ beneficiaryStreak: 9, lastBeneficiaryUserId: "holes" }), { rtpRecoveryMode: "target" });
  assert.equal(alone.choiceId, "3");
  assert.deepEqual(alone.rtp!.beneficiaryExcluded, []);
  assert.ok(!alone.alerts.includes("BENEFICIARY_STREAK"));
});

/**
 * The guard may only stand in a result paying no more than the cheapest one
 * the streaking account tops (2026-10-12). The 09-19 numbers — the holes WERE
 * the cheapest results — therefore no longer trip it; the player cap, which
 * weighs each account's RTP over the history in paise, takes that case.
 */
test("the beneficiary guard never stands in a dearer result; the 09-19 cover-and-holes streak is the player cap's", () => {
  const cands = [0, 1, 2, 3].map((i) => ({ id: String(i), label: String(i), outcome: i }));
  const e = computeExposure(cands, [
    { userId: "cover", bets: [950n, 950n, 950n, 0n], stakePaise: 800n },
    { userId: "holes", bets: [0n, 0n, 0n, 880n], stakePaise: 200n },
  ], 0.6, (bets, o) => (bets as bigint[])[o as number]!, true);
  const streaking = { beneficiaryStreak: 3, lastBeneficiaryUserId: "holes" };
  const d = run(e, bank(streaking), { rtpRecoveryMode: "target", maxBeneficiaryStreak: 3 });
  assert.equal(d.choiceId, "3", "nothing pays less than the holes, so the guard stands nothing in");
  assert.deepEqual(d.rtp!.beneficiaryExcluded, []);
  assert.ok(!d.alerts.includes("BENEFICIARY_STREAK"));
  // "holes" paid 6x on 14 of 15 rounds: far above a 90 % target + 5 %.
  const capped = run(e, bank({
    ...streaking,
    playerTotals: {
      holes: { stakedPaise: 3_000n, payoutPaise: 12_320n, rounds: 15 },
      cover: { stakedPaise: 12_000n, payoutPaise: 10_000n, rounds: 15 },
    },
  }), { rtpRecoveryMode: "target", maxBeneficiaryStreak: 3, playerCapEnabled: true, playerMinRounds: 10, playerBandBps: 500 });
  assert.ok(["0", "1", "2"].includes(capped.choiceId!), `the cap steers off the holes, got ${capped.choiceId}`);
});

/**
 * THE TWO-ACCOUNT FARM (found 2026-10-12, measured on an andar-bahar book).
 * Account A stakes ₹10 on one side and is let win it, account B ₹100 on the
 * other; once A has topped the winners `maxBeneficiaryStreak` rounds running,
 * B stakes ₹5,000 on the only result A does not top. With the guard free to
 * stand in a dearer result, B won 96 of 96 of those rounds — 187% RTP for the
 * pair. Now the forced round is not free and the pair settles near target.
 */
test("the beneficiary guard cannot be farmed by two accounts: the pair settles near target", () => {
  let S = 0n;
  let P = 0n;
  let last: string | null = null;
  let streak = 0;
  let bigBets = 0;
  let bigWins = 0;
  for (let r = 0; r < 300; r++) {
    const big = last === "A" && streak >= 2;
    const a = 1_000n;
    const b = big ? 500_000n : 10_000n;
    const e = computeExposure(
      ["andar", "bahar"].map((s) => ({ id: s, label: s, outcome: s })),
      [{ userId: "A", bets: "andar", stakePaise: a }, { userId: "B", bets: "bahar", stakePaise: b }],
      0.6,
      (bets, o) => (bets === o ? ((bets === "andar" ? a : b) * 195n) / 100n : 0n),
    );
    const d = decide(
      "rtp",
      e,
      { ...DEFAULT_PARAMS, rtpHoldBps: 1000, rtpRecoveryMode: "target", rtpMaxRepeat: 50, rtpTieBandPct: 0, rtpNoiseEnabled: false, maxBeneficiaryStreak: 2 },
      bank({ minBankFloorPaise: -1_000_000_000n, beneficiaryStreak: streak, lastBeneficiaryUserId: last, cumulativeStakedPaise: S, cumulativePayoutPaise: P }),
      new SeededRng(`farm-${r}`),
      `farm-${r}`,
    );
    const picked = e.outcomes[d.choiceIndex!]!;
    // noteRoundOutcome's RTP rule: every round the same account tops extends it.
    const top = picked.topWinnerUserId;
    streak = top && top === last ? streak + 1 : top ? 1 : 0;
    last = top ?? last;
    if (big) {
      bigBets++;
      if (picked.choiceId === "bahar") bigWins++;
    }
    S += e.totalStakedPaise;
    P += picked.payoutPaise;
  }
  const rtpBps = Number((P * 10_000n) / S);
  assert.ok(bigBets > 20, `the pair placed only ${bigBets} big bets`);
  assert.ok(bigWins < bigBets * 0.75, `the forced round still wins: ${bigWins} of ${bigBets}`);
  assert.ok(rtpBps <= 9500, `the pair still beats the target: ${rtpBps} bps`);
});

/**
 * A GIVEBACK TARGET (2026-09-20): a Target RTP above 100 % is a negative
 * hold, and the round aims above its own stake; the per-round ceiling bounds
 * how much of a large running gap one small round may carry.
 */
test("a target above 100% aims above the round's stake, and the per-round ceiling bounds the aim without changing what is legal", () => {
  // Every aim below sits exactly on a payout, so no draw is involved.
  const e = book(10000n, [0n, 10000n, 11000n, 11500n, 13000n]);
  const target = (over: Partial<EngineParams>, state = bank()) => run(e, state, { rtpRecoveryMode: "target", ...over });
  assert.equal(target({ rtpHoldBps: 0 }).choiceId, "1", "at 100 % the stake itself");
  const give = target({ rtpHoldBps: -1000 });
  assert.equal(give.choiceId, "2", "at 110 % the round aims at 11,000 on a 10,000 book");
  assert.equal(give.rtp!.wantedPayoutPaise, "11000");
  assert.equal(give.rtp!.roundCapBps, 0);
  assert.equal(give.rtp!.wantedCapped, false);
  // A large gap owed to players: the whole of it lands on this small round
  // and the aim becomes the biggest pocket on the table...
  const owed = bank({ cumulativeStakedPaise: 100_000n, cumulativePayoutPaise: 0n });
  const dumped = target({ rtpHoldBps: -1000 }, owed);
  assert.equal(dumped.choiceId, "4");
  assert.equal(dumped.rtp!.wantedPayoutPaise, "121000", "1.1 × 10,000 + the 110,000 gap");
  // ...unless the ceiling says a round may aim at most 5 % of its own stake
  // above its share: 11,000 + 500 = 11,500, which this board pays exactly.
  const capped = target({ rtpHoldBps: -1000, rtpRoundCapBps: 500 }, owed);
  assert.equal(capped.choiceId, "3");
  assert.equal(capped.rtp!.wantedPayoutPaise, "11500");
  assert.equal(capped.rtp!.roundCapBps, 500);
  assert.equal(capped.rtp!.wantedCapped, true);
  // The ceiling never lowers an aim under the round's share (the house owed
  // money by the gap), and every result stays legal — it caps the aim, not the pool.
  const ahead = bank({ cumulativeStakedPaise: 100_000n, cumulativePayoutPaise: 150_000n });
  const low = target({ rtpHoldBps: -1000, rtpRoundCapBps: 500 }, ahead);
  assert.equal(low.rtp!.wantedCapped, false);
  assert.equal(low.choiceId, "0", "owed nothing and then some: the aim is below the share and the cap leaves it");
  assert.equal(capped.rtp!.evaluated.length, 5, "the pool is the whole board");
});

/**
 * THE FIXED-LAYOUT WIN (2026-10-14, roulette-mini, one partner stream,
 * history `none`). One player staked ₹500 on each of two dozens every round:
 * 12 of 19 pockets pay 1.5× (₹1,500), the other 7 pay 0. The aim at 80 % was
 * ₹800, ₹1,500 was the nearer of the two, and "closest" paid it round after
 * round — 150 % over 400 rounds on a wheel that returns 94.7 % by itself.
 * Replayed here: the two payouts either side of the aim are drawn at the
 * odds that make the average payout the aim, so the layout returns 80 %.
 */
test("the draw: a fixed layout whose payouts straddle the aim returns the aim on average, and no round is predictable", () => {
  // The mini wheel, two dozens: pockets 1–12 pay 1500 on a 1000 stake, the rest 0.
  const twoDozens = book(1000n, Array.from({ length: 19 }, (_, i) => (i >= 1 && i <= 12 ? 1500n : 0n)));
  const none = (seed: string, over: Partial<EngineParams> = {}) =>
    run(twoDozens, bank(), { rtpHoldBps: 2000, rtpRecoveryMode: "target", rtpNoiseEnabled: false, rtpAggressivenessEnabled: false, ...over }, seed);
  // The control is arithmetic: |1500 − 800| < |800 − 0|, so "closest" is
  // the 1500 every round — the 150 % the operator saw.
  assert.ok(1500n - 800n < 800n - 0n);
  let wins = 0;
  let paid = 0n;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const d = none(`dozens-${i}`);
    const pay = BigInt(d.rtp!.selectedPayoutPaise);
    assert.ok(pay === 0n || pay === 1500n);
    assert.equal(d.rtp!.wantedPayoutPaise, "800");
    assert.equal(d.rtp!.bracketLowPaise, "0");
    assert.equal(d.rtp!.bracketHighPaise, "1500");
    assert.equal(d.rtp!.highChanceBps, 5333, "800 / 1500 of the time the high side");
    assert.equal(d.rtp!.drawnPayoutPaise, pay.toString());
    assert.match(d.reason, /drew between the two payouts either side/u);
    if (pay > 0n) wins++;
    paid += pay;
  }
  const rtpBps = Number((paid * 10_000n) / (1000n * BigInt(N)));
  assert.ok(Math.abs(wins / N - 0.5333) < 0.03, `the 1500 landed ${wins} of ${N}; expected 53%`);
  assert.ok(Math.abs(rtpBps - 8000) <= 250, `the layout returned ${rtpBps} bps against an 80% target`);
  // A board all on one side of the aim cannot reach it: the closest lands,
  // and the record says there was nothing to draw between.
  const allBelow = run(book(1000n, [0n, 300n, 500n]), bank(), { rtpRecoveryMode: "target", rtpNoiseEnabled: false });
  assert.equal(allBelow.choiceId, "2");
  assert.equal(allBelow.rtp!.bracketLowPaise, "500");
  assert.equal(allBelow.rtp!.bracketHighPaise, null);
  assert.equal(allBelow.rtp!.highChanceBps, 0);
  assert.match(allBelow.reason, /nothing on the board sits on the other side/u);
  const allAbove = run(book(1000n, [1200n, 1500n, 3000n]), bank(), { rtpRecoveryMode: "target", rtpNoiseEnabled: false });
  assert.equal(allAbove.choiceId, "0");
  assert.equal(allAbove.rtp!.bracketLowPaise, null);
  assert.equal(allAbove.rtp!.bracketHighPaise, "1200");
  assert.equal(allAbove.rtp!.highChanceBps, 10000);
  // With a history the miss carries: the same layout over 600 rounds lands
  // on 80 % tighter still, and both results keep landing.
  let S = 0n;
  let P = 0n;
  const landed = new Set<string>();
  for (let r = 0; r < 600; r++) {
    const d = run(twoDozens, bank({ cumulativeStakedPaise: S, cumulativePayoutPaise: P }), { rtpHoldBps: 2000, rtpRecoveryMode: "target", rtpNoiseEnabled: false, rtpAggressivenessEnabled: false }, `carried-${r}`);
    const pay = BigInt(d.rtp!.selectedPayoutPaise);
    landed.add(pay.toString());
    S += 1000n;
    P += pay;
  }
  assert.deepEqual([...landed].sort(), ["0", "1500"]);
  assert.ok(Math.abs(Number((P * 10_000n) / S) - 8000) <= 100, `with history: ${(P * 10_000n) / S} bps`);
});
