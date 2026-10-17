import { createHash, createHmac } from "node:crypto";
import { CHICKEN_VERSION, chickenSurvival, type ChickenDifficulty, type ChickenVersion } from "@workspace/api-zod/chicken-road-game";

export const chickenSeedHash = (seed: string) => createHash("sha256").update(seed).digest("hex");
export function chickenStepSafe(serverSeed: string, clientSeed: string, difficulty: ChickenDifficulty, step: number, version: ChickenVersion = CHICKEN_VERSION): boolean {
  const survival = chickenSurvival(difficulty, step, version);
  if (version === 2) return true;
  const digest = createHmac("sha256", serverSeed).update(`chicken-road:v${version}:${clientSeed}:${difficulty}:${step}`).digest("hex");
  const uniform = parseInt(digest.slice(0, 13), 16) / 2 ** 52;
  return uniform < survival;
}
