import {
  db,
  betsTable,
  plinkoRoundsTable,
  plinkoUserSeedsTable,
  type PlinkoRound,
  type PlinkoRisk,
  type PlinkoUserSeed,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  requireGameConfig,
  derivePlinkoOutcome,
  sha256Hex,
  generateSeed,
  PLINKO_ROWS_OPTIONS,
  PLINKO_RISK_OPTIONS,
} from "./rtp";
import { placeBet, cashOutBet, settleLoss, refundStake } from "./bets";
import { postEntry } from "./wallet";

export const PLINKO_GAME_CODE = "plinko";

export interface DropBallInput {
  userId: string;
  stakeAmount: bigint;
  rows: number;
  risk: PlinkoRisk;
  useBonus?: boolean;
}

export interface PlinkoPublicState {
  id: string;
  betId: string;
  stakeAmount: string;
  rows: number;
  risk: PlinkoRisk;
  path: ("L" | "R")[];
  bucket: number;
  multiplier: number;
  payoutAmount: string;
  // Raw serverSeed is only ever exposed through the /verify endpoint and
  // only after the seed has been rotated (so the user can't predict future
  // outcomes from an unrotated seed). For the standard /drop, /recent,
  // and /:id payloads it is always null.
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  houseEdge: number;
  maxMultiplier: number;
  createdAt: string;
}

function pathToStrings(path: boolean[]): ("L" | "R")[] {
  return path.map((r) => (r ? "R" : "L"));
}

function readPath(v: unknown): ("L" | "R")[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is "L" | "R" => x === "L" || x === "R");
}

// ---------------------------------------------------------------------------
// Per-user active seed (precommit/reveal fairness model).
// ---------------------------------------------------------------------------
// We expose the *hash* of the active server seed before any drop is made
// (GET /seed). Each drop derives from (activeSeed, clientSeed, nextNonce);
// nextNonce increments atomically so concurrent drops never collide on the
// same nonce. The raw serverSeed is only ever revealed when the user rotates
// (POST /seed/rotate), which atomically replaces it with a fresh seed —
// meaning the prior outcomes were committed to a hash the user could have
// recorded BEFORE seeing any of them.

export interface PublicSeed {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
  createdAt: string;
  lastRotatedAt: string;
}

function publicSeed(row: PlinkoUserSeed): PublicSeed {
  return {
    serverSeedHash: row.serverSeedHash,
    clientSeed: row.clientSeed,
    nextNonce: row.nextNonce,
    createdAt: row.createdAt.toISOString(),
    lastRotatedAt: row.lastRotatedAt.toISOString(),
  };
}

async function ensureActiveSeed(userId: string): Promise<PlinkoUserSeed> {
  const existing = await db
    .select()
    .from(plinkoUserSeedsTable)
    .where(eq(plinkoUserSeedsTable.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];
  const serverSeed = generateSeed(32);
  const inserted = await db
    .insert(plinkoUserSeedsTable)
    .values({
      userId,
      serverSeed,
      serverSeedHash: sha256Hex(serverSeed),
      clientSeed: generateSeed(16),
      nextNonce: 0,
    })
    .onConflictDoNothing({ target: plinkoUserSeedsTable.userId })
    .returning();
  if (inserted[0]) return inserted[0];
  // Lost the insert race — re-read.
  const reread = await db
    .select()
    .from(plinkoUserSeedsTable)
    .where(eq(plinkoUserSeedsTable.userId, userId))
    .limit(1);
  if (!reread[0]) throw new Error("SEED_INIT_FAILED");
  return reread[0];
}

export async function getActiveSeed(userId: string): Promise<PublicSeed> {
  const row = await ensureActiveSeed(userId);
  return publicSeed(row);
}

export interface RotateResult {
  revealedServerSeed: string;
  revealedServerSeedHash: string;
  revealedClientSeed: string;
  newSeed: PublicSeed;
}

export async function rotateActiveSeed(
  userId: string,
  newClientSeed?: string,
): Promise<RotateResult> {
  // Make sure a row exists, then atomically swap. We use a conditional
  // UPDATE keyed on the prior hash so concurrent rotations cannot reveal
  // the same seed twice — exactly one wins.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await ensureActiveSeed(userId);
    const fresh = generateSeed(32);
    const freshClient = newClientSeed?.trim() || generateSeed(16);
    const now = new Date();
    const [swapped] = await db
      .update(plinkoUserSeedsTable)
      .set({
        serverSeed: fresh,
        serverSeedHash: sha256Hex(fresh),
        clientSeed: freshClient,
        nextNonce: 0,
        lastRotatedAt: now,
      })
      .where(
        and(
          eq(plinkoUserSeedsTable.userId, userId),
          eq(plinkoUserSeedsTable.serverSeedHash, current.serverSeedHash),
        ),
      )
      .returning();
    if (swapped) {
      return {
        revealedServerSeed: current.serverSeed,
        revealedServerSeedHash: current.serverSeedHash,
        revealedClientSeed: current.clientSeed,
        newSeed: publicSeed(swapped),
      };
    }
  }
  throw new Error("SEED_ROTATE_CONTENDED");
}

/**
 * Atomically claim the next nonce on the user's active seed and return the
 * (seed, clientSeed, nonce) tuple to derive an outcome from. The conditional
 * UPDATE on (userId, nextNonce) makes this race-safe across concurrent
 * drops — exactly one request claims each nonce.
 */
async function claimNonce(userId: string): Promise<{
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const seed = await ensureActiveSeed(userId);
    const claimedNonce = seed.nextNonce;
    const [bumped] = await db
      .update(plinkoUserSeedsTable)
      .set({ nextNonce: claimedNonce + 1 })
      .where(
        and(
          eq(plinkoUserSeedsTable.userId, userId),
          eq(plinkoUserSeedsTable.nextNonce, claimedNonce),
          eq(plinkoUserSeedsTable.serverSeedHash, seed.serverSeedHash),
        ),
      )
      .returning();
    if (bumped) {
      return {
        serverSeed: seed.serverSeed,
        serverSeedHash: seed.serverSeedHash,
        clientSeed: seed.clientSeed,
        nonce: claimedNonce,
      };
    }
  }
  throw new Error("NONCE_CLAIM_CONTENDED");
}

function publicState(
  round: PlinkoRound,
  stake: bigint,
  opts: { revealServerSeed?: boolean } = {},
): PlinkoPublicState {
  return {
    id: round.id,
    betId: round.betId,
    stakeAmount: stake.toString(),
    rows: round.rows,
    risk: round.risk,
    path: readPath(round.path),
    bucket: round.bucket,
    multiplier: round.multiplier,
    payoutAmount: round.payoutAmount.toString(),
    serverSeed: opts.revealServerSeed ? round.serverSeed : null,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    houseEdge: round.houseEdge,
    maxMultiplier: round.maxMultiplier,
    createdAt: round.createdAt.toISOString(),
  };
}

/**
 * Resolve whether the round's server seed has already been rotated (i.e.
 * is no longer the user's active seed). Only after rotation can it be
 * safely revealed — otherwise an attacker could predict every subsequent
 * outcome bound to the same seed/clientSeed pair.
 */
async function isSeedRevealable(
  userId: string,
  roundSeedHash: string,
): Promise<boolean> {
  const rows = await db
    .select({ hash: plinkoUserSeedsTable.serverSeedHash })
    .from(plinkoUserSeedsTable)
    .where(eq(plinkoUserSeedsTable.userId, userId))
    .limit(1);
  // No active seed row → safe to reveal (no future outcomes can use it).
  if (!rows[0]) return true;
  return rows[0].hash !== roundSeedHash;
}

/**
 * Internal-only: return the raw plinko_rounds row including serverSeed.
 * Used by /verify to recompute the outcome server-side. Never echo the
 * full row to clients — pass through `getRoundForVerify` for the public
 * payload so the seed-reveal rule is enforced.
 */
export async function getRawRound(opts: {
  roundId: string;
  userId: string;
}): Promise<PlinkoRound> {
  const rows = await db
    .select()
    .from(plinkoRoundsTable)
    .where(eq(plinkoRoundsTable.id, opts.roundId))
    .limit(1);
  const round = rows[0];
  if (!round) throw new Error("ROUND_NOT_FOUND");
  if (round.userId !== opts.userId) throw new Error("ROUND_NOT_FOUND");
  return round;
}

export async function getRoundForVerify(opts: {
  roundId: string;
  userId: string;
}): Promise<PlinkoPublicState> {
  const rows = await db
    .select()
    .from(plinkoRoundsTable)
    .where(eq(plinkoRoundsTable.id, opts.roundId))
    .limit(1);
  const round = rows[0];
  if (!round) throw new Error("ROUND_NOT_FOUND");
  if (round.userId !== opts.userId) throw new Error("ROUND_NOT_FOUND");
  const betRows = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.id, round.betId))
    .limit(1);
  const bet = betRows[0];
  const reveal = await isSeedRevealable(opts.userId, round.serverSeedHash);
  return publicState(round, bet ? bet.stakeAmount : 0n, {
    revealServerSeed: reveal,
  });
}

export async function dropBall(input: DropBallInput): Promise<PlinkoPublicState> {
  if (!PLINKO_ROWS_OPTIONS.includes(input.rows as 8 | 12 | 16)) {
    throw new Error("INVALID_PLINKO_ROWS");
  }
  if (!PLINKO_RISK_OPTIONS.includes(input.risk)) {
    throw new Error("INVALID_PLINKO_RISK");
  }
  const cfg = await requireGameConfig(PLINKO_GAME_CODE);
  if (!cfg.enabled) throw new Error("GAME_DISABLED");
  if (input.stakeAmount <= 0n) throw new Error("INVALID_STAKE");
  if (input.stakeAmount > cfg.maxStakePaise) throw new Error("STAKE_TOO_LARGE");

  // 1) Debit stake / create bet row.
  const bet = await placeBet({
    userId: input.userId,
    gameCode: PLINKO_GAME_CODE,
    stakeAmount: input.stakeAmount,
    useBonus: input.useBonus,
  });

  // 2) Claim the next nonce on the user's pre-committed active seed and
  //    derive the outcome. The seed hash was exposed via GET /api/plinko/seed
  //    BEFORE this drop, so the user can later prove the outcome was bound
  //    to a hash they could have recorded — and is only revealed on
  //    rotation (or via /verify after rotation).
  //    If anything between placeBet and a successful settlement throws —
  //    including transient nonce-claim contention or a derivation bug — we
  //    must refund + void the bet, otherwise we strand the user's debit
  //    in a permanently-placed orphan bet row. The single try below covers
  //    both the claim and the derivation; the inner try below covers the
  //    settlement itself (which already had its own compensation path).
  let serverSeed: string;
  let serverSeedHash: string;
  let clientSeed: string;
  let nonce: number;
  let path: boolean[];
  let bucket: number;
  let multiplier: number;
  try {
    const claimed = await claimNonce(input.userId);
    serverSeed = claimed.serverSeed;
    serverSeedHash = claimed.serverSeedHash;
    clientSeed = claimed.clientSeed;
    nonce = claimed.nonce;
    const outcome = derivePlinkoOutcome(
      serverSeed,
      clientSeed,
      nonce,
      { houseEdge: cfg.houseEdge, maxMultiplier: cfg.maxMultiplier },
      { rows: input.rows, risk: input.risk },
    );
    path = outcome.path;
    bucket = outcome.bucket;
    multiplier = outcome.multiplier;
  } catch (err) {
    // Pre-settlement failure: compensate the placeBet debit so the user
    // is made whole and the bet doesn't sit forever in 'placed' state.
    try {
      await refundStake(bet.id, input.userId, input.stakeAmount);
      await db
        .update(betsTable)
        .set({ status: "voided", settledAt: new Date() })
        .where(eq(betsTable.id, bet.id));
    } catch (refundErr) {
      console.error(
        "[plinko] refund after pre-settlement failure failed",
        refundErr,
      );
    }
    throw err;
  }

  // 3) Settle the bet first using the shared service. Any mult>0 routes
  //    through cashOutBet so bet.payoutAmount is the single source of truth
  //    for downstream revenue/commission aggregation. mult<1 is still a net
  //    loss (payoutAmount < stakeAmount); mult=0 is a full loss.
  //    Mirroring payoutAmount onto plinko_rounds is for /verify convenience.
  let payoutAmount = 0n;
  try {
    if (multiplier > 0) {
      const settled = await cashOutBet({
        betId: bet.id,
        userId: input.userId,
        multiplier,
        maxMultiplierCap: cfg.maxMultiplier,
      });
      payoutAmount = settled.payoutAmount;
    } else {
      await settleLoss(bet.id, input.userId, multiplier);
      payoutAmount = 0n;
    }
  } catch (err) {
    // Settlement failed catastrophically — refund the stake so we never
    // strand funds in a placed-but-unsettleable bet.
    try {
      await refundStake(bet.id, input.userId, input.stakeAmount);
      await db
        .update(betsTable)
        .set({ status: "voided", settledAt: new Date() })
        .where(eq(betsTable.id, bet.id));
    } catch (refundErr) {
      console.error("[plinko] refund after settlement failure failed", refundErr);
    }
    throw err;
  }

  // 4) Persist the round for /recent + /verify. Failure here is logged but
  //    does NOT roll back the bet — economic state is already final and the
  //    user shouldn't be punished for an audit-row insert problem.
  let round: PlinkoRound | undefined;
  try {
    const inserted = await db
      .insert(plinkoRoundsTable)
      .values({
        betId: bet.id,
        userId: input.userId,
        serverSeed,
        serverSeedHash,
        clientSeed,
        nonce,
        rows: input.rows,
        risk: input.risk,
        path: pathToStrings(path),
        bucket,
        multiplier,
        payoutAmount,
        houseEdge: cfg.houseEdge,
        maxMultiplier: cfg.maxMultiplier,
      })
      .returning();
    round = inserted[0];
  } catch (err) {
    console.error("[plinko] failed to persist plinko_round (bet already settled)", err);
    // Synthesize a transient round object so callers still get a complete
    // response. This will not have a stable id and won't appear in /recent,
    // but the bet is already settled and the wallet is correct.
    return {
      id: `tmp_${bet.id}`,
      betId: bet.id,
      stakeAmount: input.stakeAmount.toString(),
      rows: input.rows,
      risk: input.risk,
      path: pathToStrings(path),
      bucket,
      multiplier,
      payoutAmount: payoutAmount.toString(),
      // Never leak the active seed; it can only be revealed via rotation.
      serverSeed: null,
      serverSeedHash,
      clientSeed,
      nonce,
      houseEdge: cfg.houseEdge,
      maxMultiplier: cfg.maxMultiplier,
      createdAt: new Date().toISOString(),
    };
  }
  return publicState(round!, input.stakeAmount);
}

export async function listRecentRounds(opts: {
  userId: string;
  limit: number;
}): Promise<PlinkoPublicState[]> {
  const cap = Math.min(Math.max(opts.limit, 1), 50);
  const rows = await db
    .select()
    .from(plinkoRoundsTable)
    .where(eq(plinkoRoundsTable.userId, opts.userId))
    .orderBy(desc(plinkoRoundsTable.createdAt))
    .limit(cap);
  if (rows.length === 0) return [];
  const betIds = rows.map((r) => r.betId);
  const bets = await db
    .select()
    .from(betsTable)
    .where(inArray(betsTable.id, betIds));
  const betById = new Map(bets.map((b) => [b.id, b]));
  return rows.map((r) => {
    const bet = betById.get(r.betId);
    const stake = bet ? bet.stakeAmount : 0n;
    return publicState(r, stake);
  });
}

export async function getRound(opts: {
  roundId: string;
  userId: string;
}): Promise<PlinkoPublicState> {
  const rows = await db
    .select()
    .from(plinkoRoundsTable)
    .where(eq(plinkoRoundsTable.id, opts.roundId))
    .limit(1);
  const round = rows[0];
  if (!round) throw new Error("ROUND_NOT_FOUND");
  if (round.userId !== opts.userId) throw new Error("ROUND_NOT_FOUND");
  const betRows = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.id, round.betId))
    .limit(1);
  const bet = betRows[0];
  return publicState(round, bet ? bet.stakeAmount : 0n);
}
