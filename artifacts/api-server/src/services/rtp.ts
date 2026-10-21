import crypto from "node:crypto";
import { db, gameConfigTable, gameRoundsTable, type GameConfig } from "@workspace/db";
import { eq } from "drizzle-orm";
import { bus } from "../realtime/eventBus";
import { enqueueWebhook } from "./webhookDispatcher";
import { isRetiredGame } from "../lib/retiredGames";
import { badRequest } from "../lib/errors";
import { BACCARAT_ROUND_TIMING } from "@workspace/api-zod/baccarat-game";

export function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function generateSeed(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

// Bump whenever the crash-derivation formula changes. Each game_rounds row
// stores the version it was generated with so /rounds/:id/verify can
// recompute historical rounds using the exact formula of that era.
// v1: 3% bust + inverse-CDF curve. v2: adds ~18% boosted big rounds.
export const CRASH_DERIVATION_VERSION = 3;

export function deriveCrashPoint(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  houseEdge: number,
  maxMultiplier: number,
  version: number = CRASH_DERIVATION_VERSION,
): number {
  const hash = sha256Hex(`${serverSeed}:${clientSeed}:${nonce}`);
  if (version === 3) {
    const uniform = parseInt(hash.slice(0, 13), 16) / 2 ** 52;
    return Math.max(1, Math.min(maxMultiplier, Math.floor(100 * (1 - houseEdge) / (1 - uniform)) / 100));
  }
  const bustNibble = parseInt(hash.slice(0, 2), 16);
  if (bustNibble < 8) return 1.0;
  // v2+: "Boosted" big rounds: ~18% of rounds sample log-uniform in [8, 150]
  // so 10x+ outcomes appear regularly. Only sound under pari-mutuel
  // settlement (house takes a fixed pool cut regardless of crash point);
  // house_edge mode pays stake*multiplier directly and MUST NOT use this
  // distribution. Deterministic from the same provably-fair hash so client
  // and server always agree.
  const boostByte = parseInt(hash.slice(2, 4), 16);
  if (version >= 2 && boostByte < 46) {
    const r = parseInt(hash.slice(4, 13), 16) / Math.pow(16, 9);
    const boosted = Math.floor(100 * 8 * Math.pow(150 / 8, r)) / 100;
    return Math.min(maxMultiplier, boosted);
  }
  const h = parseInt(hash.slice(0, 13), 16);
  const e = Math.pow(2, 52);
  const edgeFactor = 1 - houseEdge;
  const result = Math.floor((100 * e * edgeFactor - h) / (e - h)) / 100;
  return Math.max(1.0, Math.min(maxMultiplier, result));
}

// ---------------------------------------------------------------------------
// Multi-game derivation contracts
// ---------------------------------------------------------------------------
// Each game has a deterministic outcome derivation function with the same
// shape: `(serverSeed, clientSeed, nonce, config, gameInputs?) -> Outcome`.
// The crash game already has its own derive function above (kept for back
// compat). New games (mines/plinko/dice) declare their outcome types and
// stub functions here so the multi-game scaffolding compiles before the
// per-game tasks fill in the math.

export interface DerivationConfig {
  houseEdge: number;
  maxMultiplier: number;
}

export interface MinesOutcome {
  /** Indexes (0..gridSize-1) of cells that contain a mine. */
  mineIndexes: number[];
}

/**
 * Derive the set of mine cell indexes for a Mines round.
 *
 * Provably-fair construction:
 *   - Generate a deterministic byte stream by hashing
 *     `${serverSeed}:${clientSeed}:${nonce}:${chunk}` for chunk = 0,1,2,...
 *     and reading 4-byte uint32 chunks from each digest.
 *   - Use that stream to drive a Fisher-Yates shuffle of [0..gridSize-1].
 *   - The first `mineCount` indexes after shuffling are the mines (sorted
 *     ascending in the return value for stable persistence/verification).
 *
 * `_config` is accepted for parity with other derive* functions but isn't
 * used: mine placement is uniformly random; the house edge is applied at
 * payout time via the multiplier formula, not via biased placement.
 */
export function deriveMinesOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  _config: DerivationConfig,
  inputs: { gridSize: number; mineCount: number },
): MinesOutcome {
  const { gridSize, mineCount } = inputs;
  if (!Number.isInteger(gridSize) || gridSize <= 1) {
    throw new Error("INVALID_GRID_SIZE");
  }
  if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount >= gridSize) {
    throw new Error("INVALID_MINE_COUNT");
  }

  // Lazy SHA-256 byte stream over chunks of `${serverSeed}:${clientSeed}:${nonce}:${i}`.
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
  // Unbiased uniform integer in [0, n) — reject high values that would skew
  // a naive `% n` mapping. n is small (<= grid size, here 25), so the reject
  // rate is negligible and this stays deterministic given the seed stream.
  function uniform(n: number): number {
    const limit = Math.floor(0x100000000 / n) * n;
    let v;
    do {
      v = nextU32();
    } while (v >= limit);
    return v % n;
  }

  const cells = Array.from({ length: gridSize }, (_, i) => i);
  // Partial Fisher-Yates: only need the first `mineCount` positions.
  for (let i = 0; i < mineCount; i++) {
    const j = i + uniform(gridSize - i);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const mines = cells.slice(0, mineCount).sort((a, b) => a - b);
  return { mineIndexes: mines };
}

/**
 * Mines payout multiplier for `revealedSafe` safe cells out of a grid with
 * `gridSize` total cells and `mineCount` mines, applying the configured
 * house edge.
 *
 * Fair (zero-edge) multiplier = C(N, K) / C(N-M, K), where K = revealedSafe,
 * N = gridSize, M = mineCount.
 *
 * Final multiplier = (1 - houseEdge) * fair, capped to `maxMultiplier`.
 *
 * Returns 1.0 when no safe cells have been revealed (no payout above stake).
 */
export function minesMultiplier(args: {
  payoutVersion?: number;
  gridSize: number;
  mineCount: number;
  revealedSafe: number;
  houseEdge: number;
  maxMultiplier: number;
}): number {
  const { gridSize, mineCount, revealedSafe, houseEdge, maxMultiplier } = args;
  if (revealedSafe <= 0) return 1.0;
  const safeTotal = gridSize - mineCount;
  if (revealedSafe > safeTotal) return maxMultiplier;
  // multiplier = product over k=0..revealedSafe-1 of (gridSize - k) / (safeTotal - k)
  let m = 1;
  for (let k = 0; k < revealedSafe; k++) {
    m *= (gridSize - k) / (safeTotal - k);
  }
  m *= 1 - houseEdge;
  if (!Number.isFinite(m)) return maxMultiplier;
  if (args.payoutVersion === 1 && m < 1) return 1.0;
  return Math.min(maxMultiplier, Math.floor(m * 100) / 100);
}

export interface PlinkoOutcome {
  /** Sequence of pegs (true = right, false = left), length === rows. */
  path: boolean[];
  /** Final bucket index 0..rows. */
  bucket: number;
  /** Multiplier applied to the stake based on bucket + risk + edge. */
  multiplier: number;
}

// Stake-style multiplier tables per (rows, risk). Index is bucket id 0..rows.
// These are baseline multipliers (assume ~3% house edge inherent). We then
// scale them by `(1 - houseEdge) / (1 - 0.03)` so admins can tighten or
// loosen RTP via the houseEdge slider without rewriting the table.
const PLINKO_MULTIPLIERS: Record<
  "low" | "medium" | "high",
  Record<number, number[]>
> = {
  low: {
    8: [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
    12: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
  },
  medium: {
    8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  },
  high: {
    8: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    16: [
      1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000,
    ],
  },
};

export const PLINKO_ROWS_OPTIONS = [8, 12, 16] as const;
export const PLINKO_RISK_OPTIONS = ["low", "medium", "high"] as const;

// Per (rows,risk) baseline EV computed from the binomial bucket distribution
// (each row has prob 0.5 of going right, so bucket k ~ Binomial(rows, 0.5)).
// We must scale against the *actual* baseline EV of each table — using a
// single hard-coded constant produced miscalibrated RTP because the tables'
// true edges vary per (rows,risk). Computing once at module load keeps the
// admin houseEdge slider economically faithful.
function computeBaselineEv(table: number[]): number {
  const n = table.length - 1;
  // Binomial coefficients via Pascal-style multiplicative formula.
  let coef = 1;
  let ev = 0;
  for (let k = 0; k <= n; k++) {
    ev += (coef / Math.pow(2, n)) * (table[k] ?? 0);
    coef = (coef * (n - k)) / (k + 1);
  }
  return ev;
}

const PLINKO_BASELINE_EV: Record<
  "low" | "medium" | "high",
  Record<number, number>
> = (() => {
  const out: Record<string, Record<number, number>> = {};
  for (const risk of PLINKO_RISK_OPTIONS) {
    out[risk] = {};
    for (const rows of PLINKO_ROWS_OPTIONS) {
      out[risk]![rows] = computeBaselineEv(PLINKO_MULTIPLIERS[risk][rows]!);
    }
  }
  return out as Record<"low" | "medium" | "high", Record<number, number>>;
})();

export function plinkoMultiplierTable(
  rows: number,
  risk: "low" | "medium" | "high",
  houseEdge: number,
  maxMultiplier: number,
): number[] {
  const base = PLINKO_MULTIPLIERS[risk]?.[rows];
  if (!base) throw new Error("INVALID_PLINKO_SHAPE");
  // Rescale so the *actual* expected value of the table equals (1-houseEdge).
  // baselineEv is the table's natural EV at 50/50 bit flips — dividing by it
  // first normalizes to RTP=1.0, then we multiply by the desired RTP.
  const baselineEv = PLINKO_BASELINE_EV[risk]?.[rows] ?? 1;
  const targetRtp = Math.max(0, 1 - houseEdge);
  const scale = baselineEv > 0 ? targetRtp / baselineEv : 0;
  return base.map((m) => {
    const scaled = m * scale;
    if (!Number.isFinite(scaled) || scaled < 0) return 0;
    const capped = Math.min(maxMultiplier, scaled);
    return Math.floor(capped * 100) / 100;
  });
}

export function derivePlinkoOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  config: DerivationConfig,
  inputs: { rows: number; risk: "low" | "medium" | "high" },
): PlinkoOutcome {
  const { rows, risk } = inputs;
  if (!PLINKO_ROWS_OPTIONS.includes(rows as 8 | 12 | 16)) {
    throw new Error("INVALID_PLINKO_ROWS");
  }
  if (!PLINKO_RISK_OPTIONS.includes(risk)) {
    throw new Error("INVALID_PLINKO_RISK");
  }
  // Deterministic SHA-256 byte stream identical in shape to the mines
  // derivation: chunked digest of `${serverSeed}:${clientSeed}:${nonce}:${i}`.
  // We consume 1 byte per row and use bit 0 to choose L (0) vs R (1). One
  // bit per row is enough — there's no rejection sampling to worry about.
  let chunkIdx = 0;
  let buf: Buffer = Buffer.alloc(0);
  let off = 0;
  function nextByte(): number {
    while (off >= buf.length) {
      const next = crypto
        .createHash("sha256")
        .update(`${serverSeed}:${clientSeed}:${nonce}:${chunkIdx}`)
        .digest();
      buf = Buffer.concat([buf.subarray(off), next]);
      off = 0;
      chunkIdx += 1;
    }
    const v = buf.readUInt8(off);
    off += 1;
    return v;
  }
  const path: boolean[] = [];
  let bucket = 0;
  for (let i = 0; i < rows; i++) {
    const right = (nextByte() & 1) === 1;
    path.push(right);
    if (right) bucket += 1;
  }
  const table = plinkoMultiplierTable(rows, risk, config.houseEdge, config.maxMultiplier);
  const multiplier = table[bucket] ?? 0;
  return { path, bucket, multiplier };
}

export interface DiceOutcome {
  /** 0.00 – 99.99 inclusive (two decimal precision). */
  roll: number;
}

export const DICE_MIN_TARGET = 0.01;
export const DICE_MAX_TARGET = 99.98;
export const DICE_RANGE = 10000; // 0..9999 → /100 → 0.00..99.99

/**
 * Derive a uniform 0.00..99.99 dice roll from the seed tuple. Uses the same
 * chunked SHA-256 byte stream as mines/plinko: hash
 * `${serverSeed}:${clientSeed}:${nonce}:${i}` for i=0,1,2.. and read 4-byte
 * uint32s. We rejection-sample to remove the modulo bias against 10000, then
 * divide by 100 for the 2-decimal roll.
 */
export function deriveDiceOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  _config: DerivationConfig,
): DiceOutcome {
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
  const limit = Math.floor(0x100000000 / DICE_RANGE) * DICE_RANGE;
  let v: number;
  do {
    v = nextU32();
  } while (v >= limit);
  const roll = (v % DICE_RANGE) / 100;
  return { roll };
}

/**
 * Compute the win chance (in %) for a target/direction pair. Targets are
 * clamped so over-99.98 / under-0.01 are rejected upstream.
 */
export function diceWinChance(
  target: number,
  direction: "over" | "under",
): number {
  if (direction === "over") {
    // Roll must be strictly > target. Range of winning rolls is
    // (target, 99.99] which has ~ (99.99 - target) percentage points.
    return 99.99 - target;
  }
  // direction === "under": roll must be strictly < target.
  return target - 0.0;
}

/**
 * Multiplier applied to the stake when the roll satisfies the bet. Uses the
 * standard provably-fair dice formula: (1 - houseEdge) * 100 / winChance.
 * Capped at the configured maxMultiplier; floor-truncated to 2 decimals.
 */
export function diceMultiplier(args: {
  target: number;
  direction: "over" | "under";
  houseEdge: number;
  maxMultiplier: number;
}): number {
  const chance = diceWinChance(args.target, args.direction);
  if (chance <= 0) return 0;
  const raw = ((1 - args.houseEdge) * 100) / chance;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const capped = Math.min(args.maxMultiplier, raw);
  return Math.floor(capped * 100) / 100;
}

export function diceDidWin(
  roll: number,
  target: number,
  direction: "over" | "under",
): boolean {
  return direction === "over" ? roll > target : roll < target;
}

/**
 * Shared provably-fair byte stream: chunked SHA-256 over
 * `${serverSeed}:${clientSeed}:${nonce}:${i}` (same scheme as mines/plinko/
 * dice) exposing unbiased uniform integers. Table-game derivations build on
 * this so verifiers only need one primitive.
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
  // Unbiased uniform integer in [0, n) via rejection sampling.
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

/**
 * Provably-fair full Fisher–Yates shuffle of `decks` standard 52-card decks.
 * Cards are integers 0..(52*decks - 1); card % 52 gives the canonical card
 * (suit = Math.floor((c % 52) / 13), rank = (c % 52) % 13 where 0=A .. 12=K).
 * Used by baccarat, blackjack, teen-patti and andar-bahar engines.
 */
export interface DeckShuffleOutcome {
  cards: number[];
}
export const MAX_SHOE_DECKS = 8;
export function deriveDeckShuffle(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  decks = 1,
): DeckShuffleOutcome {
  if (!Number.isInteger(decks) || decks < 1 || decks > MAX_SHOE_DECKS) {
    throw new Error(`deriveDeckShuffle: bad decks=${decks}`);
  }
  const stream = createSeedStream(serverSeed, clientSeed, nonce);
  const size = 52 * decks;
  const cards = Array.from({ length: size }, (_, i) => i);
  for (let i = 0; i < size - 1; i++) {
    const j = i + stream.uniform(size - i);
    const tmp = cards[i]!;
    cards[i] = cards[j]!;
    cards[j] = tmp;
  }
  return { cards };
}

/** Provably-fair European roulette spin: pocket 0..36, uniform. */
export interface RouletteOutcome {
  pocket: number;
}
export function deriveRouletteOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): RouletteOutcome {
  const stream = createSeedStream(serverSeed, clientSeed, nonce);
  return { pocket: stream.uniform(37) };
}

/** Provably-fair Sic Bo roll: three uniform dice, each 1..6. */
export interface SicBoOutcome {
  dice: [number, number, number];
}
export function deriveSicBoOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): SicBoOutcome {
  const stream = createSeedStream(serverSeed, clientSeed, nonce);
  return {
    dice: [
      stream.uniform(6) + 1,
      stream.uniform(6) + 1,
      stream.uniform(6) + 1,
    ],
  };
}

/**
 * Provably-fair Lucky 7 (7 Up / 7 Down) roll: two uniform dice, each 1..6.
 * `total` is the sum the under/exactly/over bets settle against.
 */
export interface Lucky7Outcome {
  dice: [number, number];
  total: number;
}
export function deriveLucky7Outcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): Lucky7Outcome {
  const stream = createSeedStream(serverSeed, clientSeed, nonce);
  const d1 = stream.uniform(6) + 1;
  const d2 = stream.uniform(6) + 1;
  return { dice: [d1, d2], total: d1 + d2 };
}

/** Default shoe sizes per card game; engines may override via inputs.decks. */
export const CARD_GAME_DECKS: Readonly<Record<string, number>> = {
  baccarat: 8,
  blackjack: 6,
  "teen-patti": 1,
  "teen-patti-live": 1,
  "andar-bahar": 1,
};

/**
 * Every crash-style (plane) game shares the Lunar crash engine: a per-round
 * precomputed crash multiplier derived from the seed set + house edge. The
 * themed variants differ only in art/branding on the client — settlement
 * math and provably-fair derivation are identical.
 */
export const CRASH_GAME_CODES: ReadonlySet<string> = new Set([
  "lunar",
  "aviator",
  "jetx",
  "fury",
]);

/**
 * Generic outcome derivation dispatcher. Routes to the per-game function
 * based on `gameCode`. Returns `unknown` because each game's outcome shape
 * differs; callers are expected to know which game they're invoking.
 */
export function deriveOutcome(
  gameCode: string,
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  config: DerivationConfig,
  inputs?: Record<string, unknown>,
): unknown {
  if (CRASH_GAME_CODES.has(gameCode)) {
    return deriveCrashPoint(
      serverSeed,
      clientSeed,
      nonce,
      config.houseEdge,
      config.maxMultiplier,
    );
  }
  switch (gameCode) {
    case "lunar":
      return deriveCrashPoint(
        serverSeed,
        clientSeed,
        nonce,
        config.houseEdge,
        config.maxMultiplier,
      );
    case "mines":
      return deriveMinesOutcome(
        serverSeed,
        clientSeed,
        nonce,
        config,
        inputs as { gridSize: number; mineCount: number },
      );
    case "plinko":
      return derivePlinkoOutcome(
        serverSeed,
        clientSeed,
        nonce,
        config,
        inputs as { rows: number; risk: "low" | "medium" | "high" },
      );
    case "dice":
      return deriveDiceOutcome(serverSeed, clientSeed, nonce, config);
    case "roulette":
      return deriveRouletteOutcome(serverSeed, clientSeed, nonce);
    case "sic-bo":
      return deriveSicBoOutcome(serverSeed, clientSeed, nonce);
    case "lucky-7":
      return deriveLucky7Outcome(serverSeed, clientSeed, nonce);
    case "baccarat":
    case "blackjack":
    case "teen-patti":
    case "teen-patti-live":
    case "andar-bahar": {
      const decks =
        typeof inputs?.decks === "number" && inputs.decks > 0
          ? Math.floor(inputs.decks as number)
          : (CARD_GAME_DECKS[gameCode] ?? 1);
      return deriveDeckShuffle(serverSeed, clientSeed, nonce, decks);
    }
    default:
      throw new Error(`Unknown gameCode: ${gameCode}`);
  }
}

// Per-game cache so admin edits to one game don't blow out cached config for
// every other game. TTL is short — admin updates also invalidate explicitly.
const configCache: Map<string, { value: GameConfig; ts: number }> = new Map();
const CACHE_TTL_MS = 30_000;

/**
 * Look up a game's config. Returns `null` when no row exists for `gameCode`.
 *
 * IMPORTANT: this function is read-only and does NOT auto-create rows. The
 * `/game/config/:gameCode/public` route is unauthenticated and any
 * auto-create-on-read fallback would let anonymous callers pollute
 * `game_config` (and worse, the schema default `enabled=true` would surface
 * those phantom games in `/game/registry`). Game rows are only ever inserted
 * by `ensureGameConfigDefaults()` at startup.
 */
export async function getGameConfig(gameCode = "lunar"): Promise<GameConfig | null> {
  const cached = configCache.get(gameCode);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }
  const rows = await db
    .select()
    .from(gameConfigTable)
    .where(eq(gameConfigTable.gameCode, gameCode))
    .limit(1);
  if (rows[0]) {
    if (gameCode === "baccarat") Object.assign(rows[0], BACCARAT_ROUND_TIMING);
    if (isRetiredGame(gameCode)) rows[0].enabled = false;
    configCache.set(gameCode, { value: rows[0], ts: Date.now() });
    return rows[0];
  }
  return null;
}

/**
 * Variant that throws if the game doesn't exist. Use from trusted code paths
 * (services / admin routes) where missing config is a programmer error rather
 * than a 404-able user condition.
 */
export async function requireGameConfig(gameCode: string): Promise<GameConfig> {
  const cfg = await getGameConfig(gameCode);
  if (!cfg) throw new Error(`GAME_NOT_FOUND:${gameCode}`);
  return cfg;
}

export function invalidateConfigCache(gameCode?: string) {
  if (gameCode) configCache.delete(gameCode);
  else configCache.clear();
}

export async function updateGameConfig(
  gameCode: string,
  patch: Partial<
    Pick<
      GameConfig,
      | "rtpMin"
      | "rtpMax"
      | "maxMultiplier"
      | "maxStakePaise"
      | "houseEdge"
      | "enabled"
      | "bettingWindowMs"
      | "turboBettingWindowMs"
      | "interRoundDelayMs"
      | "revealDurationMs"
      | "settleDurationMs"
      | "minStakePaise"
      | "minAutoCashout"
      | "maxAutoCashout"
    >
  >,
  updatedBy: string,
): Promise<GameConfig> {
  if (isRetiredGame(gameCode)) throw badRequest("This game is no longer available.");
  const [updated] = await db
    .update(gameConfigTable)
    .set({ ...patch, ...(gameCode === "baccarat" ? BACCARAT_ROUND_TIMING : {}), updatedBy, updatedAt: new Date() })
    .where(eq(gameConfigTable.gameCode, gameCode))
    .returning();
  invalidateConfigCache(gameCode);
  // Bump the admin metrics topic so dashboards re-fetch per-game KPIs/config.
  bus.publish({
    topic: "admin:metrics",
    type: "bump",
    reason: "game_config_updated",
    ts: Date.now(),
  });
  // Push the full new public config to every client subscribed to this
  // game's config topic so they update in-memory without a REST refetch.
  if (updated) {
    bus.publish({
      topic: `game-config:${updated.gameCode}`,
      type: "updated",
      gameCode: updated.gameCode,
      config: {
        gameCode: updated.gameCode,
        houseEdge: updated.houseEdge,
        maxMultiplier: updated.maxMultiplier,
        enabled: updated.enabled,
        bettingWindowMs: updated.bettingWindowMs,
        turboBettingWindowMs: updated.turboBettingWindowMs,
        interRoundDelayMs: updated.interRoundDelayMs,
        revealDurationMs: updated.revealDurationMs,
        settleDurationMs: updated.settleDurationMs,
        minStakePaise: updated.minStakePaise.toString(),
        minAutoCashout: updated.minAutoCashout,
        maxAutoCashout: updated.maxAutoCashout,
        maxStakePaise: updated.maxStakePaise.toString(),
      },
      ts: Date.now(),
    });
  }
  return updated!;
}

export interface GenerateRoundInput {
  gameCode?: string;
}

export interface RoundSeedSet {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  crashPoint: number;
  houseEdge: number;
  maxMultiplier: number;
  maxStakePaise: bigint;
}

export async function generateRound(input?: GenerateRoundInput): Promise<RoundSeedSet> {
  const gameCode = input?.gameCode ?? "lunar";
  if (isRetiredGame(gameCode)) throw badRequest("This game is no longer available.");
  const config = await requireGameConfig(gameCode);
  const serverSeed = generateSeed(32);
  const serverSeedHash = sha256Hex(serverSeed);
  const clientSeed = generateSeed(16);
  const nonce = Math.floor(Math.random() * 1_000_000);

  // Crash-style precomputed multiplier applies to every crash/plane game;
  // other games derive their own per-bet outcomes via deriveOutcome() and
  // don't need a round-level crash point. We still return one (1.0) so the
  // type stays stable for callers that don't care.
  const crashPoint =
    CRASH_GAME_CODES.has(gameCode)
      ? deriveCrashPoint(
          serverSeed,
          clientSeed,
          nonce,
          config.houseEdge,
          config.maxMultiplier,
        )
      : 1.0;

  return {
    serverSeed,
    serverSeedHash,
    clientSeed,
    nonce,
    crashPoint,
    houseEdge: config.houseEdge,
    maxMultiplier: config.maxMultiplier,
    maxStakePaise: config.maxStakePaise,
  };
}

export async function recordRound(data: {
  gameCode: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  crashPoint: number;
  houseEdge: number;
  maxMultiplier: number;
  totalStake?: bigint;
  totalPayout?: bigint;
  playerCount?: number;
  partnerId?: string | null;
  partnerRoundId?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(gameRoundsTable)
    .values({
      gameCode: data.gameCode,
      serverSeed: data.serverSeed,
      serverSeedHash: data.serverSeedHash,
      clientSeed: data.clientSeed,
      nonce: data.nonce,
      crashPoint: data.crashPoint,
      houseEdge: data.houseEdge,
      maxMultiplier: data.maxMultiplier,
      totalStake: data.totalStake ?? 0n,
      totalPayout: data.totalPayout ?? 0n,
      playerCount: data.playerCount ?? 0,
      partnerId: data.partnerId ?? null,
      partnerRoundId: data.partnerRoundId ?? null,
      derivationVersion: CRASH_DERIVATION_VERSION,
    })
    .returning({ id: gameRoundsTable.id });
  // Authoritative round result broadcast: a single event per persisted round
  // carrying the true crash point. Subscribers (game UI, leaderboards, etc.)
  // can rely on this firing exactly once per round.
  bus.publish({
    topic: "rounds:lunar",
    type: "result",
    roundId: row!.id,
    gameCode: data.gameCode,
    crashMultiplier: data.crashPoint,
    serverSeedHash: data.serverSeedHash,
    clientSeed: data.clientSeed,
    nonce: data.nonce,
    totalStake: (data.totalStake ?? 0n).toString(),
    totalPayout: (data.totalPayout ?? 0n).toString(),
    playerCount: data.playerCount ?? 0,
    ts: Date.now(),
  });
  // Notify the partner (B2B) that a round they own has resolved. We emit
  // this from recordRound because for crash-style games the round is
  // produced and resolved in the same call (server seed + crash point are
  // both known here). Webhook is fire-and-forget; idempotent on eventId.
  if (data.partnerId) {
    void enqueueWebhook({
      partnerId: data.partnerId,
      eventType: "round.completed",
      payload: {
        roundId: row!.id,
        partnerRoundId: data.partnerRoundId,
        gameCode: data.gameCode,
        crashPoint: data.crashPoint,
        serverSeed: data.serverSeed,
        serverSeedHash: data.serverSeedHash,
        clientSeed: data.clientSeed,
        nonce: data.nonce,
        totalStake: (data.totalStake ?? 0n).toString(),
        totalPayout: (data.totalPayout ?? 0n).toString(),
        playerCount: data.playerCount ?? 0,
      },
      eventId: `round.completed.${row!.id}`,
    });
  }
  return row!.id;
}
