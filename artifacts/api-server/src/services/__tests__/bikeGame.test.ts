import { strict as assert } from "node:assert";
import { test } from "node:test";
import { bikeProgress, bikeOrder, bikeRoundSchedule, bikeRoundPhase } from "@workspace/api-zod/bike-racing-game";
import { makeBikePlan, validateBikeSlip } from "../bikeGame";

test("20 second betting, 20 second automatic race, 5 second result, exact boundaries", () => {
  const r = bikeRoundSchedule("apex", 1790000000000);
  assert.equal(r.startedAt - r.bettingOpensAt, 20000);
  assert.equal(r.endsAt - r.startedAt, 20000);
  assert.equal(r.nextRoundAt - r.endsAt, 5000);
  assert.equal(bikeRoundPhase(r, r.startedAt - 1), "betting");
  assert.equal(bikeRoundPhase(r, r.startedAt), "racing");
  assert.equal(bikeRoundPhase(r, r.endsAt), "results");
  assert.notEqual(bikeRoundSchedule("apex", r.nextRoundAt).id, r.id);
});
test("all bikes move forward, overtake, and visibly finish in the committed order", () => {
  let overtakes = 0;
  for (let i = 0; i < 100; i++) {
    const plan = makeBikePlan(`animation-${i}`), previous = Array(6).fill(0);
    assert.deepEqual(makeBikePlan(`animation-${i}`), plan);
    let oldOrder = "";
    for (let t = 0; t <= 20; t += .1) {
      const order = bikeOrder(plan, t).join();
      if (oldOrder && order !== oldOrder) overtakes++;
      oldOrder = order;
      for (const b of plan.runners) {
        const p = bikeProgress(b, t);
        assert(p >= previous[b.id - 1]); previous[b.id - 1] = p;
        if (t < b.finishTime) assert(p < 1);
      }
    }
    assert.deepEqual(bikeOrder(plan, 20), plan.order);
    for (const b of plan.runners) { assert(b.finishTime < 20); assert.equal(bikeProgress(b, b.finishTime), 1); }
  }
  assert(overtakes > 300);
});
test("independent cryptographic draws cover all six winners evenly", () => {
  const counts = Array(6).fill(0);
  for (let i = 0; i < 12000; i++) counts[makeBikePlan(`distribution-${i}`).order[0] - 1]++;
  counts.forEach(n => assert(n > 1800 && n < 2200, String(counts)));
});
test("coin validation rejects fractional, duplicate, unknown and excessive stakes", () => {
  assert.equal(validateBikeSlip([{ bikeId: 1, amountPaise: "1000" }, { bikeId: 6, amountPaise: "2000" }], 100n, 10000n), 3000n);
  for (const bets of [[], [{ bikeId: 7, amountPaise: "100" }], [{ bikeId: 1, amountPaise: "0" }],
    [{ bikeId: 1, amountPaise: "101" }], [{ bikeId: 1, amountPaise: "-100" }],
    [{ bikeId: 1, amountPaise: "10001" }], [{ bikeId: 1, amountPaise: "20000" }],
    [{ bikeId: 1, amountPaise: "100" }, { bikeId: 1, amountPaise: "100" }]]) {
    assert.throws(() => validateBikeSlip(bets, 100n, 10000n));
  }
});
