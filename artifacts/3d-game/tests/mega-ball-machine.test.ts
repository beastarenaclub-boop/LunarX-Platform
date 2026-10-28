import test from "node:test";
import assert from "node:assert/strict";
import { CatmullRomCurve3, Vector3 } from "three";
import {
  advanceMachineClock,
  machineFrame,
  MACHINE_NUMBERS,
  NORMAL_DRAW_START,
  NORMAL_DRAW_END,
  MEGA_DRAW_START,
  RELEASE_POINT,
  chuteProgress,
} from "../src/components/megaBall/machineTimeline";
import {
  REEL_VALUES,
  SHOW_TIMING,
  multiplierReelPosition,
} from "../src/components/megaBall/showTimeline";

const normalRelease = (index: number) =>
  NORMAL_DRAW_START +
  ((index + RELEASE_POINT) / 20) * (NORMAL_DRAW_END - NORMAL_DRAW_START);
const megaRelease = MEGA_DRAW_START + (1 - MEGA_DRAW_START) * RELEASE_POINT;

const outcome = {
  balls: [
    51, 6, 34, 18, 3, 48, 22, 9, 37, 15, 2, 44, 28, 10, 41, 20, 33, 12, 50, 7,
  ],
  megaBall: 26,
  multiplier: 25,
  version: 1 as const,
};

test("exact release timestamps never sample the 3D track at a negative distance", () => {
  const curve = new CatmullRomCurve3([
    new Vector3(-1, 3, 0),
    new Vector3(2, 2, 0),
    new Vector3(1, 1, 0.8),
  ]);
  let samples = 0;
  for (let i = 0; i < 20; i++) {
    const release = normalRelease(i);
    for (const offset of [-1e-12, 0, 1e-12]) {
      const active = machineFrame(outcome, release + offset).active;
      if (!active?.released) continue;
      const t = chuteProgress(active.travel);
      assert.ok(t >= 0 && t <= 1);
      const point = curve.getPointAt(Math.min(1, t / 0.77));
      assert.ok([point.x, point.y, point.z].every(Number.isFinite));
      samples++;
    }
  }
  assert.ok(samples >= 40);
  assert.equal(chuteProgress(RELEASE_POINT - Number.EPSILON), 0);
});

test("clock corrections cannot repeat a release, while a new round resets the machine", () => {
  let clock: ReturnType<typeof advanceMachineClock> = {
    roundId: "first",
    progress: 0,
  };
  const released: number[] = [];
  let last: number | null = null;
  for (const progress of [
    0,
    normalRelease(0),
    normalRelease(0) - 0.002,
    normalRelease(0) + 0.001,
    normalRelease(1),
    normalRelease(1) - 0.002,
    normalRelease(1) + 0.001,
  ]) {
    clock = advanceMachineClock(clock, "first", progress);
    const frame = machineFrame(outcome, clock.progress);
    if (frame.current !== last && frame.current != null)
      released.push(frame.current);
    last = frame.current;
  }
  assert.deepEqual(released, outcome.balls.slice(0, 2));
  clock = advanceMachineClock(clock, "second", 0);
  assert.equal(clock.progress, 0);
  assert.equal(machineFrame(null, clock.progress).bowl.length, 51);
});

test("all 51 numbered balls are conserved, with at most one in the chute, throughout the complete draw", () => {
  let lastCount = 0;
  for (let tick = 0; tick <= 20000; tick++) {
    const frame = machineFrame(outcome, tick / 20000);
    const inventory = [
      ...frame.bowl,
      ...frame.rack,
      ...(frame.chute == null ? [] : [frame.chute]),
    ];
    assert.equal(inventory.length, 51);
    assert.equal(new Set(inventory).size, 51);
    assert.deepEqual(
      inventory.sort((a, b) => a - b),
      MACHINE_NUMBERS,
    );
    assert.ok(
      frame.drawn.length === lastCount || frame.drawn.length === lastCount + 1,
    );
    assert.deepEqual(
      frame.drawn,
      [...outcome.balls, outcome.megaBall].slice(0, frame.drawn.length),
    );
    if (frame.chute != null) {
      assert.equal(frame.chute, frame.current);
      assert.equal(frame.chute, frame.active?.number);
      assert.equal(frame.active?.released, true);
      assert.ok(!frame.bowl.includes(frame.chute));
      assert.ok(!frame.rack.includes(frame.chute));
    }
    lastCount = frame.drawn.length;
  }
  const finished = machineFrame(outcome, 1);
  assert.equal(finished.normalCount, 20);
  assert.equal(finished.bowl.length, 30);
  assert.equal(finished.rack.length, 21);
  assert.equal(finished.current, outcome.megaBall);
});

test("the number appears exactly when its physical ball is released", () => {
  for (let i = 0; i < 20; i++) {
    const release = normalRelease(i);
    const before = machineFrame(outcome, release - 0.000001),
      after = machineFrame(outcome, release);
    assert.equal(before.drawn.length, i);
    assert.ok(before.bowl.includes(outcome.balls[i]));
    assert.equal(after.drawn.length, i + 1);
    assert.equal(after.current, outcome.balls[i]);
    assert.equal(after.chute, outcome.balls[i]);
  }
  assert.equal(
    machineFrame(outcome, megaRelease - 0.000001).megaVisible,
    false,
  );
  assert.equal(machineFrame(outcome, megaRelease).current, 26);
  assert.equal(machineFrame(outcome, megaRelease).chute, 26);
});

test("show stages follow the reference and declare results only after the Mega Ball reaches the tray", () => {
  const stages: string[] = [];
  const cameras = new Set<string>();
  for (let tick = 0; tick <= 10000; tick++) {
    const frame = machineFrame(outcome, tick / 10000);
    if (stages.at(-1) !== frame.stage) stages.push(frame.stage);
    cameras.add(frame.camera);
    if (frame.reelOpen > 0) assert.equal(frame.normalCount, 20);
    if (frame.megaVisible) assert.equal(frame.multiplierVisible, true);
    if (frame.resultVisible) {
      assert.equal(frame.rack.length, 21);
      assert.equal(frame.chute, null);
    } else assert.notEqual(frame.stage, "result");
  }
  assert.deepEqual(stages, [
    "mixing",
    "drawing",
    "draw-complete",
    "multiplier-opening",
    "multiplier-spinning",
    "multiplier-selected",
    "mega-draw",
    "result",
  ]);
  assert.deepEqual(
    [...cameras],
    ["wide", "machine", "chute", "multiplier", "mega"],
  );
  assert.equal(
    machineFrame(outcome, SHOW_TIMING.spinEnd - 1e-6).multiplierVisible,
    false,
  );
  assert.equal(
    machineFrame(outcome, SHOW_TIMING.spinEnd).multiplierVisible,
    true,
  );
  assert.equal(machineFrame(outcome, 1 - 1e-6).resultVisible, false);
});

test("the reel rolls in both directions then stops on every supported multiplier", () => {
  for (const multiplier of new Set(REEL_VALUES)) {
    const rows = Array.from({ length: 1001 }, (_, n) =>
      multiplierReelPosition(n / 1000, multiplier),
    );
    assert.ok(rows.some((r, i) => i > 0 && r > rows[i - 1]));
    assert.ok(rows.some((r, i) => i > 0 && r < rows[i - 1]));
    assert.equal(
      REEL_VALUES[Math.round(rows.at(-1)!) % REEL_VALUES.length],
      multiplier,
    );
    assert.ok(Math.abs(rows.at(-1)! - rows.at(-2)!) < 0.001);
  }
});

test("reloads and new rounds reconstruct inventory without duplicate or stale balls", () => {
  for (const progress of [0, 0.017, 0.24, 0.39, 0.78, 0.93, 0.94, 0.99, 1]) {
    assert.deepEqual(
      machineFrame(outcome, progress),
      machineFrame(structuredClone(outcome), progress),
    );
  }
  const fresh = machineFrame(null, 0);
  assert.deepEqual(fresh.bowl, MACHINE_NUMBERS);
  assert.deepEqual(fresh.drawn, []);
  assert.deepEqual(fresh.rack, []);
  assert.equal(fresh.chute, null);
  assert.equal(fresh.current, null);
});
