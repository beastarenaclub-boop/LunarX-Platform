/** Public total-return prices. Integer hundredths always round down. */
export const TARGET_RTP = 0.85;
export const HOUSE_EDGE = 0.15;
export const PAYOUT_VERSION = 2;
const price = (probability: number, push = 0) =>
  Math.floor(((TARGET_RTP - push) * 100) / probability + 1e-9);

// Exhaustive eight-deck enumeration: scripts/derive-table-probabilities.ts.
export const BACCARAT_PROBABILITIES = {
  player: 0.44624660934226346,
  banker: 0.4585974226312408,
  tie: 0.09515596802363215,
  playerPair: 31 / 415,
  bankerPair: 31 / 415,
};
export const BACCARAT_RETURNS = Object.fromEntries(
  Object.entries(BACCARAT_PROBABILITIES).map(([key, probability]) => [
    key,
    price(
      probability,
      key === "player" || key === "banker" ? BACCARAT_PROBABILITIES.tie : 0,
    ),
  ]),
) as Record<keyof typeof BACCARAT_PROBABILITIES, number>;
export const TEEN_PATTI_TIE_CHANCE = 450528 / 407170400;
export const TEEN_PATTI_MAIN_RETURN = price(
  (1 - TEEN_PATTI_TIE_CHANCE) / 2,
  TEEN_PATTI_TIE_CHANCE,
);
export const TEEN_PATTI_TIE_RETURN = price(TEEN_PATTI_TIE_CHANCE);
const pairCounts = {
  pair: 3744,
  color: 1096,
  sequence: 720,
  pureSequence: 48,
  trail: 52,
};
const oldPairReturns = {
  pair: 200,
  color: 500,
  sequence: 700,
  pureSequence: 3100,
  trail: 3600,
};
const pairRtp = Object.entries(pairCounts).reduce(
  (sum, [key, count]) =>
    sum +
    (count * oldPairReturns[key as keyof typeof pairCounts]) / 100 / 22100,
  0,
);
export const TEEN_PATTI_PAIR_RETURNS = Object.fromEntries(
  Object.entries(oldPairReturns).map(([key, value]) => [
    key,
    Math.floor((value * TARGET_RTP) / pairRtp),
  ]),
) as Record<keyof typeof pairCounts, number>;

// Three matching ranks in the 51 cards after the joker. First match at n:
// C(51-n, 2) / C(51, 3), n=1..49.
export const ANDAR_BAHAR_CHANCES = Array.from(
  { length: 49 },
  (_, index) => ((50 - index) * (49 - index)) / ((51 * 50 * 49) / 3),
);
const firstChance = ANDAR_BAHAR_CHANCES.reduce(
  (sum, p, i) => sum + (i % 2 === 0 ? p : 0),
  0,
);
export const ANDAR_FIRST_RETURN = price(firstChance);
export const ANDAR_SECOND_RETURN = price(1 - firstChance);
export const ANDAR_RANGE_RETURNS = Object.fromEntries(
  [
    [1, 5],
    [6, 10],
    [11, 15],
    [16, 25],
    [26, 30],
    [31, 35],
    [36, 40],
    [41, 49],
  ].map(([a, b]) => [
    `range${a}_${b}`,
    price(ANDAR_BAHAR_CHANCES.slice(a - 1, b).reduce((sum, p) => sum + p, 0)),
  ]),
);

export const DRAGON_TIGER_RETURNS = {
  mainProfitPaisePerRupee: price(192 / 415, (31 / 415) * 0.5) - 100,
  tieProfitPaisePerRupee: price(31 / 415) - 100,
};
export function storedPayoutVersion(bets: unknown): number {
  return Array.isArray(bets) && bets.length ? (bets[0]?.payoutVersion ?? 1) : 1;
}
