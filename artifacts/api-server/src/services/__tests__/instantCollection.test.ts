import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { collectionMultiplier, collectionPayout, collectionSteps, INSTANT_COLLECTION, REQUESTED_INSTANT_CODES, roadSurvival, type CollectionOptions } from "@workspace/api-zod/instant-collection";
import { instantDraw, instantHazards, instantRandom, instantSafe, instantSeedHash } from "../instantCollectionMath";
import { towerPayout, towerReturnMillis, towerSurvival, towerStepChance, TOWER_MIN_RTP, TOWER_PAYOUT_VERSION } from "@workspace/api-zod/instant-collection";
import { towerCrashFloor } from "../instantCollectionMath";
const options: CollectionOptions = { difficulty: "easy", mines: 3, choice: "heads" };

test("tower v4 pays 150 to 190 rupees for a 100-rupee stake at five-floor milestones", () => {
  const expected = new Map([[0,1],[1,.001],[2,.035],[3,.069],[4,.104],[5,1.5],[9,1.5],[10,1.6],[14,1.6],[15,1.7],[19,1.7],[20,1.8],[24,1.8],[25,1.9],[30,1.9],[1000,1.9]]);
  for (const [floor, multiplier] of expected) {
    assert.equal(collectionMultiplier("tower",floor,options,.97,1000,4),multiplier);
    assert.equal(towerPayout(10000n,multiplier,4),BigInt(Math.round(multiplier*10000)));
  }
  assert.equal(towerPayout(101n,1.5,4),151n);
  assert.equal(collectionMultiplier("tower",5,options,.97,1.2,4),1.2);
  assert.equal(collectionMultiplier("tower",5,options,.97,1000,3),.138);
});

test("tower v4 calibrates every stopping floor to RTP and uses replayable versioned outcomes", () => {
  for (const rtp of [0,.0001,.01,.1,.5,.85,.97,.99,1]) {
    const q=towerStepChance(rtp,4);assert(q>=0&&q<1);
    let best=0;
    for(let floor=1;floor<=10000;floor++) {
      const expected=q**floor*collectionMultiplier("tower",floor,options,rtp,1000,4);
      assert(expected<=rtp+1e-12);best=Math.max(best,expected);
    }
    assert(Math.abs(best-rtp)<1e-12);
  }
  const q=towerStepChance(.97,4);let survivors=0;
  for(let seed=0;seed<15000;seed++) {
    const expected=instantRandom(String(seed),"client","tower-rush","tower:v4:floor:1")<q;
    for(const cell of [0,1,2])assert.equal(instantSafe("tower",String(seed),"client","tower-rush",1,cell,options,4,.97),expected);
    survivors+=Number(expected);
  }
  assert(Math.abs(survivors/15000-q)<.015);
  assert.equal(towerSurvival(50,.97,4),q**50);
});

test("tower v3 calibrates unlimited independent floors to admin RTP", () => {
  assert.equal(TOWER_PAYOUT_VERSION, 4);
  for (const rtp of [0, .0001, .01, .1, .5, .621, .85, .97, .99, 1]) {
    const q = towerStepChance(rtp);
    assert(q >= 0 && q < 1);
    assert.equal(towerStepChance(rtp), q);
    let best = 0;
    for (let floor = 1; floor <= 10000; floor++) {
      const multiplier = collectionMultiplier("tower", floor, options, rtp, Infinity, 3);
      const expected = q ** floor * multiplier;
      best = Math.max(best, expected);
      assert(expected <= rtp + 1e-12);
    }
    assert(Math.abs(best - rtp) < 1e-12, `rtp=${rtp}, best=${best}`);
    assert.equal(towerSurvival(35, rtp, 3), q ** 35);
  }
  assert.equal(collectionSteps("tower", options), Infinity);
  for (const n of [1, 30, 35, 100, 10000]) {
    assert.equal(collectionMultiplier("tower", n, options, .97, Infinity, 3), towerReturnMillis(n) / 1000);
  }
  assert.equal(towerPayout(10000n, .001, 3), 10n);
  assert.equal(towerPayout(12345n, .001, 3), 12n);
  assert.equal(collectionMultiplier("tower", 100, options, .97, 1, 3), 1);
});

test("tower v3 can lose on floor one or survive beyond 35; seeded outcomes replay", () => {
  const rtp = .97, q = towerStepChance(rtp), trials = 20000;
  for (const floor of [1, 19, 35, 36, 100, 10000]) {
    let safe = 0;
    for (let i = 0; i < trials; i++) {
      const seed = `v3-${i}`;
      const expected = instantRandom(seed, "client", "tower-rush", `tower:v3:floor:${floor}`) < q;
      for (const cell of [0, 1, 2]) assert.equal(instantSafe("tower", seed, "client", "tower-rush", floor, cell, options, 3, rtp), expected);
      safe += Number(expected);
    }
    assert(safe > 0 && safe < trials);
    assert(Math.abs(safe / trials - q) < .004);
  }
  let surviving = 0;
  for (let i = 0; i < 2000; i++) {
    let floor = 1;
    while (floor <= 100 && instantSafe("tower", `path-${i}`, "client", "tower-rush", floor, 0, options, 3, rtp)) floor++;
    surviving += Number(floor > 100);
  }
  assert(Math.abs(surviving / 2000 - q ** 100) < .04);
});

test("tower v2 uses exact thousandth returns, including paise and large stakes", () => {
  assert.equal(towerReturnMillis(1), 1);
  assert.equal(towerReturnMillis(19), 621);
  assert.equal(towerReturnMillis(30), 1000);
  assert.equal(towerReturnMillis(34), 1137);
  assert.equal(collectionMultiplier("tower", 1, options, .97, 1000, 2), .001);
  assert.equal(towerPayout(10000n, .001, 2), 10n);
  assert.equal(towerPayout(100n, .001, 2), 0n);
  assert.equal(towerPayout(12345n, .001, 2), 12n);
  assert.equal(towerPayout(900719925474099100n, .001, 2), 900719925474099n);
  assert.equal(towerPayout(10000n, 1, 2), 10000n);
  assert.equal(collectionMultiplier("tower", 34, options, .97, 1, 2), 1);
  assert.equal(collectionMultiplier("tower", 1, options, .97, 1000, 1), 1.45);
  assert.equal(towerPayout(10000n, 1.45, 1), 14500n);
});

test("tower v2 fixes one crash floor in 20–35, preserves 19 safe floors and matches weighted RTP", () => {
  for (const rtp of [TOWER_MIN_RTP, .7, .85, .97, .99]) {
    let best = 0;
    for (let floor = 1; floor <= 35; floor++) {
      const value = towerSurvival(floor, rtp) * towerReturnMillis(floor) / 1000;
      best = Math.max(best, value);
      assert(value <= rtp + 1e-12);
    }
    assert(Math.abs(best - rtp) < 1e-12);
    const counts = Array(36).fill(0), trials = 20000;
    for (let i = 0; i < trials; i++) {
      const seed = `v2-${i}`, crash = towerCrashFloor(seed, "client", rtp);
      assert(crash >= 20 && crash <= 35); counts[crash]++;
      assert.equal(towerCrashFloor(seed, "client", rtp), crash);
      assert(instantSafe("tower", seed, "client", "tower-rush", 19, 0, options, 2, rtp));
      for (const cell of [0, 1, 2]) {
        assert(instantSafe("tower", seed, "client", "tower-rush", crash - 1, cell, options, 2, rtp));
        assert(!instantSafe("tower", seed, "client", "tower-rush", crash, cell, options, 2, rtp));
        assert(!instantSafe("tower", seed, "client", "tower-rush", 35, cell, options, 2, rtp));
      }
    }
    for (let crash = 20; crash <= 35; crash++) {
      assert(counts[crash] > 0);
      const expected = towerSurvival(crash - 1, rtp) - towerSurvival(crash, rtp);
      assert(Math.abs(counts[crash] / trials - expected) < .015);
    }
  }
});
test("all requested games have unique codes and all new games have rules", () => {
  assert.equal(new Set(REQUESTED_INSTANT_CODES).size, 10);
  assert.equal(INSTANT_COLLECTION.length, 7);
  for (const g of INSTANT_COLLECTION) assert(REQUESTED_INSTANT_CODES.includes(g.code));
});
test("seed commitment and HMAC stream can be independently replayed", () => {
  assert.equal(instantSeedHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const hash = createHmac("sha256", "server").update("instant:v1:coin-flip:client:draw").digest("hex");
  assert.equal(instantRandom("server", "client", "coin-flip", "draw"), parseInt(hash.slice(0, 13), 16) / 2 ** 52);
});
test("mines are unique, stable, in bounds, and never move after safe reveals", () => {
  for (let seed = 0; seed < 100; seed++) for (const count of [1, 3, 5, 10]) {
    const hazards = instantHazards(String(seed), "client", "pirate-jackpot-mines", count);
    assert.equal(new Set(hazards).size, count);
    for (let cell = 0; cell < 25; cell++) {
      assert.equal(instantSafe("mines", String(seed), "client", "pirate-jackpot-mines", 1, cell, { ...options, mines: count }), !hazards.includes(cell));
    }
  }
});
test("every tower floor has exactly two safe doors", () => {
  for (let i = 0; i < 100; i++) for (let step = 1; step <= 40; step++) {
    const safe = [0, 1, 2].filter(cell => instantSafe("tower", String(i), "client", "tower-rush", step, cell, options));
    assert.equal(safe.length, 2);
  }
});

test("tower BUILD path preserves configured RTP at every stopping floor and payout cap", () => {
  for (const rtp of [.50, .85, .97]) for (const cap of [2, 1000]) for (let step = 1; step <= 40; step++) {
    const chance = (2 / 3) ** step;
    const payout = collectionMultiplier("tower", step, options, rtp, cap);
    assert(payout <= cap);
    assert(chance * payout <= rtp + 1e-10);
    if (payout < cap) assert(rtp - chance * payout < .01);
  }
  assert.equal(((2 / 3) ** 10 * 100).toFixed(2), "1.73");
  // BUILD consistently reveals cell zero; it still has the published 2/3
  // chance, independently of the visual sway or click timing.
  let safe = 0;
  for (let i = 0; i < 15000; i++) safe += Number(instantSafe("tower", String(i), "client", "tower-rush", 1, 0, options));
  assert(Math.abs(safe / 15000 - 2 / 3) < .015);
});
test("progressive stopping returns stay at or below the advertised RTP", () => {
  for (const difficulty of ["easy", "medium", "hard"] as const) for (let step = 1; step <= 12; step++) {
    const multiplier = collectionMultiplier("road", step, { ...options, difficulty });
    assert(multiplier * roadSurvival(difficulty) ** step <= .970000001);
    assert(multiplier <= 1000);
  }
  for (const count of [1, 3, 5, 10]) {
    let chance = 1;
    for (let step = 1; step <= 25 - count; step++) {
      chance *= (26 - count - step) / (26 - step);
      assert(collectionMultiplier("mines", step, { ...options, mines: count }) * chance <= .970000001);
    }
  }
  assert.equal(collectionPayout(101n, 1.94), 195n);
  assert.equal(collectionPayout(900719925474099100n, 1.94), 1747396655419752254n);
});
test("coin, dice and fishing distributions match their published rules", () => {
  const n = 25000; let heads = 0, fishingReturn = 0; const dice = [0, 0, 0], catches = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const coin = instantDraw("coin", String(i), "client", "coin-flip", "heads", .97);
    heads += coin.outcome[0] === 0 ? 1 : 0; assert(coin.multiplier === 0 || coin.multiplier === 1.94);
    const roll = instantDraw("dice", String(i), "client", "7up7down", "seven", .97);
    const total = roll.outcome.reduce((a, b) => a + b, 0); dice[total < 7 ? 0 : total === 7 ? 1 : 2]++;
    assert.equal(roll.multiplier, total === 7 ? 1.98 : 0);
    const fish = instantDraw("fishing", String(i), "client", "jackpot-fishing", "cast", .97);
    catches[fish.outcome[0]]++; fishingReturn += fish.multiplier;
  }
  assert(Math.abs(heads / n - .5) < .015);
  [15 / 36, 6 / 36, 15 / 36].forEach((chance, i) => assert(Math.abs(dice[i] / n - chance) < .015));
  [.5, .3, .15, .04, .01].forEach((chance, i) => assert(Math.abs(catches[i] / n - chance) < .015));
  assert(Math.abs(fishingReturn / n - .97) < .03);
});


test("tower has no final floor and very high floor returns remain finite at the configured cap", () => {
  assert.equal(collectionSteps("tower", options), Infinity);
  assert.equal(collectionSteps("mines", options), 22);
  assert.equal(collectionSteps("road", options), 12);
  for (const step of [10, 25, 100, 1000, 10000]) {
    const multiplier = collectionMultiplier("tower", step, options, .97, 1000);
    assert(Number.isFinite(multiplier));
    assert(multiplier <= 1000);
  }
});
