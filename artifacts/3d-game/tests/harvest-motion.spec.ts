import { test, expect } from "@playwright/test";
import {
  catchTime,
  catchX,
  harvestFrame,
  junkDrops,
  dodgeBowlX,
  HARVEST_DURATION_MS as duration,
} from "../src/components/vegetable/harvestMotion";
import {
  nextWorld,
  HARVEST_WORLDS,
} from "../src/components/vegetable/harvestWorld";

test("junk misses the bowl, preserves every vegetable catch and never changes the count", () => {
  for (let total = 1; total <= 12; total++)
    for (let seed = 0; seed < 20; seed++) {
      const drops = junkDrops(total, duration, `motion-${seed}`);
      let minimumClearance = Infinity,
        minimumX = Infinity,
        maximumX = -Infinity;
      const unexpectedCounts: number[] = [];
      expect(drops.length).toBeGreaterThanOrEqual(3);
      for (const drop of drops) {
        const before = harvestFrame(
          drop.crossesAt - 180,
          total,
          duration,
        ).collected;
        for (let offset = -180; offset <= 280; offset += 20) {
          const frame = harvestFrame(drop.crossesAt + offset, total, duration);
          const x = dodgeBowlX(frame.bowlX, drop.crossesAt + offset, drops);
          minimumClearance = Math.min(minimumClearance, Math.abs(x - drop.x));
          minimumX = Math.min(minimumX, x);
          maximumX = Math.max(maximumX, x);
          if (frame.collected !== before)
            unexpectedCounts.push(frame.collected);
        }
      }
      expect(minimumClearance).toBeGreaterThan(175);
      expect(minimumX).toBeGreaterThan(120);
      expect(maximumX).toBeLessThan(600);
      expect(unexpectedCounts).toEqual([]);
      for (let index = 0; index < total; index++) {
        const time = catchTime(index, total, duration),
          frame = harvestFrame(time, total, duration);
        expect(dodgeBowlX(frame.bowlX, time, drops)).toBeCloseTo(
          catchX(index),
          4,
        );
        expect(frame.collected).toBe(index + 1);
      }
      expect(harvestFrame(duration, total, duration).collected).toBe(total);
    }
});
test("new rounds change worlds and the same round keeps its world", () => {
  let previous = nextWorld("first", null);
  const visited = new Set([previous.index]);
  for (let i = 0; i < 100; i++) {
    const next = nextWorld(`round-${i}`, previous);
    expect(next.index).not.toBe(previous.index);
    expect(nextWorld(next.roundId, next)).toEqual(next);
    visited.add(next.index);
    previous = next;
  }
  expect(visited.size).toBe(HARVEST_WORLDS.length);
});
