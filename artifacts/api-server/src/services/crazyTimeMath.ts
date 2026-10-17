import { createHmac } from "node:crypto";
import {
  CRAZY_TIME_VERSION,
  CRAZY_TIME_TYPES,
  CRAZY_TIME_WHEEL,
  CRAZY_TOP_PRIZES,
  CRAZY_COIN_PRIZES,
  CRAZY_CASH_PRIZES,
  CRAZY_WHEEL_PRIZES,
  crazyTimeReturn,
  type CrazyTimeBet,
  type CrazyTimeOutcome,
} from "@workspace/api-zod/crazy-time-game";

export type CrazyTimeBetInput = Omit<CrazyTimeBet, "amountPaise"> & {
  amountPaise: bigint;
};

/** Seed-only, rejection-sampled draws. Neither stakes nor choices affect the draw. */
export function deriveCrazyTimeOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  version = CRAZY_TIME_VERSION,
): CrazyTimeOutcome {
  if (version !== 1) throw new Error("INVALID_CRAZY_TIME_VERSION");
  let cursor = 0;
  const uniform = (size: number): number => {
    const limit = Math.floor(0x100000000 / size) * size;
    for (;;) {
      const n = createHmac("sha256", serverSeed)
        .update(JSON.stringify(["crazy-time-v1", clientSeed, nonce, cursor++]))
        .digest()
        .readUInt32BE(0);
      if (n < limit) return n % size;
    }
  };
  const weighted = (table: readonly (readonly [number, number])[]): number => {
    let draw = uniform(table.reduce((sum, [, weight]) => sum + weight, 0));
    for (const [value, weight] of table) {
      if (draw < weight) return value;
      draw -= weight;
    }
    throw new Error("INVALID_PRIZE_TABLE");
  };
  const segment = uniform(CRAZY_TIME_WHEEL.length);
  const winner = CRAZY_TIME_WHEEL[segment];
  const topSlot = {
    spot: CRAZY_TIME_TYPES[uniform(8)],
    multiplier: weighted(CRAZY_TOP_PRIZES),
  };
  let bonus: CrazyTimeOutcome["bonus"] = null;
  if (winner === "coin-flip") {
    bonus = {
      kind: winner,
      sides: [weighted(CRAZY_COIN_PRIZES), weighted(CRAZY_COIN_PRIZES)],
      side: uniform(2) as 0 | 1,
    };
  } else if (winner === "cash-hunt") {
    bonus = {
      kind: winner,
      grid: Array.from({ length: 108 }, () => weighted(CRAZY_CASH_PRIZES)),
    };
  } else if (winner === "pachinko") {
    const path = Array.from({ length: 15 }, () => uniform(2));
    let doubles = 0;
    while (doubles < 2 && uniform(20) === 0) doubles++;
    bonus = {
      kind: winner,
      slots: Array.from({ length: 16 }, () => weighted(CRAZY_CASH_PRIZES)),
      path,
      slot: path.reduce((sum, step) => sum + step, 0),
      doubles,
    };
  } else if (winner === "crazy-time") {
    const boosts: number[] = [];
    // At most two respins; the final spin always lands on a prize.
    for (let spin = 0; spin < 2; spin++) {
      const n = uniform(10);
      if (n > 1) break;
      boosts.push(n === 0 ? 2 : 3);
    }
    const boost = boosts.reduce((product, n) => product * n, 1);
    bonus = {
      kind: winner,
      pointers: Array.from({ length: 3 }, () =>
        Math.min(5000, weighted(CRAZY_WHEEL_PRIZES) * boost),
      ) as [number, number, number],
      boosts,
    };
  }
  return { version, segment, winner, topSlot, bonus };
}

export function validateCrazyTimeBets(bets: CrazyTimeBetInput[]) {
  if (!Array.isArray(bets) || !bets.length) throw new Error("NO_BETS");
  if (bets.length > 8) throw new Error("TOO_MANY_BETS");
  const seen = new Set<string>();
  let totalStake = 0n;
  for (const bet of bets) {
    if (!(CRAZY_TIME_TYPES as readonly string[]).includes(bet.type))
      throw new Error("INVALID_CRAZY_TIME_BET");
    if (seen.has(bet.type)) throw new Error("DUPLICATE_BET_TYPE");
    seen.add(bet.type);
    if (typeof bet.amountPaise !== "bigint" || bet.amountPaise < 100n)
      throw new Error("STAKE_TOO_SMALL");
    if (
      bet.choice !== undefined &&
      (!Number.isInteger(bet.choice) ||
        bet.choice < 0 ||
        (bet.type === "cash-hunt"
          ? bet.choice > 107
          : bet.type === "crazy-time"
            ? bet.choice > 2
            : true))
    )
      throw new Error("INVALID_BONUS_CHOICE");
    totalStake += bet.amountPaise;
  }
  return { totalStake };
}

export function settleCrazyTimeBets(
  bets: CrazyTimeBetInput[],
  outcome: CrazyTimeOutcome,
  payoutVersion = 1,
) {
  const { totalStake } = validateCrazyTimeBets(bets);
  let totalPayout = 0n;
  const settled = bets.map((bet) => {
    const didWin = bet.type === outcome.winner;
    const multiplier = didWin
      ? crazyTimeReturn(outcome, bet.choice ?? 0, payoutVersion)
      : 0;
    const payout = bet.amountPaise * BigInt(Math.round(multiplier * 10000)) / 10000n;
    totalPayout += payout;
    return {
      ...bet,
      amountPaise: bet.amountPaise.toString(),
      multiplier,
      payoutPaise: payout.toString(),
      didWin,
    };
  });
  return { settled, totalStake, totalPayout };
}
