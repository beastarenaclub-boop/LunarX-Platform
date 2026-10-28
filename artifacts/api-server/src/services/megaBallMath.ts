import { createHmac } from "node:crypto";
import {
  MEGA_BALL_MULTIPLIERS,
  megaBallCardResult,
  type MegaBallCard,
  type MegaBallOutcome,
} from "@workspace/api-zod/mega-ball";

function random(seed: string, context: string) {
  let cursor = 0;
  return (max: number) => {
    const limit = Math.floor(0x100000000 / max) * max;
    let value: number;
    do {
      value = createHmac("sha256", seed)
        .update(`${context}:${cursor++}`)
        .digest()
        .readUInt32BE(0);
    } while (value >= limit);
    return value % max;
  };
}
function shuffle(values: number[], next: (max: number) => number) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = next(i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
export function deriveMegaBallOutcome(
  seed: string,
  client: string,
  nonce: number,
): MegaBallOutcome {
  const next = random(seed, JSON.stringify(["mega-ball-v1", client, nonce]));
  const numbers = shuffle(
    Array.from({ length: 51 }, (_, i) => i + 1),
    next,
  );
  const roll = next(1000);
  const index =
    roll < 700
      ? 0
      : roll < 850
        ? 1
        : roll < 925
          ? 2
          : roll < 965
            ? 3
            : roll < 985
              ? 4
              : roll < 997
                ? 5
                : 6;
  return {
    version: 1,
    balls: numbers.slice(0, 20),
    megaBall: numbers[20],
    multiplier: MEGA_BALL_MULTIPLIERS[index],
  };
}
/** Cards use a separate public commitment: no draw seed is disclosed before betting closes. */
export function megaBallCards(
  commitment: string,
  userId: string,
  count: number,
  amountPaise: string,
): MegaBallCard[] {
  return Array.from({ length: count }, (_, index) => {
    const next = random(
      commitment,
      JSON.stringify(["mega-card-v1", userId, index]),
    );
    const columns = Array.from({ length: 5 }, (_, col) =>
      shuffle(
        Array.from({ length: col === 4 ? 11 : 10 }, (_, i) => col * 10 + i + 1),
        next,
      ).slice(0, 5),
    );
    return {
      type: `card-${index + 1}`,
      amountPaise,
      numbers: Array.from(
        { length: 25 },
        (_, n) => columns[n % 5][Math.floor(n / 5)],
      ),
    };
  });
}
export function validateMegaBallCards(raw: unknown) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100)
    throw new Error("INVALID_MEGA_CARDS");
  let totalStake = 0n;
  raw.forEach((card: MegaBallCard, index) => {
    if (
      card.type !== `card-${index + 1}` ||
      !/^\d{1,7}$/.test(String(card.amountPaise)) ||
      BigInt(card.amountPaise) < 100n ||
      BigInt(card.amountPaise) > 1_000_000n
    )
      throw new Error("INVALID_MEGA_CARDS");
    if (
      !Array.isArray(card.numbers) ||
      card.numbers.length !== 25 ||
      new Set(card.numbers).size !== 25 ||
      card.numbers.some(
        (n, i) =>
          !Number.isInteger(n) ||
          n < (i % 5) * 10 + 1 ||
          n > (i % 5 === 4 ? 51 : ((i % 5) + 1) * 10),
      )
    )
      throw new Error("INVALID_MEGA_CARDS");
    totalStake += BigInt(card.amountPaise);
  });
  return { totalStake };
}
export function settleMegaBallCards(raw: unknown, outcome: MegaBallOutcome) {
  validateMegaBallCards(raw);
  const settled = (raw as MegaBallCard[]).map((card) => ({
    ...card,
    ...megaBallCardResult(card.numbers, outcome),
    payout:
      BigInt(card.amountPaise) *
      BigInt(megaBallCardResult(card.numbers, outcome).multiplier),
  }));
  return {
    settled,
    totalPayout: settled.reduce((sum, card) => sum + card.payout, 0n),
  };
}
