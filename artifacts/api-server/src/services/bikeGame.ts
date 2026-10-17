import { RACING_BIKES, type BikePlan, type BikeSlip } from "@workspace/api-zod/bike-racing-game";
import { requireGameConfig, sha256Hex } from "./rtp";
import { badRequest } from "../lib/errors";

/** Independent SHA-256 keys give each bike an equal chance. Stakes never enter the draw. */
export function makeBikePlan(seed: string): BikePlan {
  const order = RACING_BIKES.map(b => ({ id: b.id, key: sha256Hex(`${seed}:bike-finish:${b.id}`) }))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.id - b.id).map(b => b.id);
  const random = (id: number, n: number) => parseInt(sha256Hex(`${seed}:bike-motion:${id}:${n}`).slice(0, 8), 16) / 4294967296;
  return { order, duration: 20, runners: RACING_BIKES.map(b => ({
    id: b.id, lane: b.id - 1,
    finishTime: 18 + order.indexOf(b.id) * .26 + random(b.id, 0) * .1,
    points: [0, .10 + random(b.id, 1) * .045, .25 + random(b.id, 2) * .065,
      .45 + random(b.id, 3) * .07, .68 + random(b.id, 4) * .055, .87 + random(b.id, 5) * .025, 1],
  })) };
}
export function validateBikeSlip(bets: BikeSlip[], min: bigint, max: bigint) {
  if (!Array.isArray(bets) || bets.length < 1 || bets.length > 6) throw badRequest("Choose at least one bike.");
  const ids = new Set<number>();
  let total = 0n;
  for (const bet of bets) {
    if (!RACING_BIKES.some(b => b.id === bet.bikeId) || ids.has(bet.bikeId)) throw badRequest("Invalid or duplicate bike.");
    if (!/^\d{1,18}$/.test(bet.amountPaise)) throw badRequest("Invalid stake.");
    const amount = BigInt(bet.amountPaise);
    if (amount < 100n || amount % 100n !== 0n) throw badRequest("Use whole rupee coins.");
    total += amount; ids.add(bet.bikeId);
  }
  if (total < min || total > max) throw badRequest("Stake is outside the table limits.");
  return total;
}
export async function bikeGameConfig() {
  const cfg = await requireGameConfig("bike-racing");
  const multiplier = Math.min(cfg.maxMultiplier, Math.floor(Math.round((1 - cfg.houseEdge) * 10000) * 6 / 100) / 100);
  return {
    enabled: cfg.enabled,
    minStakePaise: (cfg.minStakePaise > 100n ? cfg.minStakePaise : 100n).toString(),
    maxStakePaise: cfg.maxStakePaise.toString(),
    bikes: RACING_BIKES.map(b => ({ id: b.id, multiplier })),
  };
}
