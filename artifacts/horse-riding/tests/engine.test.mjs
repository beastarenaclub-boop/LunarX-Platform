import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RUNNERS,
  VENUES,
  makePlan,
  progressAt,
  settle,
  standingsAt,
  trackPoint,
  oddsFor,
} from "../src/racing/engine.ts";

function random(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
  };
}
test("every venue finishes in its drawn order; race progress never reverses or finishes early", () => {
  for (const venue of VENUES)
    for (let seed = 1; seed <= 12; seed++) {
      const plan = makePlan(venue, random(seed), 1000);
      assert.equal(plan.startAt, 4000);
      assert.equal(new Set(plan.order).size, 8);
      for (const runner of RUNNERS) {
        let previous = 0;
        for (let t = 0; t < plan.times[runner.id - 1]; t += 0.05) {
          const progress = progressAt(plan, runner.id, t);
          assert.ok(progress >= previous, "progress must be monotonic");
          assert.ok(
            progress < 1,
            "horse must not cross before its finish time",
          );
          previous = progress;
        }
        assert.equal(progressAt(plan, runner.id, plan.times[runner.id - 1]), 1);
      }
      assert.deepEqual(standingsAt(plan, 1000), plan.order);
      assert.equal(
        [...RUNNERS].sort(
          (a, b) => plan.times[a.id - 1] - plan.times[b.id - 1],
        )[0].id,
        plan.order[0],
      );
    }
});
test("winner payout includes stake, losing tickets pay zero, and settlement does not mutate tickets", () => {
  const plan = makePlan(VENUES[0], random(99));
  const tickets = RUNNERS.map((r) => ({
    horseId: r.id,
    stake: 100,
    odds: oddsFor(r.id),
  }));
  const before = JSON.stringify(tickets),
    result = settle(plan, tickets);
  assert.equal(result.stake, 800);
  assert.equal(result.payout, Math.round(100 * oddsFor(plan.order[0])));
  assert.equal(JSON.stringify(tickets), before);
  assert.equal(settle(plan, []).payout, 0);
  assert.equal(
    settle(
      plan,
      tickets.filter((t) => t.horseId !== plan.order[0]),
    ).payout,
    0,
  );
});
test("weighted random races can produce every winner, with favourites winning more often", () => {
  const wins = Array(8).fill(0),
    rng = random(5145);
  for (let i = 0; i < 12000; i++) wins[makePlan(VENUES[0], rng).order[0] - 1]++;
  assert.ok(wins.every((n) => n > 400));
  assert.ok(wins[0] > wins[7] * 2);
  assert.ok(oddsFor(1) < oddsFor(8));
});
test("oval is closed and continuous, with correctly directed tangent vectors", () => {
  for (let lane = 0; lane < 8; lane++) {
    assert.deepEqual(trackPoint(0, lane), trackPoint(1, lane));
    for (let p = 0; p < 1; p += 0.001) {
      const a = trackPoint(p, lane),
        b = trackPoint(p + 0.00001, lane);
      const dx = b.x - a.x,
        dz = b.z - a.z;
      assert.ok(Math.hypot(dx, dz) < 0.007);
      assert.ok(dx * Math.sin(a.heading) + dz * Math.cos(a.heading) > 0);
    }
  }
});
