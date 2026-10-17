import { createHash } from "node:crypto";
import {
  W20_WHEEL,
  W20_SPOTS,
  W20_VERSION,
  type W20Outcome,
} from "@workspace/api-zod/wheel20-live";

/** Independent domain-separated rejection samples; no client-selected outcome. */
export function deriveW20Outcome(
  seed: string,
  client: string,
  nonce: number,
): W20Outcome {
  const draw = (domain: string, n: number) => {
    const limit = 256 - (256 % n);
    for (let block = 0; ; block++) {
      const bytes = createHash("sha256")
        .update(`wheel-2-live:v1:${seed}:${client}:${nonce}:${domain}:${block}`)
        .digest();
      for (const b of bytes) if (b < limit) return b % n;
    }
  };
  const segment = draw("segment", W20_WHEEL.length),
    boostRoll = draw("boost", 100);
  return {
    version: W20_VERSION,
    segment,
    winner: W20_WHEEL[segment],
    boostSpot: W20_SPOTS[draw("boost-spot", 9)],
    boost: boostRoll < 75 ? 2 : boostRoll < 95 ? 3 : boostRoll < 99 ? 5 : 8,
  };
}
