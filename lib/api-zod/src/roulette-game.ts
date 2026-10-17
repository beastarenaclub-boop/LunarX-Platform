/** Shared European roulette terms. Multipliers include the original stake. */
export const ROULETTE_PAYOUT_BASE = 36;
export const ROULETTE_HOUSE_EDGE = 1 / 37;
export const ROULETTE_RTP_PERCENT = (36 / 37) * 100;
export const ROULETTE_LIMITS = {
  minBetPaise: "1000",
  straightMaxPaise: "2000000",
  otherMaxPaise: "10000000",
  maxBetsPerSlip: 40,
} as const;

export const ROULETTE_COIN_VALUES: readonly number[] = [10, 20, 50, 100, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
export function rouletteMaxBetPaise(type: string): bigint {
  return BigInt(type === "straight" ? ROULETTE_LIMITS.straightMaxPaise : ROULETTE_LIMITS.otherMaxPaise);
}

/** Ignore irrelevant optional fields, so adding numbers to RED cannot bypass a cap. */
export function rouletteSelectionKey(bet: { type: string; numbers?: number[]; selection?: number }): string {
  if (["straight", "split", "street", "corner", "line"].includes(bet.type)) {
    return `${bet.type}:${[...new Set(bet.numbers ?? [])].sort((a, b) => a - b).join("-")}`;
  }
  if (bet.type === "dozen" || bet.type === "column") return `${bet.type}:${bet.selection}`;
  return bet.type;
}
