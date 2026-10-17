import { createHash, createHmac } from "node:crypto";
import {
  prizeBucketResult,
  prizeCommitmentMessage,
  type PrizeSettings,
} from "@workspace/api-zod/prize-lotto";
export const prizeHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function prizeResult(seed: string, drawId: string, rtp: number) {
  let sample: number,
    attempt = 0;
  do {
    sample = createHmac("sha256", seed)
      .update(`prize-lotto:v1:${drawId}:${attempt++}`)
      .digest()
      .readUInt32BE();
  } while (sample >= Math.floor(4294967296 / 10000) * 10000);
  return prizeBucketResult(sample % 10000, rtp);
}
// Binds the schedule, payout rules and seed before any ticket can be sold.
export const prizeCommitment = (
  seed: string,
  id: string,
  config: PrizeSettings,
) => prizeHash(prizeCommitmentMessage(seed, id, config));
