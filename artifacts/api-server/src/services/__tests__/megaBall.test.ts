import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveMegaBallOutcome,
  megaBallCards,
  settleMegaBallCards,
  validateMegaBallCards,
} from "../megaBallMath";
import {
  megaBallCardResult,
  megaBallLines,
  type MegaBallOutcome,
} from "@workspace/api-zod/mega-ball";

test("Mega Ball: deterministic draws have 21 unique balls, valid range and multipliers", () => {
  for (let nonce = 0; nonce < 500; nonce++) {
    const draw = deriveMegaBallOutcome("server-seed", "client", nonce);
    assert.deepEqual(
      draw,
      deriveMegaBallOutcome("server-seed", "client", nonce),
    );
    assert.equal(draw.balls.length, 20);
    assert.equal(new Set([...draw.balls, draw.megaBall]).size, 21);
    assert.ok([...draw.balls, draw.megaBall].every((n) => n >= 1 && n <= 51));
    assert.ok([5, 10, 15, 20, 25, 50, 100].includes(draw.multiplier));
  }
  assert.notDeepEqual(
    deriveMegaBallOutcome("a", "c", 1),
    deriveMegaBallOutcome("b", "c", 1),
  );
});
test("100 cards survive reconnect unchanged and enforce valid columns and integer stakes", () => {
  const cards = megaBallCards("commitment", "alice", 100, "100");
  assert.deepEqual(cards, megaBallCards("commitment", "alice", 100, "100"));
  assert.notDeepEqual(
    cards[0].numbers,
    megaBallCards("commitment", "bob", 1, "100")[0].numbers,
  );
  assert.equal(validateMegaBallCards(cards).totalStake, 10000n);
  assert.throws(() => validateMegaBallCards([...cards, cards[0]]));
  assert.throws(() =>
    validateMegaBallCards([{ ...cards[0], amountPaise: "1.5" }]),
  );
  assert.throws(() =>
    validateMegaBallCards([{ ...cards[0], numbers: Array(25).fill(1) }]),
  );
  assert.throws(() =>
    validateMegaBallCards([{ ...cards[0], type: "card-101" }]),
  );
});
test("row, column and diagonal lines settle exactly; only a newly completed Mega line boosts", () => {
  const card = megaBallCards("seed", "alice", 1, "125")[0];
  const row = card.numbers.slice(0, 5);
  const column = [0, 5, 10, 15, 20].map((i) => card.numbers[i]);
  assert.equal(megaBallLines(card.numbers, row).length, 1);
  assert.equal(megaBallLines(card.numbers, column).length, 1);
  assert.equal(
    megaBallLines(
      card.numbers,
      [0, 6, 12, 18, 24].map((i) => card.numbers[i]),
    ).length,
    1,
  );
  const unrelated = Array.from({ length: 51 }, (_, i) => i + 1).filter(
    (n) => !card.numbers.includes(n),
  );
  const base: MegaBallOutcome = {
    version: 1,
    balls: [...row, ...unrelated.slice(0, 15)],
    megaBall: unrelated[15],
    multiplier: 100,
  };
  assert.equal(megaBallCardResult(card.numbers, base).multiplier, 1);
  assert.equal(settleMegaBallCards([card], base).totalPayout, 125n);
  const mega: MegaBallOutcome = {
    ...base,
    balls: [...row.slice(0, 4), ...unrelated.slice(0, 16)],
    megaBall: row[4],
    multiplier: 10,
  };
  assert.deepEqual(megaBallCardResult(card.numbers, mega), {
    lines: 1,
    boosted: true,
    multiplier: 10,
  });
  assert.equal(settleMegaBallCards([card], mega).totalPayout, 1250n);
  assert.equal(
    settleMegaBallCards([card], {
      ...base,
      balls: unrelated.slice(0, 20),
      megaBall: unrelated[20],
    }).totalPayout,
    0n,
  );
});
