import crypto from "node:crypto";

// Moved here from services/rtp.ts (2026-09-29) byte-for-byte: it is a
// HISTORICAL CONTRACT — every stored table round re-derives through it — and
// the only thing that changed is the file, so the outcome spaces can be
// loaded without a database.
/**
 * Shared provably-fair byte stream: chunked SHA-256 over
 * `${serverSeed}:${clientSeed}:${nonce}:${i}` (same scheme mines/plinko/dice
 * inline above) exposing unbiased uniform integers. Table-game derivations
 * build on this so verifiers only need one primitive.
 */
export function createSeedStream(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): { nextU32: () => number; uniform: (n: number) => number } {
  let chunkIdx = 0;
  let buf: Buffer = Buffer.alloc(0);
  let off = 0;
  function nextU32(): number {
    while (off + 4 > buf.length) {
      const next = crypto
        .createHash("sha256")
        .update(`${serverSeed}:${clientSeed}:${nonce}:${chunkIdx}`)
        .digest();
      buf = Buffer.concat([buf.subarray(off), next]);
      off = 0;
      chunkIdx += 1;
    }
    const v = buf.readUInt32BE(off);
    off += 4;
    return v;
  }
  // Unbiased uniform integer in [0, n) via rejection sampling. A bare `% n`
  // would over-weight the low values of any n that does not divide 2^32 — for
  // roulette that is a measurable house tilt toward the low pockets.
  function uniform(n: number): number {
    if (n <= 0 || !Number.isInteger(n)) throw new Error(`uniform: bad n=${n}`);
    const limit = Math.floor(0x100000000 / n) * n;
    let v: number;
    do {
      v = nextU32();
    } while (v >= limit);
    return v % n;
  }
  return { nextU32, uniform };
}
