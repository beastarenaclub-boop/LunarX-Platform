import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dealJoker,
  evaluateJokerHand,
  jokerPayout,
  jokerWinningSpots,
  JOKER_SPOTS,
  JOKER_RETURNS,
  normalizeJokerBets,
  validJokerOutcome,
  type JokerSpot,
} from "@workspace/api-zod/teenpatti-joker";

const c = (rank: number, suit = 0) => suit * 13 + rank - 1;
test("reference ranking puts Pure Sequence above Trail and orders ace sequences", () => {
  const score = (cards: number[]) => evaluateJokerHand(cards, c(7, 3)).score;
  const hands = [
    [c(1), c(13), c(12)],
    [c(1), c(1, 1), c(1, 2)],
    [c(1), c(13, 1), c(12, 2)],
    [c(1), c(13), c(11)],
    [c(1), c(1, 1), c(13)],
    [c(1), c(13, 1), c(11, 2)],
  ];
  for (let i = 1; i < hands.length; i++)
    assert.ok(score(hands[i - 1]) > score(hands[i]));
  const sequences = [
    [1, 13, 12],
    [1, 2, 3],
    [13, 12, 11],
    [4, 3, 2],
  ];
  for (let i = 1; i < sequences.length; i++)
    assert.ok(
      score(sequences[i - 1].map((r) => c(r))) >
        score(sequences[i].map((r) => c(r))),
    );
});
test("wildcards find the strongest missing rank and suit, including the reference color example", () => {
  const hand = evaluateJokerHand([c(4, 1), c(9, 3), c(1, 3)], c(4));
  assert.equal(hand.category, "Color");
  assert.deepEqual(hand.resolved, [c(13, 3), c(9, 3), c(1, 3)]);
  assert.deepEqual(hand.wildIndices, [0]);
  assert.ok(
    hand.score > evaluateJokerHand([c(1, 2), c(11, 2), c(12, 2)], c(4)).score,
  );
  assert.equal(
    evaluateJokerHand([c(7, 1), c(13, 2), c(12, 2)], c(7)).category,
    "Pure Sequence",
  );
  assert.equal(
    evaluateJokerHand([c(7, 1), c(9), c(9, 1)], c(7)).category,
    "Trail",
  );
});
test("two or three wildcards maximize independently without duplicate resolved cards", () => {
  for (const cards of [
    [c(7, 1), c(7, 2), c(1, 3)],
    [c(7, 1), c(7, 2), c(7, 3)],
  ]) {
    const hand = evaluateJokerHand(cards, c(7));
    assert.equal(hand.category, "Pure Sequence");
    assert.equal(new Set(hand.resolved).size, 3);
    assert.equal(
      hand.score,
      evaluateJokerHand([c(1), c(13), c(12)], c(7)).score,
    );
    assert.equal(
      hand.score,
      evaluateJokerHand([...cards].reverse(), c(7)).score,
    );
  }
});
test("all 52 joker cards settle parity, color and suit at exact integer returns", () => {
  for (let joker = 0; joker < 52; joker++) {
    const deck = [
      joker,
      ...Array.from({ length: 52 }, (_, i) => i).filter((c) => c !== joker),
    ];
    const outcome = dealJoker(deck);
    assert.ok(validJokerOutcome(outcome));
    for (const spot of JOKER_SPOTS) {
      const isMain = spot === "playerA" || spot === "playerB";
      const expected = isMain
        ? outcome.winner === "tie"
          ? 1001n
          : outcome.winner === spot
            ? 1981n
            : 0n
        : jokerWinningSpots(outcome).includes(spot)
          ? (1001n * BigInt(JOKER_RETURNS[spot])) / 100n
          : 0n;
      assert.equal(
        jokerPayout([{ spot, amountPaise: "1001" }], outcome),
        expected,
        `${joker}/${spot}`,
      );
    }
    assert.equal(
      jokerWinningSpots(outcome).filter((s) => s === "odd" || s === "even")
        .length,
      1,
    );
    assert.equal(
      jokerWinningSpots(outcome).includes("odd"),
      ((joker % 13) + 1) % 2 === 1,
    );
  }
});
test("exact rank ties refund both main bets while independently settling side bets", () => {
  const outcome = dealJoker([
    c(7, 3),
    c(1),
    c(1, 1),
    c(13),
    c(13, 1),
    c(12),
    c(12, 1),
  ]);
  assert.equal(outcome.winner, "tie");
  assert.equal(
    jokerPayout(
      [
        { spot: "playerA", amountPaise: "1001" },
        { spot: "playerB", amountPaise: "2001" },
        { spot: "clubs", amountPaise: "1001" },
      ],
      outcome,
    ),
    6755n,
  );
});
test("invalid cards, forged outcomes, duplicate markets and non-integer stakes fail closed", () => {
  const o = dealJoker([0, 1, 2, 3, 4, 5, 6]);
  const reordered = JSON.parse(JSON.stringify(o), (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse())
      : value,
  );
  assert.ok(
    validJokerOutcome(reordered),
    "jsonb property order must not prevent settlement",
  );
  assert.equal(
    validJokerOutcome({
      ...o,
      winner: o.winner === "playerA" ? "playerB" : "playerA",
    }),
    false,
  );
  assert.equal(
    validJokerOutcome({ ...o, handA: { ...o.handA, score: 999999 } }),
    false,
  );
  assert.throws(() => dealJoker([0, 1, 2, 3, 4, 5, 5]));
  assert.throws(() => dealJoker([0, 1, 2, 3, 4, 5, 52]));
  assert.throws(() => evaluateJokerHand([0, 1, 2], 0));
  assert.throws(() => jokerPayout([{ spot: "odd", amountPaise: "1" }], o, 999));
  for (const amountPaise of ["0", "-1", "1.2", "01", "1e3", "9999999999999999"])
    assert.throws(() => normalizeJokerBets([{ spot: "even", amountPaise }]));
  assert.throws(() =>
    normalizeJokerBets([{ spot: "tie" as JokerSpot, amountPaise: "100" }]),
  );
  assert.throws(() =>
    normalizeJokerBets([
      { spot: "even", amountPaise: "100" },
      { spot: "even", amountPaise: "200" },
    ]),
  );
  assert.throws(() => normalizeJokerBets([]));
  assert.deepEqual(
    normalizeJokerBets([
      { spot: "clubs", amountPaise: "100" },
      { spot: "playerA", amountPaise: "200" },
    ]).map((b) => b.spot),
    ["playerA", "clubs"],
  );
});
