import { createHash } from "node:crypto";
import { L7_SUITS, type L7Card } from "@workspace/api-zod/lucky7-live";

/** Rejection sampling avoids modulo bias; one fresh uniform 52-card draw per round. */
export function deriveL7Card(
  seed: string,
  clientSeed: string,
  nonce: number,
): L7Card {
  for (let block = 0; ; block++) {
    const bytes = createHash("sha256")
      .update(`lucky-7-live:v1:${seed}:${clientSeed}:${nonce}:${block}`)
      .digest();
    for (const byte of bytes) {
      if (byte >= 208) continue;
      const index = byte % 52;
      return { rank: (index % 13) + 1, suit: L7_SUITS[Math.floor(index / 13)] };
    }
  }
}
