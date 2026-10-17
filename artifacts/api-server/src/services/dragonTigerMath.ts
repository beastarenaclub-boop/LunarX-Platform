import { randomInt } from "node:crypto";

export type DragonTigerSide = "dragon" | "tiger" | "tie";
export type DragonTigerSpots = Record<DragonTigerSide, number>;
export const BETTING_MS = 20_000;
export const DEALING_MS = 3_000;
export const RESULT_MS = 6_000;
export const MAX_STAKE = 5_000;

/** Eight decks, sampled without replacement. Ace is low; suits never break ties. */
export function drawDragonTiger(random: (max: number) => number = randomInt) {
  const dragon = random(416);
  const second = random(415);
  return { dragon, tiger: second >= dragon ? second + 1 : second };
}

export function dragonTigerWinner(
  dragon: number,
  tiger: number,
): DragonTigerSide {
  const difference = (dragon % 13) - (tiger % 13);
  return difference === 0 ? "tie" : difference > 0 ? "dragon" : "tiger";
}

export function dragonTigerStake(spots: DragonTigerSpots) {
  const amounts = [spots.dragon, spots.tiger, spots.tie];
  if (amounts.some((n) => !Number.isSafeInteger(n) || n < 0 || n % 10 !== 0))
    throw new Error("Choose whole chips in multiples of 10.");
  const total = amounts.reduce((a, b) => a + b, 0);
  if (total < 10 || total > MAX_STAKE)
    throw new Error("Total bet must be between 10 and 5,000 chips.");
  return total;
}

export const DRAGON_TIGER_PAYTABLE = {
  mainProfitPaisePerRupee: 98,
  tieProfitPaisePerRupee: 1200,
};

/** Exact wallet return, including stake. Main bets still receive half back on a tie. */
export function dragonTigerPayoutPaise(
  spots: DragonTigerSpots,
  winner: DragonTigerSide,
  paytable = DRAGON_TIGER_PAYTABLE,
) {
  return winner === "tie"
    ? BigInt(spots.tie) * (100n + BigInt(paytable.tieProfitPaisePerRupee))
      + BigInt(spots.dragon + spots.tiger) * 50n
    : BigInt(spots[winner]) * (100n + BigInt(paytable.mainProfitPaisePerRupee));
}

export function dragonTigerPayout(spots: DragonTigerSpots, winner: DragonTigerSide) {
  return Number(dragonTigerPayoutPaise(spots, winner)) / 100;
}
