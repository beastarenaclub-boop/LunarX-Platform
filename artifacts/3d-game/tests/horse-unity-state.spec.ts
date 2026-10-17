import { test, expect } from "@playwright/test";
import {
  makeHorsePlan,
  type RacingLiveRound,
} from "@workspace/api-zod/horse-racing-game";
import { unityRaceFrame } from "../src/components/horse-racing/UnityHorseRaceScene";
import {
  displayedProgress,
  trackPoint,
  venue3d,
} from "../src/components/horse-racing/race3dMath";

const now = 2_000_000;
function race(venueId = "royal") {
  return {
    id: "unity-round",
    venueId,
    bettingOpensAt: now - 20000,
    startedAt: now,
    endsAt: now + 40000,
    nextRoundAt: now + 45000,
    phase: "racing",
    plan: makeHorsePlan("unity-test", venueId),
    winnerId: null,
  } as RacingLiveRound;
}
test("Unity keeps unrevealed and wrong-venue races at the starting gate", () => {
  for (const current of [null, { ...race(), plan: null }, race("dubai")]) {
    const frame = unityRaceFrame(
      {
        race: current,
        venueId: "royal",
        serverOffset: 0,
        selected: [],
        camera: "broadcast",
      },
      now + 10000,
    );
    expect(frame.running).toBe(false);
    expect(frame.winner).toBe(0);
    expect(frame.runners).toHaveLength(8);
    expect(frame.runners.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(frame.runners.every((r) => Math.abs(r.x) < 0.0001)).toBe(true);
  }
});
test("Unity positions preserve server progress, venue laps, and clock offset", () => {
  for (const venueId of [
    "royal",
    "dubai",
    "alpine",
    "coast",
    "night",
    "marathon",
  ]) {
    const current = race(venueId),
      elapsed = 9;
    const frame = unityRaceFrame(
      {
        race: current,
        venueId,
        serverOffset: 1200,
        selected: [5],
        camera: "rail",
      },
      now + elapsed * 1000 - 1200,
    );
    for (const runner of current.plan!.runners) {
      const expected = trackPoint(
        displayedProgress(current.plan!, runner.id, elapsed) *
          venue3d(venueId).laps,
        runner.lane * 0.74 + 0.35,
      );
      const actual = frame.runners[runner.id - 1];
      expect(actual.x).toBeCloseTo(expected.x, 6);
      expect(actual.z).toBeCloseTo(expected.z, 6);
      expect(actual.heading).toBeCloseTo((expected.heading * 180) / Math.PI, 6);
    }
  }
});
test("Unity announces the exact winner only after its finish crossing", () => {
  const current = race(),
    plan = current.plan!,
    id = plan.order[0];
  const crossing =
    plan.runners.find((r) => r.id === id)!.finishTime * 1000 + now;
  const state = {
    race: current,
    venueId: "royal",
    serverOffset: 0,
    selected: [id === 1 ? 8 : 1],
    camera: "broadcast" as const,
  };
  expect(unityRaceFrame(state, crossing - 0.1).winner).toBe(0);
  expect(unityRaceFrame(state, crossing + 0.1).winner).toBe(id);
  expect(
    unityRaceFrame(
      { ...state, race: { ...current, id: "next", plan: null } },
      crossing + 10000,
    ).winner,
  ).toBe(0);
});
test("Auto introductions and all cameras remain presentation choices", () => {
  const current = { ...race(), plan: null };
  const state = {
    race: current,
    venueId: "royal",
    serverOffset: 0,
    selected: [],
    camera: "auto" as const,
  };
  expect(unityRaceFrame(state, now - 15000).featured).toBeGreaterThan(0);
  expect(
    unityRaceFrame({ ...state, camera: "headon" }, now - 15000).featured,
  ).toBe(0);
  expect(
    unityRaceFrame({ ...state, camera: "headon" }, now - 15000).camera,
  ).toBe("headon");
});
