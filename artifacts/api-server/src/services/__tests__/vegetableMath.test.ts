import { strict as assert } from "node:assert";
import { test } from "node:test";
import { deriveVegetableOutcome, settleVegetableBets } from "../vegetableMath";
import {
  VEGETABLE_KINDS,
  VEGETABLE_JUNK_KINDS,
  VEGETABLE_JUNK_CHANCE,
  VEGETABLE_LEGACY_RTP,
  VEGETABLE_MODES,
  VEGETABLE_RTP,
  VEGETABLE_TICKETS,
  vegetableWinner,
} from "@workspace/api-zod/vegetable-game";

test("₹1 pays exactly ₹1.98 on Normal/Hard and ₹20 on Risk; losing options pay zero", () => {
  const bets = [
    { type: "normal" as const, amountPaise: 100n },
    { type: "hard" as const, amountPaise: 100n },
    { type: "risk" as const, amountPaise: 100n },
  ];
  for (let count = 1; count <= 12; count++) {
    const result = settleVegetableBets(bets, count);
    assert.equal(result.totalStake, 300n);
    assert.equal(result.totalPayout, count === 7 ? 2000n : 198n);
    assert.equal(result.settled.filter((b) => b.didWin).length, 1);
    assert.equal(
      result.settled.find((b) => b.didWin)!.type,
      count < 7 ? "normal" : count > 7 ? "hard" : "risk",
    );
    assert.ok(
      result.settled
        .filter((b) => !b.didWin)
        .every((b) => b.payoutPaise === "0"),
    );
  }
});
test("fractional rupee stakes round only the fractional paise and keep bigints exact", () => {
  assert.equal(
    settleVegetableBets([{ type: "normal", amountPaise: 101n }], 6).totalPayout,
    199n,
  );
  assert.equal(
    settleVegetableBets([{ type: "risk", amountPaise: 999999999999n }], 7)
      .totalPayout,
    19999999999980n,
  );
});
test("invalid, empty, duplicate and sub-rupee bets are rejected before settlement", () => {
  assert.throws(() => settleVegetableBets([], 7), /NO_BETS/);
  assert.throws(
    () => settleVegetableBets([{ type: "normal", amountPaise: 99n }], 4),
    /STAKE_TOO_SMALL/,
  );
  assert.throws(
    () => settleVegetableBets([{ type: "risk", amountPaise: -100n }], 7),
    /STAKE_TOO_SMALL/,
  );
  assert.throws(
    () =>
      settleVegetableBets(
        [
          { type: "normal", amountPaise: 100n },
          { type: "normal", amountPaise: 100n },
        ],
        4,
      ),
    /DUPLICATE/,
  );
  assert.throws(
    () =>
      settleVegetableBets(
        [{ type: "__proto__" as "normal", amountPaise: 100n }],
        4,
      ),
    /INVALID/,
  );
  for (const count of [-1, 13, 1.5, NaN, Infinity])
    assert.throws(() => vegetableWinner(count), /INVALID/);
});
test("seed replay is deterministic and every visual count agrees with the winning option", () => {
  const counts = { normal: 0, hard: 0, risk: 0, junk: 0 };
  const totals = new Set<number>();
  for (let nonce = 0; nonce < 10000; nonce++) {
    const outcome = deriveVegetableOutcome(
      "test-server-seed",
      "shared-harvest",
      nonce,
    );
    assert.equal(outcome.vegetables.length, outcome.total);
    assert.equal(outcome.winner, vegetableWinner(outcome.total));
    assert.ok(outcome.vegetables.every((v) => VEGETABLE_KINDS.includes(v)));
    if (outcome.winner === "junk") {
      assert.equal(outcome.total, 0);
      assert.ok(outcome.junk!.length >= 4 && outcome.junk!.length <= 6);
      assert.ok(outcome.junk!.every((kind) => VEGETABLE_JUNK_KINDS.includes(kind)));
      assert.deepEqual(outcome, deriveVegetableOutcome("test-server-seed", "shared-harvest", nonce));
    } else {
      assert.equal(outcome.junk, undefined);
    }
    counts[outcome.winner]++;
    totals.add(outcome.total);
  }
  assert.equal(totals.size, 13);
  assert.ok(counts.normal > 4200 && counts.normal < 4850);
  assert.ok(counts.hard > 4200 && counts.hard < 4850);
  assert.ok(counts.risk > 350 && counts.risk < 600);
  assert.ok(counts.junk > 400 && counts.junk < 600);
  const first = deriveVegetableOutcome(
    "test-server-seed",
    "shared-harvest",
    123,
  );
  assert.deepEqual(
    first,
    deriveVegetableOutcome("test-server-seed", "shared-harvest", 123),
  );
  assert.notDeepEqual(
    first,
    deriveVegetableOutcome("different-seed", "shared-harvest", 123),
  );
});

test("zero vegetables loses every option, including a slip covering all three", () => {
  const bets = VEGETABLE_MODES.map(({ id }) => ({ type: id, amountPaise: 12345n }));
  for (const slip of [...bets.map((bet) => [bet]), bets]) {
    const result = settleVegetableBets(slip, 0);
    assert.equal(result.totalStake, BigInt(slip.length) * 12345n);
    assert.equal(result.totalPayout, 0n);
    assert.ok(result.settled.every((bet) => !bet.didWin && bet.payoutPaise === "0"));
  }
});

test("published chances sum to one and include junk losses in each option's RTP", () => {
  const chances = VEGETABLE_MODES.map((mode) => mode.tickets / VEGETABLE_TICKETS * (1 - VEGETABLE_JUNK_CHANCE));
  assert.equal(VEGETABLE_JUNK_CHANCE, 0.05);
  assert.ok(Math.abs(chances.reduce((sum, chance) => sum + chance, VEGETABLE_JUNK_CHANCE) - 1) < 1e-12);
  VEGETABLE_MODES.forEach((mode, index) => {
    assert.ok(chances[index] * mode.multiplier <= VEGETABLE_RTP);
    assert.ok(chances[index] * mode.multiplier > .84);
  });
  assert.equal(VEGETABLE_RTP, .85);
});

test("legacy committed rounds retain v1 replay and never become junk rounds", () => {
  assert.deepEqual(deriveVegetableOutcome("test-server-seed", "shared-harvest", 123, 1), {
    total: 10,
    winner: "hard",
    vegetables: ["broccoli", "broccoli", "broccoli", "pepper", "broccoli", "aubergine", "broccoli", "tomato", "broccoli", "carrot"],
  });
  for (let nonce = 0; nonce < 1000; nonce++) {
    const outcome = deriveVegetableOutcome("test-server-seed", "shared-harvest", nonce, 1);
    assert.ok(outcome.total >= 1 && outcome.total <= 12);
    assert.equal(outcome.junk, undefined);
  }
});
