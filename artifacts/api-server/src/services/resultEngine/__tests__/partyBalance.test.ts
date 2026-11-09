/**
 * The sharing-partner balance (`partyStage`, 2026-09-18), DB-free.
 *
 *   B1  off, one party, or one result: the pool is untouched and no record
 *   B2  rtpBand: on random books the kept set is exactly the oracle's —
 *       every result keeping every party within the band, else the closest
 *       with the band as slack — and the pick is always one of them
 *   B3  noLoser: the same, for "no party pays more than it took"
 *   B4  convergence: two parties starting 20 points apart end inside the
 *       band of one another and of the target after 2,000 balanced rounds,
 *       while the unbalanced control does not close the gap
 *   B5  the floor outranks the stage, and collect / distribute / auto attach
 *       the record and still name a real candidate index
 *
 * A ten-pocket synthetic game: a slip is one pocket at 10× so the parties'
 * exposures are easy to reason about; the engine never sees the game.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeExposure, type Exposure, type ExposureSlip } from "../exposure";
import { decide, partyStage, type BankState, type PartyTotals } from "../selectors";
import { DEFAULT_PARAMS, type EngineParams } from "../params";
import { SeededRng } from "../rng";

const POCKETS = 10;
type Bet = { pocket: number; stake: bigint };
const payoutFor = (bets: unknown, outcome: unknown) => {
  const b = bets as Bet;
  return b.pocket === outcome ? b.stake * 10n : 0n;
};
const candidatesFor = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i), label: String(i), outcome: i }));
const candidates = candidatesFor(POCKETS);

function prng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x1_0000_0000; };
}
function book(rnd: () => number, parties: string[], pockets = POCKETS): ExposureSlip[] {
  const slips: ExposureSlip[] = [];
  const n = 1 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const stake = BigInt(100 * (1 + Math.floor(rnd() * 50)));
    slips.push({ userId: `u${i}`, partyId: parties[Math.floor(rnd() * parties.length)]!, bets: { pocket: Math.floor(rnd() * pockets), stake }, stakePaise: stake });
  }
  return slips;
}
/** A book with every named party on it, so the stage has something to weigh. */
function bookWithAll(rnd: () => number, parties: string[], pockets = POCKETS): ExposureSlip[] {
  for (;;) {
    const b = book(rnd, parties, pockets);
    if (new Set(b.map((s) => s.partyId)).size === parties.length) return b;
  }
}
const exposureOf = (slips: ExposureSlip[], pockets = POCKETS) => computeExposure(candidatesFor(pockets), slips, 0.6, payoutFor, true);
function bank(over: Partial<BankState> = {}): BankState {
  return {
    bankPaise: 100_000_000n, minBankFloorPaise: 0n, zeroBetStreak: 0, beneficiaryStreak: 0, lastBeneficiaryUserId: null,
    recentChoiceIds: [], windowStakedPaise: 0n, windowHouseNetPaise: 0n, cumulativeStakedPaise: 0n, cumulativePayoutPaise: 0n, ...over,
  };
}
const params = (over: Partial<EngineParams> = {}): EngineParams => ({
  ...DEFAULT_PARAMS, partyBalanceEnabled: true, rtpMaxRepeat: 50, rtpTieBandPct: 0, noiseRate: 0.02, ...over,
});
const abs = (v: bigint) => (v < 0n ? -v : v);

/** The rule restated by brute force. */
function oracle(e: Exposure, totals: PartyTotals, p: EngineParams, targetBps: bigint) {
  const ids = [...e.partyStakes!.keys()];
  const band = BigInt(p.partyBandBps);
  const score = e.outcomes.map((o) => {
    let dev: bigint | null = null;
    let short: bigint | null = null;
    let loss = -(1n << 62n);
    for (const id of ids) {
      const part = o.parties!.get(id)!;
      const t = totals[id] ?? { stakedPaise: 0n, payoutPaise: 0n };
      const S = t.stakedPaise + part.stakePaise;
      const P = t.payoutPaise + part.payoutPaise;
      if (S > 0n) {
        const d = abs((P * 10_000n) / S - targetBps); if (dev === null || d > dev) dev = d;
        const sh = abs(P * 10_000n - targetBps * S) / 10_000n; if (short === null || sh > short) short = sh;
      }
      const l = part.payoutPaise - part.stakePaise;
      if (l > loss) loss = l;
    }
    return { id: o.choiceId, dev: dev!, short: short!, loss };
  });
  if (p.partyBalanceMode === "noLoser") {
    const ok = score.filter((s) => s.loss <= 0n);
    if (ok.length) return { ids: new Set(ok.map((s) => s.id)), satisfied: true };
    const min = score.reduce((m, s) => (s.loss < m ? s.loss : m), score[0]!.loss);
    const slack = (band * e.totalStakedPaise) / 10_000n;
    return { ids: new Set(score.filter((s) => s.loss <= min + slack).map((s) => s.id)), satisfied: false };
  }
  const ok = score.filter((s) => s.dev <= band);
  if (ok.length) return { ids: new Set(ok.map((s) => s.id)), satisfied: true };
  const min = score.reduce((m, s) => (s.short < m ? s.short : m), score[0]!.short);
  const slack = (band * e.totalStakedPaise) / 10_000n;
  return { ids: new Set(score.filter((s) => s.short <= min + slack).map((s) => s.id)), satisfied: false };
}

test("B1 off, one party, or one result: untouched, no record", () => {
  const rnd = prng(1);
  const two = exposureOf(book(rnd, ["A", "B"]));
  const off = partyStage(two.outcomes, two, params({ partyBalanceEnabled: false }), bank(), []);
  assert.equal(off.record, null);
  assert.equal(off.pool, two.outcomes);
  const one = exposureOf(book(rnd, ["A"]));
  const single = partyStage(one.outcomes, one, params(), bank(), []);
  assert.equal(single.record, null, "one party: nothing to balance");
  const lone = partyStage([two.outcomes[3]!], two, params(), bank(), []);
  assert.equal(lone.record, null, "a pool of one is never overridden");
  assert.equal(lone.pool.length, 1);
});

test("B2 rtpBand keeps exactly the oracle's set on random books, and the pick is in it", () => {
  const rnd = prng(0xB2);
  let narrowed = 0, fallbacks = 0;
  for (let i = 0; i < 1500; i++) {
    const e = exposureOf(book(rnd, ["A", "B", i % 3 === 0 ? "C" : "B"]));
    if ((e.partyStakes?.size ?? 0) < 2) continue;
    const totals: PartyTotals = {};
    for (const id of e.partyStakes!.keys()) {
      const S = BigInt(Math.floor(rnd() * 3_000_000));
      totals[id] = { stakedPaise: S, payoutPaise: (S * BigInt(60 + Math.floor(rnd() * 60))) / 100n };
    }
    const p = params({ partyBandBps: [50, 300, 1000][i % 3]!, partyTargetRtpBps: 9000, partyBalanceMode: "rtpBand" });
    const alerts: string[] = [];
    const st = partyStage(e.outcomes, e, p, bank({ partyTotals: totals, partyTargetBps: 9000 }), alerts as never);
    const o = oracle(e, totals, p, 9000n);
    assert.deepEqual(new Set(st.pool.map((x) => x.choiceId)), o.ids, `case ${i}: kept set differs from the oracle`);
    assert.equal(st.record!.satisfied, o.satisfied, `case ${i}: satisfied flag`);
    if (st.pool.length < e.outcomes.length) narrowed++;
    if (!o.satisfied) fallbacks++;
    // …and every mode picks from it.
    const d = decide("rtp", e, p, bank({ partyTotals: totals, partyTargetBps: 9000, cumulativeStakedPaise: 1_000_000n, cumulativePayoutPaise: 900_000n }), new SeededRng(`b2-${i}`), `b2-${i}`);
    if (d.choiceIndex !== null) assert.ok(o.ids.has(e.outcomes[d.choiceIndex]!.choiceId), `case ${i}: RTP picked outside the balanced pool`);
  }
  assert.ok(narrowed > 100 && fallbacks > 10, `the cases must exercise both branches (narrowed ${narrowed}, fallbacks ${fallbacks})`);
});

test("B3 noLoser keeps exactly the oracle's set on random books", () => {
  const rnd = prng(0xB3);
  let satisfied = 0, fallbacks = 0;
  for (let i = 0; i < 1500; i++) {
    const e = exposureOf(book(rnd, ["A", "B"], 3), 3);
    if ((e.partyStakes?.size ?? 0) < 2) continue;
    const p = params({ partyBalanceMode: "noLoser", partyBandBps: [0, 300, 2000][i % 3]! });
    const st = partyStage(e.outcomes, e, p, bank(), []);
    const o = oracle(e, {}, p, 9000n);
    assert.deepEqual(new Set(st.pool.map((x) => x.choiceId)), o.ids, `case ${i}`);
    if (o.satisfied) satisfied++; else fallbacks++;
  }
  assert.ok(satisfied > 100 && fallbacks > 10, `both branches (satisfied ${satisfied}, fallbacks ${fallbacks})`);
});

test("B4 two parties 20 points apart converge inside the band; the unbalanced control does not", () => {
  const simulate = (balanced: boolean) => {
    const rnd = prng(0xB4);
    const totals: PartyTotals = { A: { stakedPaise: 5_000_000n, payoutPaise: 3_500_000n }, B: { stakedPaise: 5_000_000n, payoutPaise: 5_500_000n } };
    let pool = { S: 10_000_000n, P: 9_000_000n };
    for (let r = 0; r < 2000; r++) {
      const e = exposureOf(book(rnd, ["A", "B"]));
      const p = params({ partyBalanceEnabled: balanced, partyBalanceMode: "rtpBand", partyBandBps: 150, partyTargetRtpBps: 9000, rtpHoldBps: 1000, rtpNoiseEnabled: false });
      const b = bank({ partyTotals: totals, partyTargetBps: 9000, cumulativeStakedPaise: pool.S, cumulativePayoutPaise: pool.P });
      const d = decide("rtp", e, p, b, new SeededRng(`b4-${balanced}-${r}`), `b4-${r}`);
      const picked = d.choiceIndex === null ? e.outcomes[Math.floor(rnd() * POCKETS)]! : e.outcomes[d.choiceIndex]!;
      for (const [id, part] of picked.parties!) {
        const t = totals[id] ?? (totals[id] = { stakedPaise: 0n, payoutPaise: 0n });
        t.stakedPaise += part.stakePaise;
        t.payoutPaise += part.payoutPaise;
      }
      pool = { S: pool.S + e.totalStakedPaise, P: pool.P + picked.payoutPaise };
    }
    const rtp = (id: string) => Number((totals[id]!.payoutPaise * 10_000n) / totals[id]!.stakedPaise) / 100;
    return { A: rtp("A"), B: rtp("B") };
  };
  const on = simulate(true);
  const off = simulate(false);
  assert.ok(Math.abs(on.A - 90) <= 1.5 && Math.abs(on.B - 90) <= 1.5, `balanced: both inside the 1.5-point band of the 90% target (${on.A}, ${on.B})`);
  assert.ok(Math.abs(on.A - on.B) <= 3, `balanced: parties ${on.A}% vs ${on.B}% must end within twice the band of each other`);
  assert.ok(Math.abs(off.A - off.B) > Math.abs(on.A - on.B), `control: unbalanced gap ${Math.abs(off.A - off.B)} must exceed balanced ${Math.abs(on.A - on.B)}`);
});

test("B5 the floor outranks the stage; collect / distribute / auto carry the record and a real index", () => {
  const rnd = prng(0xB5);
  const e = exposureOf(bookWithAll(rnd, ["A", "B"]));
  // A floor so high only the single best result is legal: the stage steps aside.
  const best = e.outcomes.reduce((a, b) => (b.houseNetPaise > a.houseNetPaise ? b : a));
  const tight = bank({ bankPaise: 0n, minBankFloorPaise: best.houseNetPaise, partyTotals: {}, partyTargetBps: 9000 });
  // Several "nobody pays" pockets tie for the best house net, so the floor
  // may leave more than one: the stage then runs on exactly that set and
  // never on anything the floor removed.
  const legal = e.outcomes.filter((o) => o.houseNetPaise >= best.houseNetPaise);
  const dTight = decide("collect", e, params({ partyBalanceMode: "noLoser", partyBandBps: 0 }), tight, new SeededRng("b5"), "b5");
  if (legal.length === 1) {
    assert.equal(dTight.party, undefined, "a pool the floor cut to one is not re-cut");
    assert.equal(dTight.choiceIndex, best.index);
  } else {
    assert.equal(dTight.party?.narrowedFrom, legal.length, "the stage sees only what the floor allowed");
  }
  assert.ok(dTight.choiceIndex === null || legal.some((o) => o.index === dTight.choiceIndex), "the pick is floor-legal");
  for (const mode of ["collect", "distribute", "auto"] as const) {
    const p = params({ partyBalanceMode: "noLoser", partyBandBps: 0, targetBankPaise: 1n, noiseRate: 0.02 });
    const b = bank({ partyTotals: {}, partyTargetBps: 9000, bankPaise: 100_000_000n });
    for (let i = 0; i < 20; i++) {
      const d = decide(mode, e, p, b, new SeededRng(`b5-${mode}-${i}`), `b5-${mode}-${i}`);
      if (d.choiceIndex === null) continue;
      assert.ok(d.party, `${mode}: the record must be attached`);
      const kept = new Set(oracle(e, {}, p, 9000n).ids);
      assert.ok(kept.has(e.outcomes[d.choiceIndex]!.choiceId), `${mode}: picked outside the balanced pool`);
      assert.equal(e.outcomes[d.choiceIndex]!.index, d.choiceIndex, "index names the original candidate");
    }
  }
});
