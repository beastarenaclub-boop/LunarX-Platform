import { test } from "node:test";
import assert from "node:assert/strict";
import { rouletteBetCoverage, settleRouletteBets, validateRouletteStakes, type RouletteBetInput } from "../rouletteMath";
import { ROULETTE_HOUSE_EDGE, ROULETTE_LIMITS, rouletteSelectionKey } from "@workspace/api-zod/roulette-game";

const straight = (amountPaise: bigint, n = 17): RouletteBetInput => ({ type: "straight", numbers: [n], amountPaise });
test("single numbers, including zero, accept inclusive Rs10 and Rs20,000 boundaries", () => {
  for (let n = 0; n <= 36; n++) {
    validateRouletteStakes([straight(1000n, n)]);
    validateRouletteStakes([straight(2000000n, n)]);
    assert.throws(() => validateRouletteStakes([straight(999n, n)]), /ROULETTE_BET_TOO_SMALL/);
    assert.throws(() => validateRouletteStakes([straight(2000001n, n)]), /ROULETTE_STRAIGHT_LIMIT/);
  }
});
const otherSpots: Omit<RouletteBetInput, "amountPaise">[] = [
  { type: "split", numbers: [1, 2] }, { type: "street", numbers: [1, 2, 3] },
  { type: "corner", numbers: [1, 2, 4, 5] }, { type: "line", numbers: [1, 2, 3, 4, 5, 6] },
  { type: "dozen", selection: 1 }, { type: "column", selection: 2 },
  ...["red", "black", "odd", "even", "high", "low"].map(type => ({ type } as Omit<RouletteBetInput, "amountPaise">)),
];
test("all multi-number/outside bets accept Rs10 to Rs1 lakh only", () => {
  for (const spot of otherSpots) {
    validateRouletteStakes([{ ...spot, amountPaise: 1000n }]);
    validateRouletteStakes([{ ...spot, amountPaise: 10000000n }]);
    assert.throws(() => validateRouletteStakes([{ ...spot, amountPaise: 999n }]), /ROULETTE_BET_TOO_SMALL/);
    assert.throws(() => validateRouletteStakes([{ ...spot, amountPaise: 10000001n }]), /ROULETTE_OTHER_LIMIT/);
  }
});
test("duplicates, reordered numbers and earlier slips cannot bypass per-round limits", () => {
  assert.throws(() => validateRouletteStakes([straight(1000000n), straight(1001000n)]), /ROULETTE_STRAIGHT_LIMIT/);
  assert.throws(() => validateRouletteStakes([straight(1000n)], [straight(2000000n)]), /ROULETTE_STRAIGHT_LIMIT/);
  assert.throws(() => validateRouletteStakes([{ type: "split", numbers: [2, 1], amountPaise: 1000n }], [{ type: "split", numbers: [1, 2], amountPaise: 10000000n }]), /ROULETTE_OTHER_LIMIT/);
  assert.throws(() => validateRouletteStakes([{ type: "red", numbers: [7], amountPaise: 1000n }], [{ type: "red", amountPaise: 10000000n }]), /ROULETTE_OTHER_LIMIT/);
  validateRouletteStakes([straight(2000000n, 18)], [straight(2000000n, 17)]);
  assert.equal(rouletteSelectionKey({ type: "column", selection: 1, numbers: [7] }), "column:1");
  assert.equal(ROULETTE_LIMITS.maxBetsPerSlip, 40);
});
test("36-base payouts are exact, stake-inclusive and give a 1/37 expected house edge", () => {
  assert.equal(settleRouletteBets([straight(100n)], 17, 36).totalPayout, 3600n);
  assert.equal(settleRouletteBets([straight(2000000n)], 17, 36).totalPayout, 72000000n);
  for (const spot of [{ type: "straight", numbers: [17] } as Omit<RouletteBetInput, "amountPaise">, ...otherSpots]) {
    const bet = { ...spot, amountPaise: 10000000n };
    const coverage = rouletteBetCoverage(bet);
    const sum = Array.from({ length: 37 }, (_, pocket) => settleRouletteBets([bet], pocket, 36).totalPayout).reduce((a, b) => a + b, 0n);
    assert.equal(sum, bet.amountPaise * 36n);
    assert.equal(settleRouletteBets([bet], coverage[0], 36).totalPayout, bet.amountPaise * BigInt(36 / coverage.length));
  }
  assert.equal(ROULETTE_HOUSE_EDGE, 1 / 37);
  assert.equal(settleRouletteBets([{ type: "red", amountPaise: 1000n }], 0, 36).totalPayout, 0n);
});
test("historical 35 and 31.45 bases remain replayable", () => {
  assert.equal(settleRouletteBets([straight(10000n)], 17, 35, 35).totalPayout, 350000n);
  assert.equal(settleRouletteBets([straight(10000n)], 17, 35, 31.45).totalPayout, 314500n);
});
