import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { collectionMultiplier, collectionPayout, INSTANT_COLLECTION, REQUESTED_INSTANT_CODES, roadSurvival, type CollectionOptions } from "@workspace/api-zod/instant-collection";
import { instantDraw, instantHazards, instantRandom, instantSafe, instantSeedHash } from "../instantCollectionMath";
const options: CollectionOptions = { difficulty: "easy", mines: 3, choice: "heads" };
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
  for (let i = 0; i < 100; i++) for (let step = 1; step <= 10; step++) {
    const safe = [0, 1, 2].filter(cell => instantSafe("tower", String(i), "client", "tower-rush", step, cell, options));
    assert.equal(safe.length, 2);
  }
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
    assert.equal(roll.multiplier, total === 7 ? 5.82 : 0);
    const fish = instantDraw("fishing", String(i), "client", "jackpot-fishing", "cast", .97);
    catches[fish.outcome[0]]++; fishingReturn += fish.multiplier;
  }
  assert(Math.abs(heads / n - .5) < .015);
  [15 / 36, 6 / 36, 15 / 36].forEach((chance, i) => assert(Math.abs(dice[i] / n - chance) < .015));
  [.5, .3, .15, .04, .01].forEach((chance, i) => assert(Math.abs(catches[i] / n - chance) < .015));
  assert(Math.abs(fishingReturn / n - .97) < .03);
});
