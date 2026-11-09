/**
 * Candidate deals for a card game.
 *
 * A wheel can be steered by declaring a pocket. A card game cannot: its outcome
 * is a DEAL, and the cards, the totals and the winner have to agree with each
 * other. "Banker wins" is a verdict, not a deal, and there is no honest way to
 * work backwards from one to the other.
 *
 * So the engine is handed real deals to choose between. Each is derived from
 * the round's own seed with a distinct suffix, which makes them independent,
 * reproducible from the round, and drawn from exactly the distribution the game
 * would have produced anyway. The steering is in WHICH real deal is used, never
 * in inventing one.
 *
 * The sample is what bounds the work. It also bounds the steering, honestly: a
 * class the sample never contains is one the engine cannot reach this round,
 * and a rare class is rare in the sample for the same reason it is rare at the
 * table.
 */
import type { OutcomeSeed } from "../tableAdapter";

/** How many deals each steered round chooses between. */
export const DEAL_SAMPLE_SIZE = 32;

export function sampleDeals<T>(
  seed: OutcomeSeed,
  derive: (serverSeed: string, clientSeed: string, nonce: number) => T,
  count = DEAL_SAMPLE_SIZE,
): T[] {
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    // The suffix goes on the CLIENT seed. The server seed is the round's
    // commitment and the nonce is its position; neither is ours to vary.
    out.push(derive(seed.serverSeed, `${seed.clientSeed}:cand:${i}`, seed.nonce));
  }
  return out;
}

/**
 * A real outcome in a named class, or null.
 *
 * Bounded by the same sample rather than looping until one turns up: a class
 * that never appears in a wide sample is one this round cannot honestly reach,
 * and an unbounded search for it would hold the round open.
 */
export function findInClass<T>(
  seed: OutcomeSeed,
  derive: (serverSeed: string, clientSeed: string, nonce: number) => T,
  classify: (deal: T) => string | null,
  choiceId: string,
  attempts = 400,
): T | null {
  for (const deal of sampleDeals(seed, derive, attempts)) {
    if (classify(deal) === choiceId) return deal;
  }
  return null;
}
