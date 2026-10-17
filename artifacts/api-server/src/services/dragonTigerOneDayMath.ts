import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  OD_MARKETS,
  OD_MAX_STAKE,
  type ODPhase,
  type ODStage,
  type ODQuote,
  type ODSelection,
  type ODAcceptedSelection,
} from "@workspace/api-zod/dragon-tiger-one-day";
export { OD_TIMING } from "@workspace/api-zod/dragon-tiger-one-day";
export const rank = (card: number) => (card % 13) + 1;
export const suit = (card: number) => Math.floor((card % 52) / 13);
export const winner = (
  dragon: number,
  tiger: number,
): "dragon" | "tiger" | "tie" =>
  rank(dragon) === rank(tiger)
    ? "tie"
    : rank(dragon) > rank(tiger)
      ? "dragon"
      : "tiger";
export function wins(market: string, dragon: number, tiger: number): boolean {
  if (["dragon", "tiger", "tie"].includes(market))
    return market === winner(dragon, tiger);
  if (market === "suited-tie") return dragon % 52 === tiger % 52;
  const side = market.startsWith("dragon-") ? "dragon" : "tiger";
  const key = market.slice(side.length + 1),
    card = side === "dragon" ? dragon : tiger,
    r = rank(card),
    s = suit(card);
  switch (key) {
    case "odd":
      return r !== 7 && r % 2 === 1;
    case "even":
      return r % 2 === 0;
    case "red":
      return s === 1 || s === 2;
    case "black":
      return s === 0 || s === 3;
    case "low":
      return r <= 6;
    case "high":
      return r >= 8;
    case "seven":
      return r === 7;
    case "face":
      return r >= 11;
    case "number":
      return r <= 10;
    case "spades":
      return s === 0;
    case "hearts":
      return s === 1;
    case "diamonds":
      return s === 2;
    case "clubs":
      return s === 3;
    default:
      return key.startsWith("rank-") && r === Number(key.slice(5));
  }
}
const quoteCache = new Map<number, ODQuote[]>();
/** Count all physical cards. Quotes depend ONLY on the revealed card, never the hidden outcome. */
export function quotes(dragon?: number): ODQuote[] {
  const key = dragon === undefined ? -1 : dragon % 52;
  if (quoteCache.has(key)) return quoteCache.get(key)!;
  const counts = OD_MARKETS.map(() => 0);
  let total = 0;
  // One representative per face, weighted by its eight copies. The remaining
  // shoe has 415 physical cards. Initial distribution has 416 * 415 pairs.
  for (let d = 0; d < 52; d++) {
    if (key !== -1 && d !== key) continue;
    for (let t = 0; t < 52; t++) {
      const weight = (d === t ? 7 : 8) * (key === -1 ? 8 : 1);
      total += weight;
      OD_MARKETS.forEach((market, i) => {
        if (wins(market.id, d, t)) counts[i] += weight;
      });
    }
  }
  const result = OD_MARKETS.map((market, i) => {
    // 85% expected return, rounded down. Accepted quotes remain on the slip.
    const oddsHundredths = counts[i] ? Math.floor((85 * total) / counts[i]) : 0;
    const available =
      counts[i] > 0 &&
      counts[i] < total &&
      oddsHundredths > 100 &&
      !(key !== -1 && market.side === "dragon");
    return {
      ...market,
      oddsHundredths: available ? oddsHundredths : 0,
      probability: counts[i] / total,
      available,
    };
  });
  quoteCache.set(key, result);
  return result;
}
export interface RoundClock {
  firstClosesAt: Date;
  secondOpensAt: Date;
  secondClosesAt: Date;
  revealsAt: Date;
  endsAt: Date;
}
/** Explicit allow-list prevents hidden cards and the nonce leaking into open markets. */
export function publicRound(
  round: RoundClock & {
    id: number;
    dragon: number;
    tiger: number;
    commitment: string;
    nonce: string;
  },
  now: number,
) {
  return {
    id: round.id,
    ...phaseAt(round, now),
    commitment: round.commitment,
    firstClosesAt: round.firstClosesAt.getTime(),
    secondOpensAt: round.secondOpensAt.getTime(),
    secondClosesAt: round.secondClosesAt.getTime(),
    revealsAt: round.revealsAt.getTime(),
    endsAt: round.endsAt.getTime(),
    ...(now >= round.secondOpensAt.getTime() ? { dragon: round.dragon } : {}),
    ...(now >= round.revealsAt.getTime()
      ? {
          tiger: round.tiger,
          winner: winner(round.dragon, round.tiger),
          nonce: round.nonce,
        }
      : {}),
  };
}
export function phaseAt(
  round: RoundClock,
  now: number,
): { phase: ODPhase; phaseEndsAt: number } {
  for (const [phase, time] of [
    ["first", round.firstClosesAt],
    ["dragon-reveal", round.secondOpensAt],
    ["second", round.secondClosesAt],
    ["tiger-reveal", round.revealsAt],
    ["result", round.endsAt],
  ] as const) {
    if (now < time.getTime() || phase === "result")
      return { phase, phaseEndsAt: time.getTime() };
  }
  throw new Error("Invalid round clock");
}
export function lockSelections(
  input: ODSelection[],
  stageQuotes: ODQuote[],
  previousStake = 0n,
): { selections: ODAcceptedSelection[]; stake: bigint } {
  if (!input.length || input.length > OD_MARKETS.length)
    throw new Error("Choose at least one market.");
  const seen = new Set<string>();
  let stake = 0n;
  const selections = input.map((bet) => {
    if (seen.has(bet.market)) throw new Error("Duplicate market.");
    seen.add(bet.market);
    const quote = stageQuotes.find((q) => q.id === bet.market);
    if (!quote?.available) throw new Error("This market is closed.");
    if (!/^[1-9]\d{0,6}$/.test(bet.amountPaise))
      throw new Error("Invalid stake.");
    const amount = BigInt(bet.amountPaise);
    if (amount < 100n || amount % 100n !== 0n)
      throw new Error("Choose whole rupee coins, minimum ₹1.");
    stake += amount;
    return { ...bet, oddsHundredths: quote.oddsHundredths };
  });
  if (stake + previousStake > BigInt(OD_MAX_STAKE))
    throw new Error("Maximum total stake is ₹5,000 across both chances.");
  return { selections, stake };
}
export function payout(
  selections: ODAcceptedSelection[],
  dragon: number,
  tiger: number,
): bigint {
  return selections.reduce(
    (sum, bet) =>
      sum +
      (wins(bet.market, dragon, tiger)
        ? (BigInt(bet.amountPaise) * BigInt(bet.oddsHundredths)) / 100n
        : 0n),
    0n,
  );
}
export const quoteId = (id: number, stage: ODStage) => `${id}:${stage}:v1`;
export const commitment = (dragon: number, tiger: number, nonce: string) =>
  createHash("sha256").update(`${dragon}:${tiger}:${nonce}`).digest("hex");
export function draw(random: (max: number) => number = randomInt) {
  const dragon = random(416),
    other = random(415),
    tiger = other >= dragon ? other + 1 : other;
  const nonce = randomBytes(32).toString("hex");
  return { dragon, tiger, nonce, commitment: commitment(dragon, tiger, nonce) };
}
