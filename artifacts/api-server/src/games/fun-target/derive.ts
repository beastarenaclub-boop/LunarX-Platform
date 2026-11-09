import { createSeedStream } from "../../services/rtp";
import type { Outcome } from "./math";
import { WHEEL } from "./layout";
export function deriveFunTargetOutcome(serverSeed: string, clientSeed: string, nonce: number): Outcome {
  return { pocket: createSeedStream(serverSeed, clientSeed, nonce).uniform(WHEEL.digits) };
}
