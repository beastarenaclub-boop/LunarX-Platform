import { expect, test } from "@playwright/test";
import {
  buildThrowPlan,
  anchorDie,
  DIE_REST_Y,
  diePose,
  MIN_THROW_MS,
  planDealerThrow,
} from "../src/components/lucky7/dicePlan";
import { FACE_VALUES, restQuaternion } from "../src/components/lucky7/DiceScene";
import { Vector3 } from "three";
import { dieGeometry, FACE_ATLAS } from "../src/components/lucky7/diceAppearance";

test("dealer gesture and dice both finish before the server reveal deadline", () => {
  for (const remaining of [0, 1000, 1600, 2200, 3000, 5000, 10000]) {
    for (const gesture of [0, 700, 1000, 1500]) {
      const plan = planDealerThrow(remaining, gesture);
      if (plan.durationMs > 0) {
        expect(plan.durationMs).toBeGreaterThanOrEqual(MIN_THROW_MS);
        expect(plan.windupMs).toBe(gesture);
        expect(plan.windupMs + plan.durationMs + 500).toBeLessThanOrEqual(remaining);
      } else {
        expect(plan.windupMs).toBe(0);
      }
    }
  }
});

test("late joins skip the gesture instead of extending the round", () => {
  expect(planDealerThrow(1800, 1000)).toEqual({ windupMs: 0, durationMs: 0 });
  expect(planDealerThrow(Number.NaN, 1000)).toEqual({ windupMs: 0, durationMs: 0 });
});

test("the shake fits a normal reveal at 1x and a late reveal never speeds up the dealer", () => {
  const normal = planDealerThrow(5000, 2625, 4500, 1.1);
  expect(normal).toEqual({ windupMs: 2625, durationMs: 1875 });
  for (const remaining of [1500, 3000, 4000, 4500]) {
    expect(planDealerThrow(remaining, 2625, 4500, 1.1)).toEqual({ windupMs: 0, durationMs: 0 });
  }
});

test("one video rate preserves the palm-release fraction at every reveal length", () => {
  for (const remaining of [1000, 2000, 3000, 4000, 5000, 8000]) {
    const plan = planDealerThrow(remaining, 2400, 4600);
    if (!plan.durationMs) continue;
    expect(plan.windupMs / (plan.windupMs + plan.durationMs)).toBeCloseTo(2400 / 4600, 12);
    expect(plan.windupMs + plan.durationMs + 500).toBeLessThanOrEqual(remaining);
  }
});

test("dice start at the dealer and settle at their own deterministic positions", () => {
  for (const round of ["round-under", "round-seven", "round-over"]) {
    const plan = buildThrowPlan(round, 3000);
    for (const die of plan.dice) {
      const release = diePose(die, 0);
      const resting = diePose(die, 1);
      expect(Math.abs(release.x)).toBeLessThan(0.3);
      expect(release.z).toBeLessThan(-1.8);
      expect(resting.x).toBeCloseTo(die.to[0], 12);
      expect(resting.z).toBeCloseTo(die.to[2], 12);
      expect(resting.y).toBe(DIE_REST_Y);
      expect(resting.spin).toBe(0);
    }
  }
});

test("the rendered throw starts exactly at the filmed dice handoff", () => {
  const die = buildThrowPlan("hand-release", 2400).dice[0];
  anchorDie(die, [-0.31, 1.92, -1.8]);
  const start = diePose(die, 0);
  expect([start.x, start.y, start.z]).toEqual(die.from);
  for (const impact of die.bounces) expect(diePose(die, impact).y).toBeCloseTo(DIE_REST_Y, 12);
  const nextFrame = diePose(die, 1 / (60 * 2.4));
  expect(Math.hypot(nextFrame.x - start.x, nextFrame.y - start.y, nextFrame.z - start.z)).toBeLessThan(0.1);
});

test("all six server values finish with the matching pip face upward", () => {
  const normals = [new Vector3(1,0,0), new Vector3(-1,0,0), new Vector3(0,1,0), new Vector3(0,-1,0), new Vector3(0,0,1), new Vector3(0,0,-1)];
  for (let value = 1; value <= 6; value++) {
    for (const yaw of [0, 0.6, 2.7, 5.9]) {
      const orientation = restQuaternion(value, yaw);
      const up = normals.map(normal => normal.clone().applyQuaternion(orientation).y);
      expect(FACE_VALUES[up.indexOf(Math.max(...up))]).toBe(value);
      expect(Math.max(...up)).toBeCloseTo(1, 12);
    }
  }
});

test("each rounded face samples only its own pip tile in the shared texture", () => {
  const uv = dieGeometry.getAttribute("uv");
  const verticesPerFace = uv.count / 6;
  for (let face = 0; face < 6; face++) {
    for (let i = face * verticesPerFace; i < (face + 1) * verticesPerFace; i++) {
      const col = Math.floor(uv.getX(i) * FACE_ATLAS.columns);
      const row = Math.floor((1 - uv.getY(i)) * FACE_ATLAS.rows);
      expect(FACE_VALUES[row * FACE_ATLAS.columns + col]).toBe(FACE_VALUES[face]);
    }
  }
});

test("dice cover the felt, finish their bounces, and visibly skid before stopping", () => {
  const endpoints = new Set<string>();
  for (let round = 0; round < 30; round++) {
    for (const die of buildThrowPlan(`physical-${round}`, 3000).dice) {
      expect(die.to[2] - die.from[2]).toBeGreaterThan(4);
      expect(die.bounces[2]).toBeLessThan(0.4);
      const skid = diePose(die, die.rollEnd);
      const stop = diePose(die, 1);
      expect(skid.phase).toBe("slide");
      expect(skid.spin).toBe(0);
      expect(skid.y).toBe(DIE_REST_Y);
      expect(Math.hypot(stop.x - skid.x, stop.z - skid.z)).toBeGreaterThan(0.3);
      expect(diePose(die, 0.92).y).toBe(DIE_REST_Y);
      expect(stop.phase).toBe("rest");
      expect(stop.skidYaw).toBeCloseTo(0, 12);
      endpoints.add(`${stop.x.toFixed(2)}:${stop.z.toFixed(2)}`);
    }
  }
  expect(endpoints.size).toBeGreaterThan(50);
});
