import { createSeedStream } from "../lib/seedStream";
import {
  ICE_FISH_WHEEL,
  ICE_FISH_VALUES,
  ICE_FISH_WEIGHTS,
  iceFishBets,
  isFish,
  settleIceFish,
  type IceFishOutcome,
} from "@workspace/api-zod/ice-fish";
import type { TableGameAdapter } from "./tableRounds";
export function deriveIceFish(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): IceFishOutcome {
  const random = createSeedStream(
    serverSeed,
    `ice-fish-v1:${clientSeed}`,
    nonce,
  );
  const segment = random.uniform(45);
  const boosts = ICE_FISH_WHEEL.map((spot) =>
    isFish(spot)
      ? random.uniform(10) === 0
        ? 2 + random.uniform(9)
        : 1
      : random.uniform(4180) < 199
        ? 3 + random.uniform(8)
        : 1,
  );
  const spot = ICE_FISH_WHEEL[segment];
  let fishValue = 0;
  if (isFish(spot)) {
    let roll = random.uniform(100),
      index = 0;
    while (roll >= ICE_FISH_WEIGHTS[index]) roll -= ICE_FISH_WEIGHTS[index++];
    fishValue = ICE_FISH_VALUES[spot][index];
  }
  return { version: 1, segment, boosts, fishValue };
}
export const iceFishAdapter: TableGameAdapter = {
  validate: (raw) => ({
    totalStake: iceFishBets(raw).reduce(
      (sum, bet) => sum + BigInt(bet.amountPaise),
      0n,
    ),
  }),
  derive: deriveIceFish,
  settle: (bets, outcome, cap, edge) =>
    settleIceFish(bets, outcome as IceFishOutcome, edge, cap),
  insertAudit: async ({ round }) => round.id,
};
