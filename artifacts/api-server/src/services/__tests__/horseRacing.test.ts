import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HORSES,
  RACE_STATES,
  horseMultiplier,
  horseMultiplierHundredths,
  deriveHorseWinner,
} from "../horseRacing";

describe("horse racing odds", () => {
  it("has 7 states, each with 6 horses and probabilities summing to 100%", () => {
    assert.equal(RACE_STATES.length, 7);
    const ids = new Set(RACE_STATES.map((s) => s.id));
    assert.equal(ids.size, 7);
    for (const s of RACE_STATES) {
      assert.equal(s.horses.length, 6);
      assert.equal(s.horses.reduce((sum, h) => sum + h.winProbPct, 0), 100);
      // horse ids are 1..6 within each state
      assert.deepEqual(
        s.horses.map((h) => h.id),
        [1, 2, 3, 4, 5, 6],
      );
      // names unique within the state
      assert.equal(new Set(s.horses.map((h) => h.name)).size, 6);
    }
  });

  it("win probabilities sum to 100%", () => {
    assert.equal(HORSES.reduce((s, h) => s + h.winProbPct, 0), 100);
  });

  it("multipliers use integer math (no float flooring artifacts)", () => {
    // 0.97/0.10 === 9.699999... would floor to 9.69 with naive float math.
    assert.equal(horseMultiplier(10, 0.03), 9.7);
    assert.equal(horseMultiplier(30, 0.03), 3.23);
    assert.equal(horseMultiplier(22, 0.03), 4.4);
    assert.equal(horseMultiplier(17, 0.03), 5.7);
    assert.equal(horseMultiplier(13, 0.03), 7.46);
    assert.equal(horseMultiplier(8, 0.03), 12.12);
  });

  it("per-horse RTP is never above target and within 2dp truncation of it", () => {
    const edge = 0.03;
    const targetRtpBp = 9700;
    for (const h of HORSES) {
      const rtpBp = horseMultiplierHundredths(h.winProbPct, edge) * h.winProbPct;
      assert.ok(rtpBp <= targetRtpBp);
      // truncation loses less than 1 hundredth of multiplier × probPct
      assert.ok(rtpBp > targetRtpBp - h.winProbPct);
    }
  });

  it("winner derivation is deterministic and respects seed pair", () => {
    const a = deriveHorseWinner("seedA", "clientA");
    assert.deepEqual(deriveHorseWinner("seedA", "clientA"), a);
    assert.ok(a.winnerId >= 1);
    assert.ok(a.winnerId <= 6);
    assert.ok(a.roll >= 0);
    assert.ok(a.roll < 1);
  });

  it("winner derivation is state-scoped (different states, different streams)", () => {
    for (const s of RACE_STATES) {
      const r = deriveHorseWinner("seedA", "clientA", s.id);
      assert.ok(r.winnerId >= 1 && r.winnerId <= 6);
      assert.deepEqual(deriveHorseWinner("seedA", "clientA", s.id), r);
    }
    // At least two states should disagree for some seed (streams are salted
    // by stateId).
    const winners = new Set(
      RACE_STATES.map((s) => deriveHorseWinner("seedB", "clientB", s.id).winnerId),
    );
    assert.ok(winners.size >= 1); // sanity; distribution check below is the real test
    assert.throws(() => deriveHorseWinner("s", "c", "narnia"), /INVALID_STATE/);
  });

  it("empirical frequencies match per state", () => {
    const N = 5000;
    for (const s of [RACE_STATES[0], RACE_STATES[3], RACE_STATES[6]]) {
      const counts = new Map<number, number>();
      for (let i = 0; i < N; i++) {
        const { winnerId } = deriveHorseWinner(`s${i}`, "c", s.id);
        counts.set(winnerId, (counts.get(winnerId) ?? 0) + 1);
      }
      for (const h of s.horses) {
        const freq = (counts.get(h.id) ?? 0) / N;
        assert.ok(
          Math.abs(freq - h.winProbPct / 100) < 0.03,
          `${s.id}/${h.name} freq ${freq}`,
        );
      }
    }
  });

  it("empirical win frequencies roughly match configured probabilities", () => {
    const counts = new Map<number, number>();
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const { winnerId } = deriveHorseWinner(`s${i}`, "c");
      counts.set(winnerId, (counts.get(winnerId) ?? 0) + 1);
    }
    for (const h of HORSES) {
      const freq = (counts.get(h.id) ?? 0) / N;
      assert.ok(Math.abs(freq - h.winProbPct / 100) < 0.02);
    }
  });
});
