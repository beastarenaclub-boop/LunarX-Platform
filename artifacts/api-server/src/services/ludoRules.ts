import { createHash, createHmac } from "node:crypto";
export const commitment = (seed: string) =>
  createHash("sha256").update(seed).digest("hex");
/** Rejection sampling avoids modulo bias. Nonce is persisted with every roll. */
export function ludoDie(seed: string, matchId: string, nonce: number): number {
  for (let block = 0; ; block++) {
    const bytes = createHmac("sha256", seed)
      .update(`ludo:v1:${matchId}:${nonce}:${block}`)
      .digest();
    for (const byte of bytes) if (byte < 252) return (byte % 6) + 1;
  }
}
export { legalTokens, nextTurn, timedWinners, rollDie, moveToken, computerToken } from "@workspace/api-zod/ludo-engine";
