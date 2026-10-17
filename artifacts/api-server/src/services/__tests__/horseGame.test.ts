import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  makeHorsePlan,
  horseProgress,
  horseOrder,
  RACING_HORSES,
  RACING_VENUES,
  horseOdds,
  HORSE_RACE_SPEED,
  horseRoundSchedule,
} from "@workspace/api-zod/horse-racing-game";
import { validateHorseSlip } from "../horseGame";
test("faster rounds retain the draw, preserve 20 seconds betting and finish before settlement", () => {
  for (const venue of RACING_VENUES)
    for (let i = 0; i < 40; i++) {
      const original = makeHorsePlan(`pace-${i}`, venue.id);
      const faster = makeHorsePlan(`pace-${i}`, venue.id, HORSE_RACE_SPEED);
      const schedule = horseRoundSchedule(venue.id, 1770000000000);
      assert.deepEqual(faster.order, original.order);
      assert.equal(schedule.startedAt - schedule.bettingOpensAt, 20000);
      assert.equal(schedule.nextRoundAt - schedule.endsAt, 5000);
      assert(faster.duration * 1000 < schedule.endsAt - schedule.startedAt);
      for (const runner of faster.runners) {
        const old = original.runners[runner.id - 1];
        assert.equal(runner.finishTime, old.finishTime / HORSE_RACE_SPEED);
        assert.equal(horseProgress(runner, runner.finishTime), 1);
        assert.deepEqual(runner.points, old.points);
        assert(horseProgress(runner, runner.finishTime - 0.01) < 1);
      }
    }
});
test("independent runners overtake, move forward and finish in exactly the server draw order", () => {
  let overtakes = 0;
  for (const venue of RACING_VENUES)
    for (let seed = 0; seed < 80; seed++) {
      const plan = makeHorsePlan(`race-${seed}`, venue.id),
        previous = Array(8).fill(0);
      let old = "";
      for (let t = 0; t < plan.duration; t += 0.15) {
        const order = horseOrder(plan, t).join(",");
        if (old && old !== order) overtakes++;
        old = order;
        for (const runner of plan.runners) {
          const p = horseProgress(runner, t);
          assert(p >= previous[runner.id - 1]);
          if (t < runner.finishTime) assert(p < 1);
          previous[runner.id - 1] = p;
        }
      }
      assert.deepEqual(horseOrder(plan, plan.duration), plan.order);
      assert.deepEqual(
        plan.runners
          .slice()
          .sort((a, b) => a.finishTime - b.finishTime)
          .map((h) => h.id),
        plan.order,
      );
      assert.deepEqual(makeHorsePlan(`race-${seed}`, venue.id), plan);
    }
  assert(overtakes > 1000);
});
test("new races have fresh trajectories and first-finisher frequencies match advertised odds", () => {
  const counts = Array(8).fill(0);
  const phases = new Set<string>();
  for (let i = 0; i < 20000; i++) {
    const plan = makeHorsePlan(`draw-${i}`, "royal");
    counts[plan.order[0] - 1]++;
    if (i < 100) phases.add(JSON.stringify(plan.runners));
  }
  assert.equal(phases.size, 100);
  for (const h of RACING_HORSES) {
    assert(Math.abs(counts[h.id - 1] / 20000 - h.probability / 100) < 0.02);
    assert(horseOdds(h.probability, 0.03) * h.probability <= 97);
  }
});
test("multi-horse stakes reject duplicates, unknown runners, malformed values and limits", () => {
  assert.equal(
    validateHorseSlip(
      [
        { horseId: 1, amountPaise: "1000" },
        { horseId: 8, amountPaise: "2000" },
      ],
      100n,
      10000n,
    ),
    3000n,
  );
  for (const bets of [
    [],
    [{ horseId: 9, amountPaise: "1000" }],
    [{ horseId: 1, amountPaise: "0" }],
    [{ horseId: 1, amountPaise: "1001" }],
    [{ horseId: 1, amountPaise: "-100" }],
    [
      { horseId: 1, amountPaise: "1000" },
      { horseId: 1, amountPaise: "1000" },
    ],
    [{ horseId: 1, amountPaise: "20000" }],
  ])
    assert.throws(() => validateHorseSlip(bets, 100n, 10000n));
});
