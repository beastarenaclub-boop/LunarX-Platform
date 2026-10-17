import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BACCARAT_PROBABILITIES,
  BACCARAT_RETURNS,
  TEEN_PATTI_MAIN_RETURN,
  TEEN_PATTI_TIE_CHANCE,
  TEEN_PATTI_TIE_RETURN,
  TEEN_PATTI_PAIR_RETURNS,
  ANDAR_BAHAR_CHANCES,
  ANDAR_FIRST_RETURN,
  ANDAR_SECOND_RETURN,
  ANDAR_RANGE_RETURNS,
  DRAGON_TIGER_RETURNS,
} from "@workspace/api-zod/game-economics";
import {
  CHICKEN_DIFFICULTIES,
  CHICKEN_MODES,
  chickenSurvival,
  chickenReturn,
} from "@workspace/api-zod/chicken-road-game";
import {
  CRAZY_TIME_TYPES,
  CRAZY_TIME_RTP,
  CRAZY_TIME_BASE_RTP,
  crazyTimeReturn,
  CRAZY_TIME_SPOTS,
  CRAZY_TOP_PRIZES,
  CRAZY_COIN_PRIZES,
  CRAZY_CASH_PRIZES,
  CRAZY_WHEEL_PRIZES,
  type CrazyTimeOutcome,
} from "@workspace/api-zod/crazy-time-game";
import { settleCrazyTimeBets } from "../crazyTimeMath";
import { RACING_HORSES, horseOdds } from "@workspace/api-zod/horse-racing-game";
import {
  deriveCrashPoint,
  minesMultiplier,
  diceMultiplier,
  diceDidWin,
  plinkoMultiplierTable,
} from "../rtp";
import { settleLucky7Bets } from "../lucky7Math";
import { settleRouletteBets, type RouletteBetInput } from "../rouletteMath";
import { handReturn } from "../blackjackMath";
import { multiplierFor } from "../../../../3d-game/wingo-server/rules.mjs";

function bounded(rtp: number, floor = 0.84) {
  assert.ok(
    rtp <= 0.85 + 1e-12 && rtp >= floor,
    `RTP ${rtp} outside ${floor}..0.85`,
  );
}

test("Crazy Time: enumerate weighted prizes, boosts and top slots through actual settlement", () => {
  for (const spot of CRAZY_TIME_SPOTS) {
    const prizes: readonly (readonly [number,number])[] = spot.profit !== null ? [[spot.profit,1]] : spot.id === "coin-flip" ? CRAZY_COIN_PRIZES : spot.id === "crazy-time" ? CRAZY_WHEEL_PRIZES : CRAZY_CASH_PRIZES;
    const weight=prizes.reduce((sum,[,n])=>sum+n,0);
    const boosts=spot.id === "pachinko" ? [[1,.95],[2,.0475],[4,.0025]] : spot.id === "crazy-time" ? [[1,.8],[2,.08],[3,.08],[4,.01],[6,.02],[9,.01]] : [[1,1]];
    const tops=[[1,7/8],...CRAZY_TOP_PRIZES.map(([value,n])=>[value,n/8000])];
    let rtp=0;
    for(const [value,n] of prizes) for(const [boost,p] of boosts) for(const [top,t] of tops) {
      const bonus:CrazyTimeOutcome["bonus"] = spot.id === "coin-flip" ? {kind:"coin-flip",sides:[value,value],side:0} : spot.id === "cash-hunt" ? {kind:"cash-hunt",grid:[value]} : spot.id === "pachinko" ? {kind:"pachinko",slots:[value],slot:0,doubles:Math.log2(boost),path:[]} : spot.id === "crazy-time" ? {kind:"crazy-time",pointers:[value*boost,value*boost,value*boost],boosts:[]} : null;
      const payout=settleCrazyTimeBets([{type:spot.id,amountPaise:100000000n,...(spot.id === "cash-hunt" || spot.id === "crazy-time" ? {choice:0} : {})}],{version:1,segment:0,winner:spot.id,topSlot:{spot:spot.id,multiplier:top},bonus},2).totalPayout;
      rtp+=Number(payout)/100000000*(spot.count/54)*(n/weight)*p*t;
    }
    bounded(rtp,.849);
  }
});

test("Lucky 7: enumerate all 36 outcomes; every v3 spot returns exactly 85%", () => {
  for (const type of ["under", "exactly", "over"] as const) {
    let total = 0n;
    for (let a = 1; a <= 6; a++)
      for (let b = 1; b <= 6; b++)
        total += settleLucky7Bets(
          [{ type, amountPaise: 10000n }],
          { dice: [a, b], total: a + b },
          0.15,
          12,
          3,
        ).totalPayout;
    assert.equal(total, 306000n);
  }
  assert.equal(
    settleLucky7Bets(
      [{ type: "exactly", amountPaise: 100n }],
      { dice: [1, 6], total: 7 },
      0.15,
      12,
      2,
    ).totalPayout,
    1200n,
  );
});

test("Roulette: current 36-base returns and historical 85% terms replay independently", () => {
  const bets: RouletteBetInput[] = [
    { type: "straight", numbers: [0], amountPaise: 1000000n },
    { type: "split", numbers: [1, 2], amountPaise: 1000000n },
    { type: "street", numbers: [1, 2, 3], amountPaise: 1000000n },
    { type: "corner", numbers: [1, 2, 4, 5], amountPaise: 1000000n },
    { type: "line", numbers: [1, 2, 3, 4, 5, 6], amountPaise: 1000000n },
    { type: "dozen", selection: 1, amountPaise: 1000000n },
    { type: "column", selection: 2, amountPaise: 1000000n },
    { type: "red", amountPaise: 1000000n },
  ];
  for (const bet of bets) {
    let total = 0n;
    for (let pocket = 0; pocket < 37; pocket++)
      total += settleRouletteBets([bet], pocket, 1000).totalPayout;
    assert.equal(total, 36000000n);
    let historical = 0n;
    for (let pocket = 0; pocket < 37; pocket++)
      historical += settleRouletteBets([bet], pocket, 1000, 31.45).totalPayout;
    bounded(Number(historical) / 37000000, 0.849999);
  }
  assert.equal(
    settleRouletteBets([bets[0]], 0, 1000, 35).totalPayout,
    35000000n,
  );
});

test("Baccarat prices account for pushes and eight-deck pair probability", () => {
  for (const key of Object.keys(
    BACCARAT_RETURNS,
  ) as (keyof typeof BACCARAT_RETURNS)[])
    bounded(
      (BACCARAT_RETURNS[key] / 100) * BACCARAT_PROBABILITIES[key] +
        (["player", "banker"].includes(key) ? BACCARAT_PROBABILITIES.tie : 0),
    );
  assert.deepEqual(BACCARAT_RETURNS, {
    player: 169,
    banker: 164,
    tie: 893,
    playerPair: 1137,
    bankerPair: 1137,
  });
});

test("Teen Patti prices include exact ties and the complete 22,100-hand category counts", () => {
  bounded(
    ((TEEN_PATTI_MAIN_RETURN / 100) * (1 - TEEN_PATTI_TIE_CHANCE)) / 2 +
      TEEN_PATTI_TIE_CHANCE,
  );
  bounded((TEEN_PATTI_TIE_RETURN / 100) * TEEN_PATTI_TIE_CHANCE);
  const counts = {
    pair: 3744,
    color: 1096,
    sequence: 720,
    pureSequence: 48,
    trail: 52,
  };
  bounded(
    Object.entries(counts).reduce(
      (sum, [key, n]) =>
        sum +
        (n * TEEN_PATTI_PAIR_RETURNS[key as keyof typeof counts]) / 100 / 22100,
      0,
    ),
  );
});

test("Andar Bahar first matching card probabilities sum to one; every range stays within 85%", () => {
  assert.ok(
    Math.abs(ANDAR_BAHAR_CHANCES.reduce((s, p) => s + p, 0) - 1) < 1e-12,
  );
  const first = ANDAR_BAHAR_CHANCES.reduce(
    (s, p, i) => s + (i % 2 === 0 ? p : 0),
    0,
  );
  bounded((first * ANDAR_FIRST_RETURN) / 100);
  bounded(((1 - first) * ANDAR_SECOND_RETURN) / 100);
  for (const [key, value] of Object.entries(ANDAR_RANGE_RETURNS)) {
    const [a, b] = key.slice(5).split("_").map(Number);
    bounded(
      (ANDAR_BAHAR_CHANCES.slice(a - 1, b).reduce((s, p) => s + p, 0) * value) /
        100,
    );
  }
});

test("Dragon Tiger includes half-stake tie returns in main wager RTP", () => {
  bounded(
    ((1 + DRAGON_TIGER_RETURNS.mainProfitPaisePerRupee / 100) * 192) / 415 +
      (0.5 * 31) / 415,
  );
  bounded(((1 + DRAGON_TIGER_RETURNS.tieProfitPaisePerRupee / 100) * 31) / 415);
});

test("Chicken Road v3 has 85% expected return at every stopping lane; v2 replays safely", () => {
  for (const mode of CHICKEN_DIFFICULTIES) {
    let survival = 1;
    for (let lane = 1; lane <= CHICKEN_MODES[mode].returns.length; lane++) {
      survival *= chickenSurvival(mode, lane, 3);
      assert.ok(
        Math.abs((survival * chickenReturn(mode, lane)) / 100 - 0.85) < 1e-12,
      );
      assert.equal(chickenSurvival(mode, lane, 2), 1);
    }
  }
});

test("Mines does not silently raise sub-1x returns above the target", () => {
  for (let mines = 1; mines < 25; mines++) {
    let chance = 1;
    for (let reveal = 1; reveal <= 25 - mines; reveal++) {
      chance *= (25 - mines - reveal + 1) / (25 - reveal + 1);
      bounded(
        chance *
          minesMultiplier({
            gridSize: 25,
            mineCount: mines,
            revealedSafe: reveal,
            houseEdge: 0.15,
            maxMultiplier: 1e12,
            payoutVersion: 2,
          }),
      );
    }
  }
  assert.equal(
    minesMultiplier({
      gridSize: 25,
      mineCount: 1,
      revealedSafe: 1,
      houseEdge: 0.15,
      maxMultiplier: 1000,
      payoutVersion: 1,
    }),
    1,
  );
});

test("Dice: enumerate all 10,000 rolls including strict boundary exclusions", () => {
  for (const direction of ["under", "over"] as const)
    for (const target of [1, 10, 50, 90, 98]) {
      let wins = 0;
      for (let n = 0; n < 10000; n++)
        if (diceDidWin(n / 100, target, direction)) wins++;
      bounded(
        (wins / 10000) *
          diceMultiplier({
            target,
            direction,
            houseEdge: 0.15,
            maxMultiplier: 1000,
          }),
      );
    }
});

test("Plinko binomial probabilities price all row/risk combinations to 85%", () => {
  for (const rows of [8, 12, 16] as const)
    for (const risk of ["low", "medium", "high"] as const) {
      const prices = plinkoMultiplierTable(rows, risk, 0.15, 1000000);
      let coefficient = 1,
        rtp = 0;
      for (let k = 0; k <= rows; k++) {
        rtp += (coefficient / 2 ** rows) * prices[k];
        coefficient = (coefficient * (rows - k)) / (k + 1);
      }
      bounded(rtp);
    }
});

test("Crash distribution reaches fixed auto-cashout targets with approximately 85% return", () => {
  const targets = [1.01, 1.5, 2, 5, 10],
    won = targets.map(() => 0),
    n = 200000;
  for (let nonce = 0; nonce < n; nonce++) {
    const crash = deriveCrashPoint(
      "economics-regression-seed",
      "client",
      nonce,
      0.15,
      10,
      3,
    );
    targets.forEach((target, i) => {
      if (crash >= target) won[i]++;
    });
  }
  targets.forEach((target, i) =>
    assert.ok(
      Math.abs((won[i] / n) * target - 0.85) < 0.015,
      `${target}x RTP ${(won[i] / n) * target}`,
    ),
  );
});

test("WinGo: all colours, sizes and digits average exactly 85% over ten outcomes", () => {
  for (const pick of [
    "red",
    "green",
    "violet",
    "big",
    "small",
    ...Array.from({ length: 10 }, (_, i) => String(i)),
  ]) {
    assert.ok(
      Math.abs(
        Array.from({ length: 10 }, (_, i) => multiplierFor(pick, i, 2)).reduce(
          (s, v) => s + v,
          0,
        ) /
          10 -
          0.85,
      ) < 1e-12,
      pick,
    );
  }
  assert.equal(multiplierFor("0", 0, 1), 9);
});

test("Race prices use independent draw probabilities and Blackjack preserves explicit legacy returns", () => {
  for (const horse of RACING_HORSES)
    bounded(
      (horse.probability / 100) * horseOdds(horse.probability, 0.15, 1000),
    );
  for (const outcome of ["blackjack", "win", "push", "lose"] as const)
    for (const stake of [100n, 101n, 10001n])
      assert.equal(
        handReturn(outcome, stake, 2),
        (handReturn(outcome, stake, 1) * 85n) / 100n,
      );
});

test("Crazy Time adjusted payouts include stake and respect the disclosed cap", () => {
  for (const type of CRAZY_TIME_TYPES) {
    assert.equal(CRAZY_TIME_RTP[type], 0.85);
    assert.ok(CRAZY_TIME_BASE_RTP[type] > 0);
  }
  const outcome = {
    version: 1 as const,
    segment: 0,
    winner: "5" as const,
    topSlot: { spot: "5" as const, multiplier: 3 },
    bonus: null,
  };
  assert.equal(crazyTimeReturn(outcome, 0, 1), 16);
  assert.ok(crazyTimeReturn(outcome, 0, 2) < 16);
});
