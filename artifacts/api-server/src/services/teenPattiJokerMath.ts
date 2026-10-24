import { dealJoker } from "@workspace/api-zod/teenpatti-joker";
import { deriveDeckShuffle } from "./rtp";

export function deriveJokerOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
) {
  return dealJoker(deriveDeckShuffle(serverSeed, clientSeed, nonce, 1).cards);
}
