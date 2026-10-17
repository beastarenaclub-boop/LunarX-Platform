import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateHand,
  compareHands,
  dealTeenPatti,
  settleTeenPattiBets,
  teenPattiReturnMultiplier,
  TEEN_PATTI_RETURN_HUNDREDTHS,
  type TeenPattiBetInput,
} from "../teenPattiMath";
import { deriveTeenPattiDeal } from "../teenPatti";

// Card helper: rank 0=A,1=2..9=10,10=J,11=Q,12=K; suit 0..3 → id = suit*13+rank
const c = (rank: number, suit: number) => suit * 13 + rank;
const A = 0,
  K = 12,
  Q = 11,
  J = 10;

describe("teen patti hand evaluation", () => {
  it("categorizes hands correctly", () => {
    assert.equal(evaluateHand([c(4, 0), c(4, 1), c(4, 2)]).category, "trail");
    assert.equal(
      evaluateHand([c(A, 0), c(K, 0), c(Q, 0)]).category,
      "pureSequence",
    );
    assert.equal(
      evaluateHand([c(A, 0), c(K, 1), c(Q, 0)]).category,
      "sequence",
    );
    assert.equal(evaluateHand([c(2, 0), c(7, 0), c(J, 0)]).category, "color");
    assert.equal(evaluateHand([c(8, 0), c(8, 1), c(2, 2)]).category, "pair");
    assert.equal(
      evaluateHand([c(2, 0), c(7, 1), c(J, 2)]).category,
      "highCard",
    );
  });

  it("A-2-3 is a sequence (and pure when suited)", () => {
    assert.equal(
      evaluateHand([c(A, 2), c(1, 2), c(2, 2)]).category,
      "pureSequence",
    );
    assert.equal(evaluateHand([c(A, 0), c(1, 1), c(2, 2)]).category, "sequence");
  });

  it("orders categories: trail > pureSeq > seq > color > pair > high", () => {
    const trail = [c(1, 0), c(1, 1), c(1, 2)]; // 2-2-2 (lowest trail)
    const pureSeq = [c(A, 0), c(K, 0), c(Q, 0)];
    const seq = [c(A, 0), c(K, 1), c(Q, 2)];
    const color = [c(A, 0), c(K, 0), c(J, 0)];
    const pair = [c(A, 0), c(A, 1), c(K, 2)];
    const high = [c(A, 0), c(K, 1), c(J, 2)];
    const order = [trail, pureSeq, seq, color, pair, high];
    for (let i = 0; i < order.length - 1; i++) {
      assert.ok(
        compareHands(order[i]!, order[i + 1]!) > 0,
        `rank ${i} should beat rank ${i + 1}`,
      );
    }
  });

  it("sequence ordering: AKQ > A23 > KQJ > 432", () => {
    const akq = [c(A, 0), c(K, 1), c(Q, 2)];
    const a23 = [c(A, 0), c(1, 1), c(2, 2)];
    const kqj = [c(K, 0), c(Q, 1), c(J, 2)];
    const s432 = [c(3, 0), c(2, 1), c(1, 2)];
    assert.ok(compareHands(akq, a23) > 0);
    assert.ok(compareHands(a23, kqj) > 0);
    assert.ok(compareHands(kqj, s432) > 0);
  });

  it("K-A-2 is NOT a sequence (no wraparound)", () => {
    assert.equal(evaluateHand([c(K, 0), c(A, 1), c(1, 2)]).category, "highCard");
  });

  it("pair comparison: pair rank then kicker; trail by rank (aces high)", () => {
    assert.ok(
      compareHands([c(3, 0), c(3, 1), c(1, 2)], [c(2, 0), c(2, 1), c(A, 2)]) >
        0,
    );
    assert.ok(
      compareHands([c(3, 0), c(3, 1), c(A, 2)], [c(3, 2), c(3, 3), c(K, 2)]) >
        0,
    );
    assert.ok(
      compareHands([c(A, 0), c(A, 1), c(A, 2)], [c(K, 0), c(K, 1), c(K, 2)]) >
        0,
    );
  });

  it("high card / color compare lexicographically by descending values", () => {
    assert.ok(
      compareHands([c(A, 0), c(6, 1), c(4, 2)], [c(A, 0), c(6, 1), c(3, 2)]) >
        0,
    );
    assert.equal(
      compareHands([c(A, 0), c(6, 1), c(4, 2)], [c(A, 3), c(6, 2), c(4, 0)]),
      0,
    );
  });
});

describe("teen patti dealing", () => {
  it("deals alternately: A gets positions 0,2,4; B gets 1,3,5", () => {
    const deal = dealTeenPatti([10, 20, 30, 40, 50, 5, 6, 7]);
    assert.deepEqual(deal.handACards, [10, 30, 50]);
    assert.deepEqual(deal.handBCards, [20, 40, 5]);
  });

  it("declares tie when scores are exactly equal", () => {
    // A: A♠6♦4♣ vs B: A♥6♣4♦ — same values, no flush
    const deal = dealTeenPatti([
      c(A, 0),
      c(A, 2),
      c(5, 1),
      c(5, 3),
      c(3, 3),
      c(3, 1),
    ]);
    assert.equal(deal.winner, "tie");
  });
});

describe("teen patti settlement", () => {
  const dealAWins = dealTeenPatti([
    c(A, 0),
    c(2, 1),
    c(A, 1),
    c(7, 2),
    c(K, 2),
    c(9, 3),
  ]); // A: pair of aces; B: high card

  it("pays main winner 1.95x, loser 0", () => {
    const bets: TeenPattiBetInput[] = [
      { type: "playerA", amountPaise: 10000n },
      { type: "playerB", amountPaise: 10000n },
    ];
    const { settled, totalPayout, totalStake } = settleTeenPattiBets(
      bets,
      dealAWins,
      1000,
    );
    assert.equal(totalStake, 20000n);
    assert.equal(settled[0]!.payoutPaise, "19500");
    assert.equal(settled[1]!.payoutPaise, "0");
    assert.equal(totalPayout, 19500n);
  });

  it("pushes main bets on tie; tie bet pays 876x", () => {
    const tieDeal = dealTeenPatti([
      c(A, 0),
      c(A, 2),
      c(5, 1),
      c(5, 3),
      c(3, 3),
      c(3, 1),
    ]);
    const bets: TeenPattiBetInput[] = [
      { type: "playerA", amountPaise: 10000n },
      { type: "tie", amountPaise: 100n },
    ];
    const { settled, totalPayout } = settleTeenPattiBets(bets, tieDeal, 1000);
    assert.equal(settled[0]!.payoutPaise, "10000"); // push
    assert.equal(settled[0]!.push, true);
    assert.equal(settled[1]!.payoutPaise, "87600"); // 876x return
    assert.equal(totalPayout, 97600n);
  });

  it("pair plus pays per that hand's category, loses on high card", () => {
    const bets: TeenPattiBetInput[] = [
      { type: "pairPlusA", amountPaise: 10000n },
      { type: "pairPlusB", amountPaise: 10000n },
    ];
    const { settled } = settleTeenPattiBets(bets, dealAWins, 1000);
    assert.equal(settled[0]!.payoutPaise, "20000"); // pair 1:1 → 2x return
    assert.equal(settled[1]!.payoutPaise, "0"); // high card loses
  });

  it("clamps per-bet return to maxMultiplier", () => {
    const tieDeal = dealTeenPatti([
      c(A, 0),
      c(A, 2),
      c(5, 1),
      c(5, 3),
      c(3, 3),
      c(3, 1),
    ]);
    const { settled } = settleTeenPattiBets(
      [{ type: "tie", amountPaise: 100n }],
      tieDeal,
      100,
    );
    assert.equal(settled[0]!.payoutPaise, "10000"); // capped at 100x
  });

  it("rejects invalid bets", () => {
    assert.throws(() =>
      settleTeenPattiBets(
        [{ type: "bogus" as never, amountPaise: 100n }],
        dealAWins,
        1000,
      ),
    );
    assert.throws(() =>
      settleTeenPattiBets(
        [{ type: "playerA", amountPaise: 0n }],
        dealAWins,
        1000,
      ),
    );
  });
});

describe("teen patti provable fairness", () => {
  it("deal derivation is deterministic for a seed tuple", () => {
    const a = deriveTeenPattiDeal("server-seed-x", "client-seed-y", 7);
    const b = deriveTeenPattiDeal("server-seed-x", "client-seed-y", 7);
    assert.deepEqual(a, b);
    const diff = deriveTeenPattiDeal("server-seed-x", "client-seed-y", 8);
    assert.notDeepEqual(a.handACards, diff.handACards);
  });

  it("uses distinct cards from a single 52-card deck", () => {
    const d = deriveTeenPattiDeal("s", "c", 1);
    const all = [...d.handACards, ...d.handBCards];
    assert.equal(new Set(all).size, 6);
    for (const card of all) assert.ok(card >= 0 && card < 52);
  });
});

describe("teen patti RTP sanity", () => {
  it("main bet RTP ≈ 97.5%, pair plus ≈ 96.7% over sampled rounds", () => {
    const N = 20000;
    let mainReturn = 0n;
    let ppReturn = 0n;
    const stake = 100n;
    for (let i = 0; i < N; i++) {
      const deal = deriveTeenPattiDeal("rtp-server", "rtp-client", i);
      const { settled } = settleTeenPattiBets(
        [
          { type: "playerA", amountPaise: stake },
          { type: "pairPlusA", amountPaise: stake },
        ],
        deal,
        1000,
      );
      mainReturn += BigInt(settled[0]!.payoutPaise);
      ppReturn += BigInt(settled[1]!.payoutPaise);
    }
    const mainRtp = Number(mainReturn) / Number(stake * BigInt(N));
    const ppRtp = Number(ppReturn) / Number(stake * BigInt(N));
    assert.ok(mainRtp > 0.94 && mainRtp < 1.01, `main RTP ${mainRtp}`);
    assert.ok(ppRtp > 0.88 && ppRtp < 1.05, `pair plus RTP ${ppRtp}`);
  });

  it("payout table matches documented multipliers", () => {
    assert.equal(teenPattiReturnMultiplier("playerA", undefined, 1), 1.95);
    assert.equal(teenPattiReturnMultiplier("tie", undefined, 1), 876);
    assert.equal(teenPattiReturnMultiplier("pairPlusA", "pair", 1), 2);
    assert.equal(teenPattiReturnMultiplier("pairPlusA", "color", 1), 5);
    assert.equal(teenPattiReturnMultiplier("pairPlusA", "sequence", 1), 7);
    assert.equal(teenPattiReturnMultiplier("pairPlusA", "pureSequence", 1), 31);
    assert.equal(teenPattiReturnMultiplier("pairPlusA", "trail", 1), 36);
    assert.equal(TEEN_PATTI_RETURN_HUNDREDTHS.main, 195n);
  });
});
