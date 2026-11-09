/**
 * The two random sources this engine uses, and why they are different.
 *
 * `uniformPocket` is the honest draw: `randomInt` from node:crypto, which is
 * rejection sampling, so every pocket has probability exactly 1/pocketCount.
 * 38 and 20 are not powers of two, so a naive `bytes % n` would skew toward the
 * low pockets. A rebuild in another language must use its own rejection-sampling
 * primitive here, not modulo.
 *
 * `SeededRng` is the DECISION rng: a small deterministic PRNG seeded from a
 * fresh CSPRNG draw each round, so the decision can be replayed from the seed
 * recorded on the round. It is deliberately NOT used for the honest draw and
 * `uniformPocket` is deliberately NOT used for the decision — the two exist for
 * different reasons and swapping them loses either the uniformity or the
 * replayability.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";

/** Uniform over `[0, pocketCount)`, rejection-sampled. */
export function uniformPocket(pocketCount: number): number {
  return randomInt(0, pocketCount);
}

/**
 * xorshift32, seeded from SHA-256 of the seed string.
 *
 * Every value is unsigned 32-bit; `>>> 0` after each step is what keeps it so.
 * `int(max)` is `floor(next() * max)` with a clamp, and the clamp is not
 * decoration — `next()` can return a value that rounds to exactly 1 at the top
 * of the float range, which without it would index one past the end.
 *
 * The float-scaling in `int` carries a bias on the order of 2^-32 relative,
 * which is not observable. It is a different construction from `uniformPocket`
 * on purpose: this one has to be reproducible from a recorded seed, and
 * rejection sampling is not, because the number of draws it makes varies.
 */
export class SeededRng {
  private state: number;

  constructor(readonly seed: string) {
    this.state = createHash("sha256").update(seed).digest().readUInt32BE(0) || 1;
  }

  static fresh(): SeededRng {
    return new SeededRng(randomBytes(16).toString("hex"));
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x1_0000_0000;
  }

  int(max: number): number {
    return Math.min(max - 1, Math.floor(this.next() * max));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }
}
