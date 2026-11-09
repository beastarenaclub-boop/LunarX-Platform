/**
 * The streak counters may only move on a round the engine actually priced.
 *
 * `normal` mode builds no candidates on purpose, so the exposure handed to the
 * streak update is empty and the "which outcome landed" lookup always misses.
 * Read as "nobody backed it", that turned the unbacked streak into a plain
 * round counter: it climbed on every round a stream spent in `normal` and never
 * reset. Measured on the live shared wheel — a round with all 38 pockets backed
 * still took it from 185 to 186.
 *
 * It bites on the FIRST steered round after a mode change. `eligible()` sees
 * the streak past its maximum, narrows the pool to outcomes somebody backed,
 * and so strips the zeros: on any ordinary book the two best collecting pockets
 * on the wheel. Collect at its weakest on the round it was asked to collect.
 *
 *   K1  an unpriced round leaves both streaks alone
 *   K2  a priced round with a backed winner resets the unbacked streak
 *   K3  a priced round nobody backed still advances it
 *   K4  negative control: the old rule advanced on the unpriced round
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  fileURLToPath(new URL("../engine.ts", import.meta.url)),
  "utf-8",
).replace(/\r\n/g, "\n");

/**
 * The rule as the SOURCE writes it, extracted from `engine.ts` rather than
 * re-typed here.
 *
 * A local copy would pass identically with the fix reverted, which is a test
 * that cannot fail. This lifts the real expression and evaluates it, so an
 * edit to the source that changes the rule changes what these cases see.
 */
function nextStreak(priced: boolean, backed: boolean, current: number): number {
  const m = /zeroBetStreak: (![\s\S]*?),\n\s+\/\//.exec(SRC);
  assert.ok(m, "could not find the zeroBetStreak rule in engine.ts");
  const expr = m![1]!
    .replace(/state\.zeroBetStreak/g, "current")
    .replace(/\s+/g, " ");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return Function("priced", "backed", "current", `return (${expr});`)(
    priced,
    backed,
    current,
  ) as number;
}

test("K1 an unpriced round leaves the streak where it is", () => {
  assert.equal(nextStreak(false, false, 185), 185);
  assert.equal(nextStreak(false, true, 0), 0);
});

test("K2 a priced round somebody backed resets it", () => {
  assert.equal(nextStreak(true, true, 185), 0);
});

test("K3 a priced round nobody backed advances it", () => {
  assert.equal(nextStreak(true, false, 2), 3);
});

test("K4 negative control: the old rule climbed on the unpriced round", () => {
  const old = (backed: boolean, current: number) => (backed ? 0 : current + 1);
  // With no exposure, `backed` is always false — this is the bug, reproduced.
  assert.equal(old(false, 185), 186);
  assert.notEqual(old(false, 185), nextStreak(false, false, 185));
});

test("K5 the source computes `priced` from the exposure, not from the mode", () => {
  // Keying on `mode === "normal"` would miss the other unpriced paths: an empty
  // book and every failure path also hand this an empty exposure.
  assert.ok(
    SRC.includes("const priced = exposure.outcomes.length > 0"),
    "the guard must read the exposure it was given",
  );
  assert.ok(
    SRC.includes("zeroBetStreak: !priced"),
    "the unbacked streak must respect it",
  );
  assert.ok(
    SRC.includes("beneficiaryStreak: !priced"),
    "the beneficiary streak reads the same empty exposure and must respect it too",
  );
});

test("K6 a forced round is recorded in the recent history", () => {
  // Left out, `streaking()` counted none of them and an operator forcing one
  // pocket repeatedly never tripped the guard meant to break a pattern.
  const force = SRC.slice(SRC.indexOf("// 1 — admin force."), SRC.indexOf("// 2 — the engine."));
  assert.ok(force.includes("noteRoundOutcome("), "a force must update the history");
  assert.ok(force.includes("mode: state.mode"), "a force must record the real mode");
  assert.ok(!force.includes('mode: "normal"'), "a force is not an unsteered round");
});
