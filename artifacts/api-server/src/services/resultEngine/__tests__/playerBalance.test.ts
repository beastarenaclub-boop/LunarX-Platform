/**
 * The player balance (`playerStage`, 2026-09-20), DB-free.
 *
 *   P1  both switches off, nobody weighed, or one result: the pool is
 *       untouched and no record; a lone player IS weighed
 *   P2  cap, lift and both: on random books the kept set is exactly the
 *       oracle's — every result keeping every weighed player inside the
 *       band, else the closest in paise with the band as slack — and the
 *       pick, in RTP and in collect, is always one of them
 *   P3  direction: over 2,000 rounds a player who starts at 200 % is pulled
 *       DOWN by the cap and one who starts at 30 % is pushed UP by the lift,
 *       each further than the unbalanced control moves them
 *   P4  the floor outranks the stage; collect / distribute / auto attach the
 *       record and still name a real candidate index
 *
 * The same ten-pocket synthetic game as partyBalance: a slip is one pocket
 * at 10x; the engine never sees the game.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeExposure, type Exposure, type ExposureSlip } from "../exposure";
import { decide, playerStage, type BankState, type PlayerTotals } from "../selectors";
import { DEFAULT_PARAMS, type EngineParams } from "../params";
import { SeededRng } from "../rng";

const POCKETS = 10;
type Bet = { pocket: number; stake: bigint };
const payoutFor = (bets: unknown, outcome: unknown) => {
  const b = bets as Bet;
  return b.pocket === outcome ? b.stake * 10n : 0n;
};
const candidates = Array.from({ length: POCKETS }, (_, i) => ({ id: String(i), label: String(i), outcome: i }));

function prng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x1_0000_0000; };
}
function book(rnd: () => number, users: string[]): ExposureSlip[] {
  const slips: ExposureSlip[] = [];
  const n = 1 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const stake = BigInt(100 * (1 + Math.floor(rnd() * 50)));
    slips.push({ userId: users[Math.floor(rnd() * users.length)]!, bets: { pocket: Math.floor(rnd() * POCKETS), stake }, stakePaise: stake });
  }
  return slips;
}
const exposureOf = (slips: ExposureSlip[]) => computeExposure(candidates, slips, 0.6, payoutFor, true);
function bank(over: Partial<BankState> = {}): BankState {
  return {
    bankPaise: 100_000_000n, minBankFloorPaise: 0n, zeroBetStreak: 0, beneficiaryStreak: 0, lastBeneficiaryUserId: null,
    recentChoiceIds: [], windowStakedPaise: 0n, windowHouseNetPaise: 0n, cumulativeStakedPaise: 0n, cumulativePayoutPaise: 0n, ...over,
  };
}
const params = (over: Partial<EngineParams> = {}): EngineParams => ({
  ...DEFAULT_PARAMS, playerCapEnabled: true, playerLiftEnabled: true, playerMinRounds: 1, rtpMaxRepeat: 50, rtpTieBandPct: 0, noiseRate: 0.02, ...over,
});

/** The rule restated by brute force. */
function oracle(e: Exposure, totals: PlayerTotals, p: EngineParams) {
  const minRounds = p.playerMinRounds;
  const ids = [...e.playerStakes!.keys()].filter((id) => (totals[id]?.rounds ?? 0) >= minRounds && (!p.playerLiftEnabled || e.playerStakes!.get(id)! <= totals[id]!.stakedPaise));
  if (ids.length === 0 || (!p.playerCapEnabled && !p.playerLiftEnabled)) return null;
  const target = BigInt(10_000 - p.rtpHoldBps);
  const band = BigInt(p.playerBandBps);
  const upper = target + band;
  const lower = target > band ? target - band : 0n;
  const score = e.outcomes.map((o) => {
    let dev = 0n, short = 0n;
    for (const id of ids) {
      const t = totals[id]!;
      const S = t.stakedPaise + e.playerStakes!.get(id)!;
      const P = t.payoutPaise + (o.players!.get(id) ?? 0n);
      const rtp = (P * 10_000n) / S;
      let d = 0n, s = 0n;
      if (p.playerCapEnabled && rtp > upper) { d = rtp - upper; s = (P * 10_000n - upper * S) / 10_000n; }
      else if (p.playerLiftEnabled && rtp < lower) {
        const earned = lower * t.stakedPaise / 10_000n - t.payoutPaise;
        if (earned > 0n) { d = lower - rtp; const gap = (lower*S-P*10_000n)/10_000n; s = gap < earned ? gap : earned; }
      }
      if (d > dev) dev = d;
      if (s > short) short = s;
    }
    return { id: o.choiceId, dev, short };
  });
  const ok = score.filter((s) => s.dev === 0n);
  if (ok.length) return { ids: new Set(ok.map((s) => s.id)), satisfied: true };
  const min = score.reduce((m, s) => (s.short < m ? s.short : m), score[0]!.short);
  const slack = (band * e.totalStakedPaise) / 10_000n;
  return { ids: new Set(score.filter((s) => s.short <= min + slack).map((s) => s.id)), satisfied: false };
}
const history = (stakedPaise: bigint, rtpPct: number, rounds = 10) => ({ stakedPaise, payoutPaise: (stakedPaise * BigInt(rtpPct)) / 100n, rounds });

test("P1 both off, nobody weighed, or one result: untouched, no record; a lone player is weighed", () => {
  const rnd = prng(1);
  const e = exposureOf(book(rnd, ["a", "b"]));
  const off = playerStage(e.outcomes, e, params({ playerCapEnabled: false, playerLiftEnabled: false }), bank({ playerTotals: { a: history(1_000_000n, 200), b: history(1_000_000n, 200) } }), []);
  assert.equal(off.record, null);
  assert.equal(off.pool, e.outcomes);
  const green = playerStage(e.outcomes, e, params(), bank({ playerTotals: {} }), []);
  assert.equal(green.record, null, "no history at all: nobody is weighed");
  const young = playerStage(e.outcomes, e, params({ playerMinRounds: 10 }), bank({ playerTotals: { a: history(1_000_000n, 200, 9), b: history(1_000_000n, 200, 9) } }), []);
  assert.equal(young.record, null, "under the history threshold: nobody is weighed");
  const lone = playerStage([e.outcomes[3]!], e, params(), bank({ playerTotals: { a: history(1_000_000n, 200) } }), []);
  assert.equal(lone.record, null, "a pool of one is never overridden");
  // One account alone on the table, far over the cap: the result paying it is set aside.
  const solo = exposureOf([{ userId: "a", bets: { pocket: 4, stake: 1_000n }, stakePaise: 1_000n }]);
  const alerts: string[] = [];
  const capped = playerStage(solo.outcomes, solo, params({ playerLiftEnabled: false, playerBandBps: 1000 }), bank({ playerTotals: { a: history(1_000_000n, 200) } }), alerts as never);
  assert.ok(capped.record, "a lone player IS weighed: a cap on one account is the case");
  assert.ok(!capped.pool.some((p) => p.choiceId === "4"), "the result paying the capped player is set aside");
  assert.equal(capped.pool.length, POCKETS - 1);
  assert.ok(alerts.includes("PLAYER_BALANCED"));
  assert.ok(alerts.includes("PLAYER_BAND_UNREACHABLE"), "losing this round does not bring 200 % back inside 100 %, so nothing satisfies");
  assert.equal(capped.record!.players[0]!.weighed, true);
});

test("P2 cap, lift and both keep exactly the oracle's set on random books, and RTP and collect pick from it", () => {
  const rnd = prng(0x92);
  let narrowed = 0, fallbacks = 0;
  for (let i = 0; i < 2000; i++) {
    const e = exposureOf(book(rnd, ["a", "b", "c", "d"]));
    const totals: PlayerTotals = {};
    for (const id of e.playerStakes!.keys()) {
      if (rnd() < 0.15) continue; // some players have no history at all
      totals[id] = history(BigInt(Math.floor(rnd() * 3_000_000)) + 1n, 40 + Math.floor(rnd() * 120), 1 + Math.floor(rnd() * 20));
    }
    const p = params({
      playerCapEnabled: i % 3 !== 1, playerLiftEnabled: i % 3 !== 0,
      playerBandBps: [50, 500, 2000][i % 3]!, playerMinRounds: [1, 5, 10][i % 3]!, rtpHoldBps: [500, 1000, 2000][(i >> 2) % 3]!,
    });
    const alerts: string[] = [];
    const st = playerStage(e.outcomes, e, p, bank({ playerTotals: totals }), alerts as never);
    const o = oracle(e, totals, p);
    if (o === null) { assert.equal(st.record, null, `case ${i}: nobody weighed, so no record`); continue; }
    assert.deepEqual(new Set(st.pool.map((x) => x.choiceId)), o.ids, `case ${i}: kept set differs from the oracle`);
    assert.equal(st.record!.satisfied, o.satisfied, `case ${i}: satisfied flag`);
    assert.equal(alerts.includes("PLAYER_BALANCED"), st.pool.length < e.outcomes.length, `case ${i}: the alert says whether the pool narrowed`);
    if (st.pool.length < e.outcomes.length) narrowed++;
    if (!o.satisfied) fallbacks++;
    for (const mode of ["rtp", "collect"] as const) {
      const d = decide(mode, e, p, bank({ playerTotals: totals, cumulativeStakedPaise: 1_000_000n, cumulativePayoutPaise: 900_000n }), new SeededRng(`p2-${i}`), `p2-${i}`);
      if (d.choiceIndex !== null) assert.ok(o.ids.has(e.outcomes[d.choiceIndex]!.choiceId), `case ${i}: ${mode} picked outside the balanced pool`);
      if (d.choiceIndex !== null && !d.noise) assert.ok(d.players, `case ${i}: ${mode} carries the record`);
    }
  }
  assert.ok(narrowed > 300 && fallbacks > 30, `the cases must exercise both branches (narrowed ${narrowed}, fallbacks ${fallbacks})`);
});

/**
 * Two players, each one straight per round at a random stake. "hi" starts the
 * day at 200 % and "lo" at 30 %; RTP mode at 90 % over cumulative history.
 * With the balance on, hi is pulled down and lo pushed up, each further than
 * the plain ranking moves them.
 */
test("P3 the cap pulls a runaway player down and the lift pushes a lagging one up, beyond the control", () => {
  const run = (on: boolean, seed: number) => {
    const rnd = prng(seed);
    const totals: PlayerTotals = { hi: history(2_000_000n, 200, 50), lo: history(2_000_000n, 30, 50) };
    let S = 4_000_000n;
    let P = totals.hi!.payoutPaise + totals.lo!.payoutPaise;
    const p = params({ playerCapEnabled: on, playerLiftEnabled: on, playerBandBps: 500, rtpHoldBps: 1000 });
    for (let i = 0; i < 2000; i++) {
      const slips: ExposureSlip[] = ["hi", "lo"].map((u) => {
        const stake = BigInt(100 * (1 + Math.floor(rnd() * 20)));
        return { userId: u, bets: { pocket: Math.floor(rnd() * POCKETS), stake }, stakePaise: stake };
      });
      const e = exposureOf(slips);
      const d = decide("rtp", e, p, bank({ playerTotals: totals, cumulativeStakedPaise: S, cumulativePayoutPaise: P }), new SeededRng(`p3-${seed}-${i}`), `p3-${i}`);
      const landed = d.choiceIndex === null ? e.outcomes[Math.floor(rnd() * POCKETS)]! : e.outcomes[d.choiceIndex]!;
      for (const u of ["hi", "lo"]) {
        const t = totals[u]!;
        t.stakedPaise += e.playerStakes!.get(u)!;
        t.payoutPaise += landed.players?.get(u) ?? 0n;
        t.rounds += 1;
      }
      S += e.totalStakedPaise;
      P += landed.payoutPaise;
    }
    const rtp = (u: string) => Number((totals[u]!.payoutPaise * 10_000n) / totals[u]!.stakedPaise) / 100;
    return { hi: rtp("hi"), lo: rtp("lo") };
  };
  const balanced = run(true, 7);
  const control = run(false, 7);
  assert.ok(balanced.hi < control.hi - 5, `the cap must pull hi down further than the control (balanced ${balanced.hi}%, control ${control.hi}%)`);
  assert.ok(balanced.lo > control.lo + 5, `the lift must push lo up further than the control (balanced ${balanced.lo}%, control ${control.lo}%)`);
  assert.ok(balanced.hi > balanced.lo, "the balance narrows the gap; it does not invert it");
});

test("P4 the floor outranks the stage, and collect / distribute / auto attach the record and name a real candidate", () => {
  const e = exposureOf([
    { userId: "a", bets: { pocket: 1, stake: 5_000n }, stakePaise: 5_000n },
    { userId: "b", bets: { pocket: 2, stake: 100n }, stakePaise: 100n },
  ]);
  const totals: PlayerTotals = { a: history(1_000_000n, 30), b: history(1_000_000n, 200) };
  // The lift wants pocket 1 (it pays the lagging a); with bank 0 and floor 0
  // it is the one result the floor forbids, so the floor's pool never sees it.
  const floored = decide("collect", e, params({ playerCapEnabled: false }), bank({ bankPaise: 0n, playerTotals: totals }), new SeededRng("p4"), "p4");
  assert.notEqual(floored.choiceId, "1", "the floor outranks the lift");
  for (const mode of ["collect", "distribute", "auto"] as const) {
    const d = decide(mode, e, params(), bank({ bankPaise: 100_000_000n, playerTotals: totals, windowStakedPaise: 1_000_000n, windowHouseNetPaise: 100_000n }), new SeededRng(`p4-${mode}`), "p4");
    if (d.noise) continue;
    assert.ok(d.players, `${mode} carries the record`);
    assert.equal(d.players!.narrowedFrom, POCKETS);
    if (d.choiceIndex !== null) assert.equal(e.outcomes[d.choiceIndex]!.choiceId, d.choiceId, `${mode} names the candidate it picked`);
  }
});
