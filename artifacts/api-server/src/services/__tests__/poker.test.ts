import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluate,
  outcome,
  twoCardProfit,
  quotesFor,
  sixPlayerOdds,
  lockSelections,
  payout,
  draw,
  publicRound,
  commitment,
} from "../pokerMath";
import { POKER_GAMES, POKER_CONFIG } from "@workspace/api-zod/poker";
const c = (text: string) => {
  const suit = "shdc".indexOf(text.at(-1)!);
  const rank = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ].indexOf(text.slice(0, -1));
  assert.ok(suit >= 0 && rank >= 0);
  return suit * 13 + rank;
};
const hand = (text: string) => text.split(" ").map(c);
const examples = [
  "As Kd 9h 7c 5s 3d 2h",
  "As Ad Kh 9c 7s 5d 3h",
  "As Ad Kh Kc 7s 5d 3h",
  "As Ad Ah Kc 7s 5d 3h",
  "As 2d 3h 4c 5s 9d Kh",
  "As Js 9s 7s 5s 3d Kh",
  "As Ad Ah Kc Ks 5d 3h",
  "As Ad Ah Ac Ks 5d 3h",
  "9s 8s 7s 6s 5s Ad Kh",
  "As Ks Qs Js 10s 3d 2h",
];
test("all ten categories rank correctly", () => {
  let previous = -1;
  examples.forEach((cards, category) => {
    const result = evaluate(hand(cards));
    assert.equal(result.category, category);
    assert.ok(result.score > previous);
    previous = result.score;
  });
});
test("wheel, kickers, two trips, three pairs and board-only ties", () => {
  assert.ok(
    evaluate(hand("2s 3d 4h 5c 6s Ah Kd")).score >
      evaluate(hand(examples[4])).score,
  );
  assert.equal(
    evaluate(hand("As Ah Ad Ks Kh Kd 2c")).score,
    evaluate(hand("As Ah Ad Ks Kh")).score,
  );
  assert.equal(
    evaluate(hand("As Ah Ks Kh Qs Qh Jc")).score,
    evaluate(hand("As Ah Ks Kh Qs")).score,
  );
  assert.ok(
    evaluate(hand("As Ah Ks 9d 6c 4s 2h")).score >
      evaluate(hand("Ad Ac Qh 9s 6h 4c 2s")).score,
  );
  assert.ok(
    evaluate(hand("As Js 9s 7s 5s 3d Kh")).score >
      evaluate(hand("Ah Jh 9h 7h 4h 3c Kd")).score,
  );
  assert.deepEqual(
    outcome([hand("2d 3d"), hand("4h 5h")], hand("As Ks Qs Js 10s")).winners,
    [0, 1],
  );
  assert.throws(() => evaluate(hand("As As Ks Qs Js")));
});
test("each screenshot two-card bonus including suit distinctions", () => {
  for (const [cards, profit] of [
    ["2s 2h", 3],
    ["10s 10h", 3],
    ["Js Jh", 10],
    ["Qs Qh", 10],
    ["Ks Kh", 10],
    ["As Ah", 30],
    ["As Qh", 5],
    ["As Jh", 5],
    ["As Kh", 15],
    ["As Qs", 20],
    ["As Js", 20],
    ["As Ks", 25],
    ["As 10s", 0],
    ["Ks Qs", 0],
  ] as const)
    assert.equal(twoCardProfit(hand(cards)), profit, cards);
});
test("one-day back/lay reserves liability and settles profit plus reserved funds", () => {
  const hands = [hand("As Ah"), hand("Kd Qd")],
    board = hand("2s 4h 6c 8d 10h");
  const quotes = quotesFor("poker-one-day", hands);
  const bet = (market: string) =>
    lockSelections([{ market, amountPaise: "10000" }], quotes);
  assert.equal(bet("p0-lay").debit, 10200n);
  assert.equal(payout(bet("p0-back").selections, hands, board), 19800n);
  assert.equal(payout(bet("p1-back").selections, hands, board), 0n);
  assert.equal(payout(bet("p0-lay").selections, hands, board), 0n);
  assert.equal(payout(bet("p1-lay").selections, hands, board), 20200n);
  assert.equal(payout(bet("p0-bonus2").selections, hands, board), 310000n);
  const tieBoard = hand("2s 3s 4s 5s 6s");
  assert.equal(payout(bet("p0-back").selections, hands, tieBoard), 10000n);
  assert.equal(payout(bet("p0-lay").selections, hands, tieBoard), 10200n);
});
test("seven-card bonuses use the best category and total returns", () => {
  const profit: Record<number, number> = {
    3: 3,
    4: 4,
    5: 6,
    6: 8,
    7: 30,
    8: 50,
    9: 100,
  };
  examples.forEach((text, category) => {
    const cards = hand(text),
      opponent = Array.from({ length: 52 }, (_, i) => i)
        .filter((c) => !cards.includes(c))
        .slice(0, 2);
    const hands = [cards.slice(0, 2), opponent],
      board = cards.slice(2);
    const bet = lockSelections(
      [{ market: "p0-bonus7", amountPaise: "1000" }],
      quotesFor("poker-one-day", hands),
    );
    assert.equal(
      payout(bet.selections, hands, board),
      profit[category] ? BigInt(1000 * (profit[category] + 1)) : 0n,
    );
  });
});
test("20-20 category bets are exact; royal flush qualifies for straight flush", () => {
  const hands = [hand("As Ks"), hand("2h 3h")],
    board = hand("Qs Js 10s 5c 6c"),
    quotes = quotesFor("poker-20-20", hands);
  const bet = (market: string) =>
    lockSelections([{ market, amountPaise: "1000" }], quotes).selections;
  assert.equal(
    payout(bet("p0-hand8"), hands, board),
    BigInt(10 * POKER_CONFIG.categoryOdds[8]),
  );
  assert.equal(payout(bet("p0-hand5"), hands, board), 0n);
  assert.equal(quotes.length, 18);
});
test("six-player tied winners split total returns", () => {
  const hands = [
    hand("2h 3h"),
    hand("4h 5h"),
    hand("6h 7h"),
    hand("8h 9h"),
    hand("10h Jh"),
    hand("Qh Kh"),
  ];
  const selections = [
    {
      market: "p0-back",
      amountPaise: "10001",
      debitPaise: "10001",
      quote: {
        id: "p0-back",
        player: 0,
        kind: "back" as const,
        odds: 600,
        label: "Player 1",
      },
    },
  ];
  assert.equal(payout(selections, hands, hand("As Ks Qs Js 10s")), 10001n);
});
test("bet limits include lay liability, accumulated bets, duplicates and malformed stakes", () => {
  const quotes = quotesFor("poker-one-day", [hand("As Ah"), hand("Ks Kh")]);
  for (const amountPaise of [
    "0",
    "-1000",
    "1.0",
    "100.5",
    "NaN",
    "999",
    "500001",
  ])
    assert.throws(() =>
      lockSelections([{ market: "p0-back", amountPaise }], quotes),
    );
  assert.throws(() =>
    lockSelections([{ market: "p0-lay", amountPaise: "500000" }], quotes),
  );
  assert.throws(() =>
    lockSelections(
      [{ market: "p0-back", amountPaise: "1000" }],
      quotes,
      500000n,
    ),
  );
  assert.throws(() =>
    lockSelections([{ market: "unknown", amountPaise: "1000" }], quotes),
  );
  assert.throws(() =>
    lockSelections(
      Array(2).fill({ market: "p0-back", amountPaise: "1000" }),
      quotes,
    ),
  );
});
test("deck has unique cards; commitments verify and hidden cards never leak", () => {
  for (const game of POKER_GAMES) {
    const cards = draw(game),
      r = {
        ...cards,
        id: 1,
        game,
        closesAt: new Date(1000),
        revealsAt: new Date(12000),
        endsAt: new Date(19000),
      };
    assert.equal(
      new Set([...cards.hands.flat(), ...cards.board]).size,
      game === "poker-six-players" ? 17 : 9,
    );
    assert.equal(
      cards.commitment,
      commitment(game, cards.hands, cards.board, cards.nonce),
    );
    assert.notEqual(
      cards.commitment,
      commitment(game, cards.hands, cards.board, "wrong"),
    );
    const hidden = publicRound(r, 999);
    assert.deepEqual(hidden.board, [null, null, null, null, null]);
    assert.equal(
      hidden.hands.flat().filter((c) => c !== null).length,
      game === "poker-six-players" ? 12 : 0,
    );
    assert.equal(hidden.nonce, undefined);
    assert.equal(hidden.outcome, undefined);
    assert.equal(publicRound(r, 1000).phase, "deal");
    assert.equal(
      publicRound(r, 3000).board.filter((c) => c !== null).length,
      3,
    );
    assert.equal(
      publicRound(r, 6000).board.filter((c) => c !== null).length,
      4,
    );
    assert.equal(
      publicRound(r, 9000).board.filter((c) => c !== null).length,
      5,
    );
    assert.equal(publicRound(r, 12000).nonce, cards.nonce);
  }
});
test("six-player odds are deterministic and depend only on public hands", () => {
  const hands = [
    hand("5h 4d"),
    hand("As Ac"),
    hand("Jd 7s"),
    hand("6c 7h"),
    hand("2c 8h"),
    hand("Qh 2h"),
  ];
  const odds = sixPlayerOdds(hands);
  assert.deepEqual(odds, sixPlayerOdds(hands));
  assert.equal(Math.min(...odds), odds[1]);
  assert.ok(odds.every((value) => Number.isInteger(value) && value > 100));
});
