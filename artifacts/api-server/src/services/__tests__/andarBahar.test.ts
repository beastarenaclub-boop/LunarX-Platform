import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dealAndarBahar,
  settleAndarBaharBets,
  cardRank,
  cardIsBlack,
  RANGE_BOUNDS,
  type AndarBaharBetInput,
  type AndarBaharDeal,
} from "../andarBaharMath";
import { deriveDeckShuffle } from "../rtp";

const MAX = 130;

// Card builder: rank 0=A,1=2,...,12=K; suit 0=♠,1=♥,2=♦,3=♣.
const c = (rank: number, suit = 0) => suit * 13 + rank;

/** Build a full 52-card deck starting with the given prefix (no dupes). */
function deck(prefix: number[]): number[] {
  const used = new Set(prefix);
  const rest: number[] = [];
  for (let i = 0; i < 52; i++) if (!used.has(i)) rest.push(i);
  return [...prefix, ...rest];
}

// --- Dealing --------------------------------------------------------------

test("black joker starts dealing on andar; first matching card wins", () => {
  // Joker: 7♠ (black) → andar first. Cards: 2♥, 7♥ → andar gets 2♥,
  // bahar gets 7♥ which matches → bahar wins on card 2.
  const d = dealAndarBahar(deck([c(6, 0), c(1, 1), c(6, 1)]));
  assert.equal(d.firstSide, "andar");
  assert.deepEqual(d.andarCards, [c(1, 1)]);
  assert.deepEqual(d.baharCards, [c(6, 1)]);
  assert.equal(d.winner, "bahar");
  assert.equal(d.cardsDealt, 2);
});

test("red joker starts dealing on bahar", () => {
  // Joker: Q♥ (red) → bahar first; first card Q♦ matches immediately.
  const d = dealAndarBahar(deck([c(11, 1), c(11, 2)]));
  assert.equal(d.firstSide, "bahar");
  assert.equal(d.winner, "bahar");
  assert.equal(d.cardsDealt, 1);
  assert.deepEqual(d.baharCards, [c(11, 2)]);
  assert.deepEqual(d.andarCards, []);
});

test("first-card match on the starting side wins for andar", () => {
  // Joker: 3♣ (black) → andar first; first card 3♠ matches on andar.
  const d = dealAndarBahar(deck([c(2, 3), c(2, 0)]));
  assert.equal(d.firstSide, "andar");
  assert.equal(d.winner, "andar");
  assert.equal(d.cardsDealt, 1);
});

test("full-deck exhaustion edge case: match on the last possible card (49)", () => {
  // Joker A♠; all 48 non-ace cards first, aces last. The 49th dealt card is
  // the first remaining ace.
  const nonAces: number[] = [];
  for (let i = 0; i < 52; i++) if (i % 13 !== 0) nonAces.push(i);
  const aces = [c(0, 1), c(0, 2), c(0, 3)];
  const d = dealAndarBahar([c(0, 0), ...nonAces, ...aces]);
  assert.equal(d.cardsDealt, 49);
  assert.equal(d.andarCards.length + d.baharCards.length, 49);
  // 49th card (odd position) goes to the starting side (A♠ black → andar).
  assert.equal(d.winner, "andar");
});

test("a match always exists in a real shuffled deck", () => {
  for (let nonce = 0; nonce < 200; nonce++) {
    const { cards } = deriveDeckShuffle("s", "c", nonce, 1);
    const d = dealAndarBahar(cards);
    assert.ok(d.cardsDealt >= 1 && d.cardsDealt <= 49);
    assert.equal(cardRank(d.winner === "andar"
      ? d.andarCards[d.andarCards.length - 1]!
      : d.baharCards[d.baharCards.length - 1]!), cardRank(d.joker));
    // Alternation invariant: sides differ by at most one card.
    assert.ok(Math.abs(d.andarCards.length - d.baharCards.length) <= 1);
  }
});

test("deck derivation is deterministic and a valid 52-card permutation", () => {
  const a = deriveDeckShuffle("s", "c", 7, 1);
  const b = deriveDeckShuffle("s", "c", 7, 1);
  assert.deepEqual(a.cards, b.cards);
  assert.equal(a.cards.length, 52);
  assert.equal(new Set(a.cards).size, 52);
});

// --- Settlement -----------------------------------------------------------

function mkDeal(overrides: Partial<AndarBaharDeal>): AndarBaharDeal {
  return {
    joker: 0,
    andarCards: [1],
    baharCards: [],
    firstSide: "andar",
    winner: "andar",
    cardsDealt: 1,
    ...overrides,
  };
}

test("winning bet on the first (starting) side pays 0.9:1 → 1.9x", () => {
  const bets: AndarBaharBetInput[] = [{ type: "andar", amountPaise: 10000n }];
  const r = settleAndarBaharBets(
    bets,
    mkDeal({ firstSide: "andar", winner: "andar" }),
    MAX,
  );
  assert.equal(r.totalPayout, 19000n);
});

test("winning bet on the second side pays 1:1 → 2x", () => {
  const bets: AndarBaharBetInput[] = [{ type: "bahar", amountPaise: 10000n }];
  const r = settleAndarBaharBets(
    bets,
    mkDeal({ firstSide: "andar", winner: "bahar" }),
    MAX,
  );
  assert.equal(r.totalPayout, 20000n);
});

test("payout sides swap when bahar is the starting side", () => {
  const r = settleAndarBaharBets(
    [
      { type: "andar", amountPaise: 10000n },
      { type: "bahar", amountPaise: 10000n },
    ],
    mkDeal({ firstSide: "bahar", winner: "bahar" }),
    MAX,
  );
  // bahar is first side → 1.9x; andar loses.
  assert.equal(r.settled[0]!.payoutPaise, "0");
  assert.equal(r.settled[1]!.payoutPaise, "19000");
});

test("losing main bet pays 0; odd stakes floor exactly", () => {
  const r = settleAndarBaharBets(
    [{ type: "andar", amountPaise: 33n }],
    mkDeal({ firstSide: "andar", winner: "andar" }),
    MAX,
  );
  // 33 × 1.9 = 62.7 → 62
  assert.equal(r.totalPayout, 62n);
  const lose = settleAndarBaharBets(
    [{ type: "andar", amountPaise: 1000n }],
    mkDeal({ winner: "bahar", baharCards: [1], andarCards: [] }),
    MAX,
  );
  assert.equal(lose.totalPayout, 0n);
});

test("range side bets win exactly when cardsDealt is inside the range", () => {
  const expectedReturns: Record<string, bigint> = {
    range1_5: 350n,
    range6_10: 450n,
    range11_15: 550n,
    range16_25: 450n,
    range26_30: 1500n,
    range31_35: 2600n,
    range36_40: 5100n,
    range41_49: 12100n,
  };
  for (const [type, [lo, hi]] of Object.entries(RANGE_BOUNDS)) {
    for (const n of [lo, hi]) {
      const win = settleAndarBaharBets(
        [{ type: type as never, amountPaise: 100n }],
        mkDeal({ cardsDealt: n }),
        MAX,
      );
      assert.equal(
        win.totalPayout,
        (100n * expectedReturns[type]!) / 100n,
        `${type} at ${n}`,
      );
    }
    // Just outside the range loses.
    for (const n of [lo - 1, hi + 1]) {
      if (n < 1 || n > 49) continue;
      const lose = settleAndarBaharBets(
        [{ type: type as never, amountPaise: 100n }],
        mkDeal({ cardsDealt: n }),
        MAX,
      );
      assert.equal(lose.totalPayout, 0n, `${type} at ${n}`);
    }
  }
});

test("ranges partition 1..49 exactly (no gaps, no overlaps)", () => {
  for (let n = 1; n <= 49; n++) {
    const hits = Object.values(RANGE_BOUNDS).filter(
      ([lo, hi]) => n >= lo && n <= hi,
    );
    assert.equal(hits.length, 1, `position ${n}`);
  }
});

test("maxMultiplier caps payouts", () => {
  const r = settleAndarBaharBets(
    [{ type: "range41_49", amountPaise: 100n }],
    mkDeal({ cardsDealt: 45 }),
    5,
  );
  assert.equal(r.totalPayout, 500n);
});

test("invalid bets rejected", () => {
  assert.throws(
    () =>
      settleAndarBaharBets(
        [{ type: "andar", amountPaise: 0n }],
        mkDeal({}),
        MAX,
      ),
    /INVALID_ANDAR_BAHAR_BET/,
  );
  assert.throws(
    () =>
      settleAndarBaharBets(
        [{ type: "joker" as never, amountPaise: 100n }],
        mkDeal({}),
        MAX,
      ),
    /INVALID_ANDAR_BAHAR_BET/,
  );
});

test("empirical edges over 5000 seeded rounds (~2.15% first side, ~3% second)", () => {
  let firstRet = 0n;
  let secondRet = 0n;
  let firstWins = 0;
  const stake = 100n;
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const { cards } = deriveDeckShuffle("rtp-seed", "client", i, 1);
    const d = dealAndarBahar(cards);
    const first = d.firstSide;
    const second = first === "andar" ? "bahar" : "andar";
    const r = settleAndarBaharBets(
      [
        { type: first, amountPaise: stake },
        { type: second, amountPaise: stake },
      ],
      d,
      MAX,
    );
    firstRet += BigInt(r.settled[0]!.payoutPaise);
    secondRet += BigInt(r.settled[1]!.payoutPaise);
    if (d.winner === first) firstWins++;
  }
  const firstRtp = Number(firstRet) / Number(stake * BigInt(N));
  const secondRtp = Number(secondRet) / Number(stake * BigInt(N));
  // Theoretical: first side p≈0.515 × 1.9 ≈ 0.9785; second ≈ 0.485 × 2 = 0.97.
  assert.ok(firstRtp > 0.94 && firstRtp < 1.01, `firstRtp=${firstRtp}`);
  assert.ok(secondRtp > 0.93 && secondRtp < 1.01, `secondRtp=${secondRtp}`);
  const p = firstWins / N;
  assert.ok(p > 0.49 && p < 0.54, `first-side win rate=${p}`);
});
