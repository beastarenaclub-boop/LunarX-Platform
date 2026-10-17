import { createHmac } from "node:crypto";
import {
  VEGETABLE_MODES,
  VEGETABLE_TICKETS,
  VEGETABLE_KINDS,
  VEGETABLE_JUNK_KINDS,
  VEGETABLE_JUNK_ONE_IN,
  VEGETABLE_OUTCOME_VERSION,
  vegetableWinner,
  type VegetableMode,
  type VegetableOutcome,
  type VegetableOutcomeVersion,
} from "@workspace/api-zod/vegetable-game";

export interface VegetableBet {
  type: VegetableMode;
  amountPaise: bigint;
}

/** Rejection sampling avoids modulo bias; domain separation fixes the replay recipe. */
export function deriveVegetableOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  version: VegetableOutcomeVersion = VEGETABLE_OUTCOME_VERSION,
): VegetableOutcome {
  if (version !== 1 && version !== 2) throw new Error("INVALID_VEGETABLE_VERSION");
  let cursor = 0;
  const uniform = (size: number) => {
    const limit = Math.floor(0x100000000 / size) * size;
    for (;;) {
      const value = createHmac("sha256", serverSeed)
        .update(
          JSON.stringify([`vegetable-bowl-v${version}`, clientSeed, nonce, cursor++]),
        )
        .digest()
        .readUInt32BE(0);
      if (value < limit) return value % size;
    }
  };
  // Drawn from the committed seeds, without access to stakes or player choices.
  if (version === 2 && uniform(VEGETABLE_JUNK_ONE_IN) === 0) {
    return {
      total: 0,
      winner: "junk",
      vegetables: [],
      junk: Array.from(
        { length: 4 + uniform(3) },
        () => VEGETABLE_JUNK_KINDS[uniform(VEGETABLE_JUNK_KINDS.length)],
      ),
    };
  }
  const ticket = uniform(VEGETABLE_TICKETS);
  const total =
    ticket < 1000 ? 1 + uniform(6) : ticket < 2000 ? 8 + uniform(5) : 7;
  return {
    total,
    winner: vegetableWinner(total),
    vegetables: Array.from(
      { length: total },
      () => VEGETABLE_KINDS[uniform(VEGETABLE_KINDS.length)],
    ),
  };
}

export function settleVegetableBets(bets: VegetableBet[], total: number, payoutVersion = 1) {
  if (!bets.length) throw new Error("NO_BETS");
  if (bets.length > 3) throw new Error("TOO_MANY_BETS");
  const seen = new Set<string>();
  const winner = vegetableWinner(total);
  let totalStake = 0n;
  let totalPayout = 0n;
  const settled = bets.map((bet) => {
    const mode = VEGETABLE_MODES.find((m) => m.id === bet.type);
    if (!mode) throw new Error("INVALID_VEGETABLE_BET");
    if (seen.has(bet.type)) throw new Error("DUPLICATE_BET_TYPE");
    if (typeof bet.amountPaise !== "bigint" || bet.amountPaise < 100n)
      throw new Error("STAKE_TOO_SMALL");
    seen.add(bet.type);
    const payout =
      bet.type === winner
        ? (bet.amountPaise * BigInt(payoutVersion === 2 ? mode.returnHundredths : mode.id === "risk" ? 2000 : 198)) / 100n
        : 0n;
    totalStake += bet.amountPaise;
    totalPayout += payout;
    return {
      type: bet.type,
      amountPaise: bet.amountPaise.toString(),
      payoutPaise: payout.toString(),
      didWin: bet.type === winner,
    };
  });
  return { settled, totalStake, totalPayout };
}
