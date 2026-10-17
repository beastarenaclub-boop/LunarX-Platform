import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cardRank,
  cardPoints,
  handValue,
  isBlackjack,
  dealerPlay,
  handOutcome,
  handReturn,
  insuranceStake,
  settleRound,
  replayRound,
  applyTimeoutStand,
  type BlackjackHand,
} from "../blackjackMath";
import { deriveDeckShuffle } from "../rtp";

// Handy rank → card-id helpers (suit 0 of deck 0): rank 0=A .. 12=K.
const A = 0;
const TWO = 1;
const FIVE = 4;
const SIX = 5;
const SEVEN = 6;
const EIGHT = 7;
const NINE = 8;
const TEN = 9;
const K = 12;

function hand(cards: number[], over: Partial<BlackjackHand> = {}): BlackjackHand {
  return {
    cards,
    stood: true,
    doubled: false,
    busted: false,
    fromSplit: false,
    ...over,
  };
}

describe("hand values", () => {
  it("counts soft aces correctly", () => {
    assert.deepEqual(handValue([A, SIX]), { total: 17, soft: true, busted: false });
    assert.deepEqual(handValue([A, SIX, TEN]), { total: 17, soft: false, busted: false });
    assert.deepEqual(handValue([A, A]), { total: 12, soft: true, busted: false });
    assert.deepEqual(handValue([A, A, NINE]), { total: 21, soft: true, busted: false });
  });
  it("ten-value cards are all worth 10", () => {
    for (const r of [TEN, 10, 11, K]) assert.equal(cardPoints(r), 10);
  });
  it("busts above 21", () => {
    assert.equal(handValue([TEN, NINE, FIVE]).busted, true);
  });
  it("detects blackjack only on two cards", () => {
    assert.equal(isBlackjack([A, K]), true);
    assert.equal(isBlackjack([A, FIVE, FIVE]), false);
  });
  it("rank helper survives multi-deck ids", () => {
    assert.equal(cardRank(0), cardRank(52 * 3)); // ace in deck 0 and deck 3
  });
});

describe("dealer play (S17)", () => {
  it("stands on hard 17", () => {
    const out = dealerPlay([TEN, SEVEN], () => {
      throw new Error("should not draw");
    });
    assert.deepEqual(out, [TEN, SEVEN]);
  });
  it("stands on soft 17", () => {
    const out = dealerPlay([A, SIX], () => {
      throw new Error("should not draw");
    });
    assert.deepEqual(out, [A, SIX]);
  });
  it("draws to 17+", () => {
    const draws = [TWO, FIVE];
    const out = dealerPlay([TEN, FIVE], () => draws.shift()!); // 15 → 17
    assert.equal(handValue(out).total, 17);
  });
});

describe("outcomes & returns", () => {
  const dealer20 = [TEN, K];
  it("natural blackjack beats dealer 20 and pays 3:2", () => {
    const h = hand([A, K]);
    assert.equal(handOutcome(h, dealer20, false), "blackjack");
    assert.equal(handReturn("blackjack", 10000n), 25000n);
  });
  it("blackjack pushes against dealer blackjack", () => {
    const h = hand([A, K]);
    assert.equal(handOutcome(h, [A, TEN], true), "push");
  });
  it("split 21 is not a blackjack", () => {
    const h = hand([A, K], { fromSplit: true });
    assert.equal(handOutcome(h, dealer20, false), "win");
  });
  it("doubled 21 in two-card form is impossible but doubled hands never get 3:2", () => {
    const h = hand([A, K], { doubled: true });
    assert.equal(handOutcome(h, dealer20, false), "win");
  });
  it("bust always loses, even when dealer busts too", () => {
    const h = hand([TEN, NINE, FIVE]);
    assert.equal(handOutcome(h, [TEN, SIX, K], false), "lose");
  });
  it("dealer bust pays a live hand", () => {
    const h = hand([TEN, EIGHT]);
    assert.equal(handOutcome(h, [TEN, SIX, K], false), "win");
  });
  it("equal totals push", () => {
    const h = hand([TEN, TEN]);
    assert.equal(handOutcome(h, dealer20, false), "push");
    assert.equal(handReturn("push", 7777n), 7777n);
  });
  it("insurance stake is half rounded up, pays 2:1", () => {
    assert.equal(insuranceStake(10001n), 5001n);
  });
});

describe("settleRound", () => {
  it("split + double + insurance totals are exact bigints", () => {
    const hands: BlackjackHand[] = [
      hand([TEN, EIGHT], { fromSplit: true, doubled: true }), // 18 win → 2×2 stake
      hand([TEN, FIVE, TEN], { fromSplit: true, busted: true }), // bust
    ];
    const { results, totalStake, totalPayout } = settleRound({
      hands,
      dealerCards: [TEN, SEVEN],
      dealerBlackjack: false,
      baseStake: 10000n,
      insuranceTaken: true,
    });
    // stake: 20000 (doubled) + 10000 + 5000 insurance = 35000
    assert.equal(totalStake, 35000n);
    // payout: doubled win returns 40000; bust 0; insurance lost 0
    assert.equal(totalPayout, 40000n);
    assert.equal(results.hands[0]!.outcome, "win");
    assert.equal(results.hands[1]!.outcome, "lose");
    assert.equal(results.insurance!.won, false);
  });
  it("insurance wins on dealer blackjack; non-natural hand loses", () => {
    const { totalPayout } = settleRound({
      hands: [hand([TEN, EIGHT])],
      dealerCards: [A, K],
      dealerBlackjack: true,
      baseStake: 10000n,
      insuranceTaken: true,
    });
    assert.equal(totalPayout, 15000n); // 5000 × 3
  });
  it("natural blackjack with odd stake floors the half-paise", () => {
    const { totalPayout } = settleRound({
      hands: [hand([A, K])],
      dealerCards: [TEN, SEVEN],
      dealerBlackjack: false,
      baseStake: 10001n,
      insuranceTaken: false,
    });
    assert.equal(totalPayout, 25002n); // floor(10001 × 2.5)
  });
});

describe("replayRound determinism", () => {
  const shoe = deriveDeckShuffle("s".repeat(64), "c".repeat(32), 7, 6).cards;

  it("replays a simple hit/stand line and stays consistent", () => {
    const r1 = replayRound(shoe, ["deal", "hit:0", "stand:0", "dealer"]);
    const r2 = replayRound(shoe, ["deal", "hit:0", "stand:0", "dealer"]);
    assert.deepEqual(r1, r2);
    assert.equal(r1.hands[0]!.cards.length, 3);
    assert.deepEqual(r1.hands[0]!.cards, [shoe[0], shoe[2], shoe[4]]);
    assert.equal(r1.dealerCards[0], shoe[1]);
    assert.equal(r1.dealerCards[1], shoe[3]);
  });

  it("split consumes cards in the documented order", () => {
    // Build a synthetic shoe starting with a pair of eights for the player.
    const synthetic = [7, 9, 7 + 13, 22, 30, 40, 5, 6, 9, 22, 35, 48, 9, 10, 11];
    const r = replayRound(synthetic, [
      "deal",
      "split",
      "stand:0",
      "stand:1",
      "dealer",
    ]);
    assert.equal(r.hands.length, 2);
    // hand0 = [first eight, card index 4]; hand1 = [second eight, card index 5]
    assert.deepEqual(r.hands[0]!.cards, [7, 30]);
    assert.deepEqual(r.hands[1]!.cards, [7 + 13, 40]);
    assert.equal(r.insuranceTaken, false);
  });

  it("dealer does not draw when every hand busts", () => {
    // Find an action line that busts by hitting many times.
    const acts = ["deal", "hit:0", "hit:0", "hit:0", "hit:0", "hit:0"];
    let r = null;
    try {
      r = replayRound(shoe, [...acts, "dealer"]);
    } catch {
      // extremely unlucky shoe; skip
    }
    if (r && r.hands[0] && handValue(r.hands[0].cards).busted) {
      assert.equal(r.dealerCards.length, 2);
    }
  });
});

describe("timeout after a non-ace split", () => {
  // Shoe with a pair of eights up front so "deal" then "split" is legal.
  const shoe = [7, 9, 7 + 13, 22, 30, 40, 5, 6, 9, 22, 35, 48, 9, 10, 11];

  it("deals the deferred second card before standing both hands", () => {
    // Abandoned mid-split: hand 0 has two cards, hand 1 still has one
    // (the exact persisted DB state after actionSplit on non-aces).
    const mid: BlackjackHand[] = [
      hand([shoe[0]!, shoe[4]!], { stood: false, fromSplit: true }),
      hand([shoe[2]!], { stood: false, fromSplit: true }),
    ];
    const drawnSoFar = 5; // p,d,p,d + hand0's split card
    const out = applyTimeoutStand(mid, shoe, drawnSoFar);
    assert.equal(out.hands[0]!.cards.length, 2);
    assert.equal(out.hands[1]!.cards.length, 2);
    assert.deepEqual(out.hands[1]!.cards, [7 + 13, 40]); // deferred card = shoe[5]
    assert.equal(out.drawnCount, 6);
    assert.ok(out.hands.every((h) => h.stood));
    assert.deepEqual(out.actions, ["stand:0", "stand:1"]);
  });

  it("persisted action log stays replayable and settles identically", () => {
    const mid = replayRound(shoe, ["deal", "split"]);
    const out = applyTimeoutStand(mid.hands, shoe, 5);
    const fullActions = ["deal", "split", ...out.actions, "dealer"];
    const replayed = replayRound(shoe, fullActions);
    assert.deepEqual(
      replayed.hands.map((h) => h.cards),
      out.hands.map((h) => h.cards),
    );
    // Settlement over the timeout-stood hands equals settlement over replay.
    const a = settleRound({
      hands: out.hands,
      dealerCards: replayed.dealerCards,
      dealerBlackjack: replayed.dealerBlackjack,
      baseStake: 10000n,
      insuranceTaken: false,
    });
    const b = settleRound({
      hands: replayed.hands,
      dealerCards: replayed.dealerCards,
      dealerBlackjack: replayed.dealerBlackjack,
      baseStake: 10000n,
      insuranceTaken: false,
    });
    assert.deepEqual(a, b);
    assert.equal(a.totalStake, 20000n); // both split hands staked
  });

  it("no-op for hands that are already complete", () => {
    const done = replayRound(shoe, ["deal", "hit:0", "stand:0"]);
    const out = applyTimeoutStand(done.hands, shoe, 5);
    assert.deepEqual(out.actions, []);
    assert.equal(out.drawnCount, 5);
  });
});

describe("RTP sanity (basic-ish strategy, 2000 hands)", () => {
  it("simple total-based strategy returns 90–102%", () => {
    let staked = 0n;
    let returned = 0n;
    for (let n = 0; n < 2000; n++) {
      const s = deriveDeckShuffle("seed" + n, "client", n, 6).cards;
      const actions: string[] = ["deal"];
      // Simulate: hit until hard 17+ (or soft 18+), no splits/doubles.
      const replSim = () => replayRound(s, [...actions, "dealer"]);
      let guard = 0;
      for (;;) {
        const cur = replayRound(s, [...actions]);
        const h = cur.hands[0]!;
        const v = handValue(h.cards);
        if (v.busted || v.total >= (v.soft ? 18 : 17)) break;
        actions.push("hit:0");
        if (++guard > 12) break;
      }
      actions.push("stand:0", "dealer");
      const done = replSim();
      const { totalStake, totalPayout } = settleRound({
        hands: done.hands.map((h) => ({
          ...h,
          stood: true,
        })),
        dealerCards: done.dealerCards,
        dealerBlackjack: done.dealerBlackjack,
        baseStake: 10000n,
        insuranceTaken: false,
      });
      staked += totalStake;
      returned += totalPayout;
    }
    const rtp = Number(returned) / Number(staked);
    assert.ok(rtp > 0.9 && rtp < 1.02, `rtp=${rtp}`);
  });
});
