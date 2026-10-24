import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dealBaccarat,
  settleBaccaratBets,
  baccaratCardValue,
  baccaratReturnMultiplier,
  baccaratPayouts,
  BACCARAT_BET_TYPES,
  cardRank,
  type BaccaratBetInput,
  type BaccaratDeal,
} from "../baccaratMath";
import { deriveDeckShuffle } from "../rtp";

const MAX = 12;

// Card builder: rank 0=A,1=2,...,8=9,9=10,10=J,11=Q,12=K; suit 0..3.
const c = (rank: number, suit = 0) => suit * 13 + rank;

function deal(shoe: number[]): BaccaratDeal {
  // Pad with kings so any tableau path has enough cards.
  return dealBaccarat([...shoe, c(12), c(12, 1), c(12, 2)]);
}

test("card values: A=1, pips face value, tens/faces = 0", () => {
  assert.equal(baccaratCardValue(c(0)), 1); // A
  assert.equal(baccaratCardValue(c(1)), 2); // 2
  assert.equal(baccaratCardValue(c(8)), 9); // 9
  assert.equal(baccaratCardValue(c(9)), 0); // 10
  assert.equal(baccaratCardValue(c(12)), 0); // K
  assert.equal(baccaratCardValue(52 + c(4)), 5); // second deck 5
});

test("natural 9 stops the deal — no third cards", () => {
  // P: 4+5=9 natural, B: K+Q=0. Order dealt: P1 B1 P2 B2.
  const d = deal([c(3), c(12), c(4, 1), c(11)]);
  assert.equal(d.playerTotal, 9);
  assert.equal(d.bankerTotal, 0);
  assert.equal(d.playerCards.length, 2);
  assert.equal(d.bankerCards.length, 2);
  assert.equal(d.natural, true);
  assert.equal(d.winner, "player");
});

test("natural 8 on banker also stops the deal even if player has 0-5", () => {
  // P: K+2=2, B: 3+5=8 natural.
  const d = deal([c(12), c(2), c(1, 1), c(4, 1)]);
  assert.equal(d.bankerTotal, 8);
  assert.equal(d.playerCards.length, 2);
  assert.equal(d.bankerCards.length, 2);
  assert.equal(d.winner, "banker");
});

test("player draws on 5, stands on 6", () => {
  // Player 2+3=5 draws; banker 4+3=7 stands vs any third card ⇒ P gets 3rd.
  const d1 = deal([c(1), c(3), c(2, 1), c(2, 1), c(8, 2)]); // P third = 9 → total 4
  assert.equal(d1.playerCards.length, 3);
  assert.equal(d1.playerTotal, 4);
  assert.equal(d1.bankerCards.length, 2); // banker 7 stands

  // Player K+6=6 stands; banker 2+3=5 draws (player stood, banker ≤5).
  const d2 = deal([c(12), c(1), c(5, 1), c(2, 1), c(8, 2)]);
  assert.equal(d2.playerCards.length, 2);
  assert.equal(d2.bankerCards.length, 3);
  assert.equal(d2.bankerTotal, (5 + 9) % 10);
});

test("banker 3 draws unless player's third card is 8", () => {
  // P: 2+2=4 draws third. B: K+3=3.
  // Player third = 8 → banker stands.
  const stand = deal([c(1), c(12), c(1, 1), c(2, 1), c(7, 2)]);
  assert.equal(stand.playerCards.length, 3);
  assert.equal(stand.bankerCards.length, 2);
  // Player third = 7 → banker draws.
  const draw = deal([c(1), c(12), c(1, 1), c(2, 1), c(6, 2), c(0, 3)]);
  assert.equal(draw.bankerCards.length, 3);
});

test("banker 4 draws on player third 2-7 only", () => {
  // P: 2+2=4 draws. B: K+4=4.
  const third = (rank: number) =>
    deal([c(1), c(12), c(1, 1), c(3, 1), c(rank, 2), c(0, 3)]);
  assert.equal(third(1).bankerCards.length, 3); // third=2 → draw
  assert.equal(third(6).bankerCards.length, 3); // third=7 → draw
  assert.equal(third(0).bankerCards.length, 2); // third=A(1) → stand
  assert.equal(third(7).bankerCards.length, 2); // third=8 → stand
  assert.equal(third(8).bankerCards.length, 2); // third=9 → stand
  assert.equal(third(12).bankerCards.length, 2); // third=K(0) → stand
});

test("banker 5 draws on player third 4-7; banker 6 draws on 6-7", () => {
  // B: K+5=5.
  const b5 = (rank: number) =>
    deal([c(1), c(12), c(1, 1), c(4, 1), c(rank, 2), c(0, 3)]);
  assert.equal(b5(3).bankerCards.length, 3); // 4 → draw
  assert.equal(b5(6).bankerCards.length, 3); // 7 → draw
  assert.equal(b5(2).bankerCards.length, 2); // 3 → stand
  assert.equal(b5(7).bankerCards.length, 2); // 8 → stand
  // B: K+6=6.
  const b6 = (rank: number) =>
    deal([c(1), c(12), c(1, 1), c(5, 1), c(rank, 2), c(0, 3)]);
  assert.equal(b6(5).bankerCards.length, 3); // 6 → draw
  assert.equal(b6(6).bankerCards.length, 3); // 7 → draw
  assert.equal(b6(4).bankerCards.length, 2); // 5 → stand
});

test("banker 7 always stands even when player drew", () => {
  const d = deal([c(1), c(12), c(1, 1), c(6, 1), c(8, 2)]);
  assert.equal(d.bankerTotal, 7);
  assert.equal(d.bankerCards.length, 2);
});

test("pairs detected by rank on the initial two cards", () => {
  // P: 8♠ 8♥ pair; B: K + Q no pair.
  const d = deal([c(7), c(12), c(7, 1), c(11, 1)]);
  assert.equal(d.playerPair, true);
  assert.equal(d.bankerPair, false);
  assert.equal(cardRank(c(7)), cardRank(c(7, 1)));
});

test("the complete third-card table matches the supplied rules", () => {
  const cardFor = (value: number, suit = 0) => c(value === 0 ? 12 : value - 1, suit);
  const bankerDrawsOn = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [0, 1, 2, 3, 4, 5, 6, 7, 9],
    [2, 3, 4, 5, 6, 7],
    [4, 5, 6, 7],
    [6, 7],
    [],
  ];
  for (let banker = 0; banker <= 7; banker++) {
    for (let third = 0; third <= 9; third++) {
      const d = deal([c(9), cardFor(banker), c(0), c(9, 1), cardFor(third, 2), c(0, 3)]);
      assert.equal(d.playerCards.length, 3);
      assert.equal(d.bankerCards.length, bankerDrawsOn[banker].includes(third) ? 3 : 2, `Banker ${banker}, Player third ${third}`);
    }
  }
  for (let player = 0; player <= 9; player++) {
    const d = deal([cardFor(player), c(6), c(9), c(9, 1), c(0, 2)]);
    assert.equal(d.playerCards.length, player <= 5 ? 3 : 2, `Player ${player}`);
  }
  for (const player of [6, 7]) {
    for (let banker = 0; banker <= 9; banker++) {
      const d = deal([cardFor(player), cardFor(banker, 1), c(9), c(9, 1), c(0, 2)]);
      assert.equal(d.playerCards.length, 2);
      assert.equal(d.bankerCards.length, banker <= 5 ? 3 : 2, `Player stands, Banker ${banker}`);
    }
  }
  for (const natural of [8, 9]) {
    for (let other = 0; other <= 9; other++) {
      for (const [player, banker] of [[natural, other], [other, natural]]) {
        const d = deal([cardFor(player), cardFor(banker, 1), c(9), c(9, 1)]);
        assert.equal(d.playerCards.length, 2);
        assert.equal(d.bankerCards.length, 2);
        assert.equal(d.natural, true);
      }
    }
  }
});

// --- Settlement / payouts ------------------------------------------------

function mkDeal(overrides: Partial<BaccaratDeal>): BaccaratDeal {
  return {
    playerCards: [0, 1],
    bankerCards: [2, 3],
    playerTotal: 0,
    bankerTotal: 0,
    winner: "player",
    playerPair: false,
    bankerPair: false,
    natural: false,
    ...overrides,
  };
}

test("player win pays 1:1 (2x total)", () => {
  const bets: BaccaratBetInput[] = [{ type: "player", amountPaise: 10000n }];
  const r = settleBaccaratBets(bets, mkDeal({ winner: "player" }), MAX);
  assert.equal(r.totalPayout, 20000n);
});

test("banker win pays 0.95:1 (1.95x, exact 5% commission)", () => {
  const bets: BaccaratBetInput[] = [{ type: "banker", amountPaise: 10000n }];
  const r = settleBaccaratBets(bets, mkDeal({ winner: "banker" }), MAX);
  assert.equal(r.totalPayout, 19500n);
  // Odd stake floors: 33 paise × 1.95 = 64.35 → 64
  const odd = settleBaccaratBets(
    [{ type: "banker", amountPaise: 33n }],
    mkDeal({ winner: "banker" }),
    MAX,
  );
  assert.equal(odd.totalPayout, 64n);
});

test("tie pays 8:1 (9x); player/banker bets push on tie", () => {
  const bets: BaccaratBetInput[] = [
    { type: "tie", amountPaise: 1000n },
    { type: "player", amountPaise: 2000n },
    { type: "banker", amountPaise: 3000n },
  ];
  const r = settleBaccaratBets(bets, mkDeal({ winner: "tie" }), MAX);
  // tie 9000 + player push 2000 + banker push 3000
  assert.equal(r.totalPayout, 14000n);
  assert.equal(r.settled[0]!.didWin, true);
  assert.equal(r.settled[1]!.push, true);
  assert.equal(r.settled[2]!.push, true);
});

test("pairs pay 11:1 (12x) independent of the winner", () => {
  const bets: BaccaratBetInput[] = [
    { type: "playerPair", amountPaise: 500n },
    { type: "bankerPair", amountPaise: 500n },
  ];
  const r = settleBaccaratBets(
    bets,
    mkDeal({ winner: "banker", playerPair: true, bankerPair: false }),
    MAX,
  );
  assert.equal(r.settled[0]!.payoutPaise, "6000");
  assert.equal(r.settled[1]!.payoutPaise, "0");
});

test("losing player/banker bets pay 0 when the other side wins", () => {
  const r = settleBaccaratBets(
    [
      { type: "player", amountPaise: 1000n },
      { type: "banker", amountPaise: 1000n },
    ],
    mkDeal({ winner: "banker" }),
    MAX,
  );
  assert.equal(r.settled[0]!.payoutPaise, "0");
  assert.equal(r.settled[1]!.payoutPaise, "1950");
  assert.equal(r.totalStake, 2000n);
});

test("maxMultiplier caps payouts", () => {
  const r = settleBaccaratBets(
    [{ type: "tie", amountPaise: 1000n }],
    mkDeal({ winner: "tie" }),
    5,
  );
  assert.equal(r.totalPayout, 5000n);
});

test("invalid bets rejected", () => {
  assert.throws(
    () =>
      settleBaccaratBets(
        [{ type: "player", amountPaise: 0n }],
        mkDeal({}),
        MAX,
      ),
    /INVALID_BACCARAT_BET/,
  );
  assert.throws(
    () =>
      settleBaccaratBets(
        [{ type: "dragon" as never, amountPaise: 100n }],
        mkDeal({}),
        MAX,
      ),
    /INVALID_BACCARAT_BET/,
  );
});

test("score bets cover every final winning total with exact reference payouts for either hand", () => {
  const scoreTypes = ["score1_4", "score5_6", "score7", "score8", "score9"] as const;
  const bets = scoreTypes.map((type) => ({ type, amountPaise: 10000n }));
  for (const version of [1, 2, 3]) {
    for (const winner of ["player", "banker"] as const) {
      for (let total = 1; total <= 9; total++) {
        const expectedIndex = total <= 4 ? 0 : total <= 6 ? 1 : total - 5;
        const expectedPayout = [85000n, 50000n, 55000n, 40000n, 35000n][expectedIndex];
        const result = settleBaccaratBets(bets, mkDeal({
          winner,
          playerTotal: winner === "player" ? total : total - 1,
          bankerTotal: winner === "banker" ? total : total - 1,
        }), MAX, version);
        assert.equal(result.totalStake, 50000n);
        assert.equal(result.totalPayout, expectedPayout);
        assert.deepEqual(result.settled.filter((b) => b.didWin).map((b) => b.type), [scoreTypes[expectedIndex]]);
        assert.equal(baccaratReturnMultiplier(scoreTypes[expectedIndex], version), Number(expectedPayout) / 10000);
      }
    }
  }
});

test("ties at any score lose every score bet, while main bets still push", () => {
  for (let total = 0; total <= 9; total++) {
    const result = settleBaccaratBets(BACCARAT_BET_TYPES.map((type) => ({ type, amountPaise: 10000n })), mkDeal({
      winner: "tie", playerTotal: total, bankerTotal: total,
    }), MAX, 2);
    assert.equal(result.totalStake, 100000n);
    assert.ok(result.settled.filter((b) => b.type.startsWith("score")).every((b) => !b.didWin && !b.push && b.payoutPaise === "0"));
    assert.ok(result.settled.filter((b) => b.type === "player" || b.type === "banker").every((b) => b.push && b.payoutPaise === "10000"));
  }
});

test("score payouts floor fractional paise, respect caps, and use the completed third-card total", () => {
  const finalDeal = deal([c(1), c(0), c(1, 1), c(0, 1), c(5), c(6)]);
  assert.equal(finalDeal.playerTotal, 0);
  assert.equal(finalDeal.bankerTotal, 9);
  const bets: BaccaratBetInput[] = [
    { type: "score1_4", amountPaise: 33n },
    { type: "score9", amountPaise: 33n },
  ];
  assert.equal(settleBaccaratBets(bets, finalDeal, MAX, 2).totalPayout, 115n);
  assert.equal(settleBaccaratBets(bets, finalDeal, 2, 2).totalPayout, 66n);
  assert.throws(() => settleBaccaratBets([{ type: "score0" as never, amountPaise: 100n }], finalDeal, MAX, 2), /INVALID_BACCARAT_BET/);
});

test("shoe derivation is deterministic and a valid 8-deck permutation", () => {
  const a = deriveDeckShuffle("s", "c", 7, 8);
  const b = deriveDeckShuffle("s", "c", 7, 8);
  assert.deepEqual(a.cards, b.cards);
  assert.equal(a.cards.length, 416);
  assert.equal(new Set(a.cards).size, 416);
  const other = deriveDeckShuffle("s", "c", 8, 8);
  assert.notDeepEqual(a.cards, other.cards);
  // Full deal from a real shoe never throws and is internally consistent.
  const d = dealBaccarat(a.cards);
  assert.ok(["player", "banker", "tie"].includes(d.winner));
  assert.ok(d.playerCards.length >= 2 && d.playerCards.length <= 3);
  assert.ok(d.bankerCards.length >= 2 && d.bankerCards.length <= 3);
});

test("reference paytable quotes every market, plus the Banker 6 exception", () => {
  const quoted = baccaratPayouts(12);
  assert.equal(quoted.payoutVersion, 3);
  assert.deepEqual(quoted.payouts, {
    player: 2, banker: 2, tie: 9, playerPair: 12, bankerPair: 12,
    score1_4: 8.5, score5_6: 5, score7: 5.5, score8: 4, score9: 3.5,
  });
  assert.equal(quoted.bankerSixReturn, 1.5);
  assert.equal(baccaratPayouts(1.25).bankerSixReturn, 1.25);
  assert.ok(Object.values(baccaratPayouts(4).payouts).every(value => value <= 4));
});

test("Banker 6 pays half profit only on the main Banker bet; score and pair pay in full", () => {
  const d = deal([c(9), c(2), c(0), c(2, 1), c(12)]);
  assert.equal(d.bankerTotal, 6);
  assert.equal(d.winner, "banker");
  assert.equal(d.bankerPair, true);
  const result = settleBaccaratBets([
    { type: "banker", amountPaise: 10000n },
    { type: "score5_6", amountPaise: 10000n },
    { type: "bankerPair", amountPaise: 10000n },
  ], d, 12, 3);
  assert.deepEqual(result.settled.map(b => b.payoutPaise), ["15000", "50000", "120000"]);
  assert.equal(result.totalPayout, 185000n);
  assert.ok(result.settled.every(b => b.payoutVersion === 3 && b.didWin));
  assert.equal(settleBaccaratBets([{ type: "banker", amountPaise: 33n }], d, 12, 3).totalPayout, 49n);
  assert.equal(settleBaccaratBets([{ type: "banker", amountPaise: 10000n }], d, 1.25, 3).totalPayout, 12500n);
});

test("new main bets pay even money except Banker 6; ties push mains and lose scores", () => {
  for (const winner of ["player", "banker"] as const) {
    for (let score = 1; score <= 9; score++) {
      const d = mkDeal({ winner, playerTotal: winner === "player" ? score : 0, bankerTotal: winner === "banker" ? score : 0 });
      const result = settleBaccaratBets([{ type: winner, amountPaise: 10000n }], d, MAX, 3);
      assert.equal(result.totalPayout, winner === "banker" && score === 6 ? 15000n : 20000n);
    }
  }
  for (let score = 0; score <= 9; score++) {
    const result = settleBaccaratBets(BACCARAT_BET_TYPES.map(type => ({ type, amountPaise: 10000n })), mkDeal({
      winner: "tie", playerTotal: score, bankerTotal: score, playerPair: true, bankerPair: true,
    }), MAX, 3);
    assert.equal(result.totalPayout, 10000n + 10000n + 90000n + 120000n + 120000n);
    assert.ok(result.settled.filter(b => b.type.startsWith("score")).every(b => b.payoutPaise === "0" && !b.didWin));
  }
});

test("historical payout versions replay unchanged, including Banker wins on 6", () => {
  const d = mkDeal({ winner: "banker", bankerTotal: 6, playerTotal: 5 });
  const bet: BaccaratBetInput[] = [{ type: "banker", amountPaise: 10000n }];
  assert.equal(settleBaccaratBets(bet, d, MAX, 1).totalPayout, 19500n);
  assert.equal(settleBaccaratBets(bet, d, MAX, 2).totalPayout, 16400n);
  assert.equal(settleBaccaratBets(bet, d, MAX, 3).totalPayout, 15000n);
  assert.equal(baccaratPayouts(MAX, 1).bankerSixReturn, 1.95);
  assert.equal(baccaratPayouts(MAX, 2).bankerSixReturn, 1.64);
});

test("empirical RTP sanity over 3000 seeded coups (player/banker near classic edges)", () => {
  let playerRet = 0n;
  let bankerRet = 0n;
  const stake = 100n;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const { cards } = deriveDeckShuffle("rtp-seed", "client", i, 8);
    const d = dealBaccarat(cards);
    const r = settleBaccaratBets(
      [
        { type: "player", amountPaise: stake },
        { type: "banker", amountPaise: stake },
      ],
      d,
      MAX,
    );
    playerRet += BigInt(r.settled[0]!.payoutPaise);
    bankerRet += BigInt(r.settled[1]!.payoutPaise);
  }
  const playerRtp = Number(playerRet) / Number(stake * BigInt(N));
  const bankerRtp = Number(bankerRet) / Number(stake * BigInt(N));
  // Classic: player ~0.9876, banker ~0.9894. Allow generous MC noise.
  assert.ok(playerRtp > 0.95 && playerRtp < 1.02, `playerRtp=${playerRtp}`);
  assert.ok(bankerRtp > 0.95 && bankerRtp < 1.02, `bankerRtp=${bankerRtp}`);
});
