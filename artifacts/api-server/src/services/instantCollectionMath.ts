import { createHash, createHmac } from "node:crypto";
import { type CollectionOptions, type InstantKind, roadSurvival, sevenMultiplier, sevenWins, type SevenSpot } from "@workspace/api-zod/instant-collection";

export const instantSeedHash = (seed: string) => createHash("sha256").update(seed).digest("hex");
export function instantRandom(seed: string, client: string, game: string, label: string) {
  return parseInt(createHmac("sha256", seed).update(`instant:v1:${game}:${client}:${label}`).digest("hex").slice(0, 13), 16) / 2 ** 52;
}
export function instantHazards(seed: string, client: string, game: string, count: number) {
  const cells = Array.from({ length: 25 }, (_, i) => i);
  for (let i = 24; i > 0; i--) {
    const j = Math.floor(instantRandom(seed, client, game, `shuffle:${i}`) * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, count);
}
export function instantSafe(kind: InstantKind, seed: string, client: string, game: string, step: number, cell: number, options: CollectionOptions) {
  if (kind === "mines") return !instantHazards(seed, client, game, options.mines).includes(cell);
  const roll = instantRandom(seed, client, game, `step:${step}`);
  return kind === "tower" ? Math.floor(roll * 3) !== cell : roll < roadSurvival(options.difficulty);
}
export function instantDraw(kind: InstantKind, seed: string, client: string, game: string, choice: string, rtp: number) {
  const roll = instantRandom(seed, client, game, "draw");
  let outcome: number[], multiplier = 0;
  if (kind === "dice") {
    outcome = [Math.floor(roll * 6) + 1, Math.floor(instantRandom(seed, client, game, "dice:2") * 6) + 1];
    const sum = outcome[0] + outcome[1];
    if (sevenWins(choice as SevenSpot, sum)) multiplier = sevenMultiplier(choice as SevenSpot, rtp);
  } else if (kind === "fishing") {
    const prize = roll < .5 ? 0 : roll < .8 ? 1 : roll < .95 ? 2 : roll < .99 ? 3 : 4;
    outcome = [prize]; multiplier = [0, 1.5, 2, 4, 6][prize] * rtp / .97;
  } else {
    const side = roll < .5 ? 0 : 1;
    outcome = [side];
    if (choice === (side === 0 ? "heads" : "tails")) multiplier = rtp * 2;
  }
  return { outcome, multiplier: Math.floor((multiplier + 1e-10) * 100) / 100 };
}
