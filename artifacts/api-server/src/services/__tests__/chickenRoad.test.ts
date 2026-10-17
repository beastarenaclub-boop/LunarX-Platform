import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { CHICKEN_DIFFICULTIES, CHICKEN_MODES, CHICKEN_RTP, CHICKEN_CLASSIC_RTP, CHICKEN_VERSION, chickenReturn, chickenSurvival, chickenPayout } from "@workspace/api-zod/chicken-road-game";
import { chickenSeedHash, chickenStepSafe } from "../chickenRoadMath";

test("classic version 1 retains 98% RTP at every stopping point", () => {
  for (const mode of CHICKEN_DIFFICULTIES) {
    let survival = 1, previous = 100;
    for (let step = 1; step <= CHICKEN_MODES[mode].returns.length; step++) {
      const value = chickenReturn(mode, step), chance = chickenSurvival(mode, step, 1);
      assert(value > previous && value <= 100000);
      assert(chance > 0 && chance < 1);
      survival *= chance;
      assert(Math.abs(survival * value / 100 - CHICKEN_CLASSIC_RTP) < 1e-12, `${mode} lane ${step}`);
      previous = value;
    }
  }
});
test("fixed integer returns include stake and round down fractional paise", () => {
  assert.equal(chickenPayout(101n, "easy", 1), 102n);
  assert.equal(chickenPayout(10000n, "easy", 1), 10100n);
  assert.equal(chickenPayout(100000000000000n, "hard", 20), 100000000000000000n);
  assert.throws(() => chickenReturn("easy", 25), /INVALID_STEP/);
  assert.throws(() => chickenReturn("easy", 1.5), /INVALID_STEP/);
  assert.throws(() => chickenSurvival("easy", 0), /INVALID_STEP/);
});
test("published HMAC replay matches all steps and SHA-256 commitment", () => {
  assert.equal(chickenSeedHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  for (const mode of CHICKEN_DIFFICULTIES) for (let step = 1; step <= CHICKEN_MODES[mode].returns.length; step++) {
    const hash = createHmac("sha256", "server-seed").update(`chicken-road:v1:client-seed:${mode}:${step}`).digest("hex");
    assert.equal(chickenStepSafe("server-seed", "client-seed", mode, step, 1), parseInt(hash.slice(0, 13), 16) / 2 ** 52 < chickenSurvival(mode, step, 1));
  }
});
test("deterministic samples have the expected first-step win frequency", () => {
  for (const mode of CHICKEN_DIFFICULTIES) {
    let wins = 0;
    for (let i = 0; i < 20000; i++) if (chickenStepSafe(`sample-${i}`, "fixed-client", mode, 1, 1)) wins++;
    assert(Math.abs(wins / 20000 - chickenSurvival(mode, 1, 1)) < .015);
  }
});

test("version 2 guarantees every lane in every mode without claiming a fixed RTP", () => {
  assert.equal(CHICKEN_VERSION, 3);
  assert.equal(CHICKEN_RTP, .85);
  for (const mode of CHICKEN_DIFFICULTIES) {
    for (let step = 1; step <= CHICKEN_MODES[mode].returns.length; step++) {
      assert.equal(chickenSurvival(mode, step, 2), 1);
      for (let i = 0; i < 100; i++) assert.equal(chickenStepSafe(`server-${i}`, `client-${i}`, mode, step, 2), true);
      assert(chickenPayout(10000n, mode, step) > 10000n);
    }
  }
  assert.throws(() => chickenStepSafe("a", "b", "easy", 25), /INVALID_STEP/);
  assert.throws(() => chickenStepSafe("a", "b", "easy", .5), /INVALID_STEP/);
  assert.throws(() => chickenStepSafe("a", "b", "easy", 1, 4 as never), /INVALID_VERSION/);
});
