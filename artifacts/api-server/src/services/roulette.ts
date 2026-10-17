import {
  db,
  betsTable,
  rouletteRoundsTable,
  rouletteUserSeedsTable,
  type RouletteRound,
  type RouletteUserSeed,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  requireGameConfig,
  deriveRouletteOutcome,
  sha256Hex,
  generateSeed,
} from "./rtp";
import {
  settleRouletteBets,
  ROULETTE_PAYOUT_BASE,
  type RouletteBetInput,
  type SettledRouletteBet,
} from "./rouletteMath";

/** Shape stored in the roulette_rounds.bets JSONB column (current format). */
export interface StoredRouletteBets {
  payoutBase: number;
  bets: SettledRouletteBet[];
}

/**
 * Parse the JSONB bets column. Handles both the legacy bare-array format
 * (rounds settled before payoutBase tracking — default 36) and the current
 * { payoutBase, bets } wrapper. Used by publicState and the verify endpoint.
 */
export function parseStoredBets(raw: unknown): StoredRouletteBets {
  if (Array.isArray(raw)) {
    // Legacy: bets stored as plain array (payoutBase was implicitly 36)
    return { payoutBase: 36, bets: raw as SettledRouletteBet[] };
  }
  const obj = raw as Partial<StoredRouletteBets>;
  return { payoutBase: obj.payoutBase ?? 36, bets: obj.bets ?? [] };
}
import { placeBet, cashOutBet, settleLoss, refundStake } from "./bets";
import { bus } from "../realtime/eventBus";

export const ROULETTE_GAME_CODE = "roulette";
export const ROULETTE_MAX_BETS_PER_SPIN = 40;

export interface SpinInput {
  userId: string;
  bets: RouletteBetInput[];
}

export interface RoulettePublicState {
  id: string;
  betId: string;
  pocket: number;
  bets: SettledRouletteBet[];
  totalStake: string;
  payoutAmount: string;
  multiplier: number;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  houseEdge: number;
  maxMultiplier: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Per-user active seed (precommit/reveal fairness model). Mirrors dice.
// ---------------------------------------------------------------------------

export interface PublicSeed {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
  createdAt: string;
  lastRotatedAt: string;
}

function publicSeed(row: RouletteUserSeed): PublicSeed {
  return {
    serverSeedHash: row.serverSeedHash,
    clientSeed: row.clientSeed,
    nextNonce: row.nextNonce,
    createdAt: row.createdAt.toISOString(),
    lastRotatedAt: row.lastRotatedAt.toISOString(),
  };
}

async function ensureActiveSeed(userId: string): Promise<RouletteUserSeed> {
  const existing = await db
    .select()
    .from(rouletteUserSeedsTable)
    .where(eq(rouletteUserSeedsTable.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];
  const serverSeed = generateSeed(32);
  const inserted = await db
    .insert(rouletteUserSeedsTable)
    .values({
      userId,
      serverSeed,
      serverSeedHash: sha256Hex(serverSeed),
      clientSeed: generateSeed(16),
      nextNonce: 0,
    })
    .onConflictDoNothing({ target: rouletteUserSeedsTable.userId })
    .returning();
  if (inserted[0]) return inserted[0];
  const reread = await db
    .select()
    .from(rouletteUserSeedsTable)
    .where(eq(rouletteUserSeedsTable.userId, userId))
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
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await ensureActiveSeed(userId);
    const fresh = generateSeed(32);
    const freshClient = newClientSeed?.trim() || generateSeed(16);
    const now = new Date();
    const [swapped] = await db
      .update(rouletteUserSeedsTable)
      .set({
        serverSeed: fresh,
        serverSeedHash: sha256Hex(fresh),
        clientSeed: freshClient,
        nextNonce: 0,
        lastRotatedAt: now,
      })
      .where(
        and(
          eq(rouletteUserSeedsTable.userId, userId),
          eq(rouletteUserSeedsTable.serverSeedHash, current.serverSeedHash),
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
      .update(rouletteUserSeedsTable)
      .set({ nextNonce: claimedNonce + 1 })
      .where(
        and(
          eq(rouletteUserSeedsTable.userId, userId),
          eq(rouletteUserSeedsTable.nextNonce, claimedNonce),
          eq(rouletteUserSeedsTable.serverSeedHash, seed.serverSeedHash),
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
  round: RouletteRound,
  opts: { revealServerSeed?: boolean } = {},
): RoulettePublicState {
  return {
    id: round.id,
    betId: round.betId,
    pocket: round.pocket,
    bets: parseStoredBets(round.bets).bets,
    totalStake: round.totalStake.toString(),
    payoutAmount: round.payoutAmount.toString(),
    multiplier: round.multiplier,
    serverSeed: opts.revealServerSeed ? round.serverSeed : null,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    houseEdge: round.houseEdge,
    maxMultiplier: round.maxMultiplier,
    createdAt: round.createdAt.toISOString(),
  };
}

async function isSeedRevealable(
  userId: string,
  roundSeedHash: string,
): Promise<boolean> {
  const rows = await db
    .select({ hash: rouletteUserSeedsTable.serverSeedHash })
    .from(rouletteUserSeedsTable)
    .where(eq(rouletteUserSeedsTable.userId, userId))
    .limit(1);
  if (!rows[0]) return true;
  return rows[0].hash !== roundSeedHash;
}

export async function getRawRound(opts: {
  roundId: string;
  userId: string;
}): Promise<RouletteRound> {
  const rows = await db
    .select()
    .from(rouletteRoundsTable)
    .where(eq(rouletteRoundsTable.id, opts.roundId))
    .limit(1);
  const round = rows[0];
  if (!round) throw new Error("ROUND_NOT_FOUND");
  if (round.userId !== opts.userId) throw new Error("ROUND_NOT_FOUND");
  return round;
}

export async function getRoundForVerify(opts: {
  roundId: string;
  userId: string;
}): Promise<RoulettePublicState> {
  const round = await getRawRound(opts);
  const reveal = await isSeedRevealable(opts.userId, round.serverSeedHash);
  return publicState(round, { revealServerSeed: reveal });
}

export async function spinRoulette(
  input: SpinInput,
): Promise<RoulettePublicState> {
  if (input.bets.length === 0) throw new Error("NO_BETS");
  if (input.bets.length > ROULETTE_MAX_BETS_PER_SPIN) {
    throw new Error("TOO_MANY_BETS");
  }
  const cfg = await requireGameConfig(ROULETTE_GAME_CODE);
  if (!cfg.enabled) throw new Error("GAME_DISABLED");

  // Validate every bet BEFORE any money moves — settle against a dummy
  // pocket purely for validation + total-stake computation.
  const { totalStake } = settleRouletteBets(
    input.bets,
    0,
    cfg.maxMultiplier,
  );
  if (totalStake <= 0n) throw new Error("INVALID_STAKE");
  if (totalStake > cfg.maxStakePaise) throw new Error("STAKE_TOO_LARGE");

  // 1) Debit total stake / create the aggregate bet row.
  const bet = await placeBet({
    userId: input.userId,
    gameCode: ROULETTE_GAME_CODE,
    stakeAmount: totalStake,
  });

  // 2) Claim nonce + derive outcome; refund + void on any pre-settlement throw.
  let serverSeed: string;
  let serverSeedHash: string;
  let clientSeed: string;
  let nonce: number;
  let pocket: number;
  let settled: SettledRouletteBet[];
  let totalPayout: bigint;
  try {
    const claimed = await claimNonce(input.userId);
    serverSeed = claimed.serverSeed;
    serverSeedHash = claimed.serverSeedHash;
    clientSeed = claimed.clientSeed;
    nonce = claimed.nonce;
    pocket = deriveRouletteOutcome(serverSeed, clientSeed, nonce).pocket;
    const result = settleRouletteBets(
      input.bets,
      pocket,
      cfg.maxMultiplier,
    );
    settled = result.settled;
    totalPayout = result.totalPayout;
  } catch (err) {
    try {
      await refundStake(bet.id, input.userId, totalStake);
      await db
        .update(betsTable)
        .set({ status: "voided", settledAt: new Date() })
        .where(eq(betsTable.id, bet.id));
    } catch (refundErr) {
      console.error(
        "[roulette] refund after pre-settlement failure failed",
        refundErr,
      );
    }
    throw err;
  }

  // Aggregate multiplier used for display/history. For the wallet credit we
  // pass a slightly padded multiplier so cashOutBet's floor(stake × mult)
  // reproduces totalPayout exactly (float division alone can lose 1 paise).
  const displayMultiplier =
    Math.round((Number(totalPayout) / Number(totalStake)) * 100) / 100;

  // 3) Settle through the shared bets service.
  let payoutAmount = 0n;
  try {
    if (totalPayout > 0n) {
      const creditMultiplier = Math.min(
        (Number(totalPayout) + 0.5) / Number(totalStake),
        cfg.maxMultiplier,
      );
      const out = await cashOutBet({
        betId: bet.id,
        userId: input.userId,
        multiplier: creditMultiplier,
        maxMultiplierCap: cfg.maxMultiplier,
      });
      payoutAmount = out.payoutAmount;
    } else {
      await settleLoss(bet.id, input.userId, 0);
      payoutAmount = 0n;
    }
  } catch (err) {
    try {
      await refundStake(bet.id, input.userId, totalStake);
      await db
        .update(betsTable)
        .set({ status: "voided", settledAt: new Date() })
        .where(eq(betsTable.id, bet.id));
    } catch (refundErr) {
      console.error(
        "[roulette] refund after settlement failure failed",
        refundErr,
      );
    }
    throw err;
  }

  // 4) Persist the audit row. Failure here is logged only — the bet settled.
  let round: RouletteRound | undefined;
  // Strictly anonymous broadcast — pocket + opaque round id only. Never
  // include identity- or stake-derived data on this public topic.
  const broadcast = (roundId: string) => {
    bus.publish({
      topic: "rounds:roulette",
      type: "result",
      roundId,
      pocket,
      ts: Date.now(),
    });
  };
  try {
    const inserted = await db
      .insert(rouletteRoundsTable)
      .values({
        betId: bet.id,
        userId: input.userId,
        serverSeed,
        serverSeedHash,
        clientSeed,
        nonce,
        pocket,
        bets: { payoutBase: ROULETTE_PAYOUT_BASE, bets: settled },
        totalStake,
        payoutAmount,
        multiplier: displayMultiplier,
        houseEdge: cfg.houseEdge,
        maxMultiplier: cfg.maxMultiplier,
      })
      .returning();
    round = inserted[0];
  } catch (err) {
    console.error(
      "[roulette] failed to persist roulette_round (bet already settled)",
      err,
    );
    broadcast(`tmp_${bet.id}`);
    return {
      id: `tmp_${bet.id}`,
      betId: bet.id,
      pocket,
      bets: settled,
      totalStake: totalStake.toString(),
      payoutAmount: payoutAmount.toString(),
      multiplier: displayMultiplier,
      serverSeed: null,
      serverSeedHash,
      clientSeed,
      nonce,
      houseEdge: cfg.houseEdge,
      maxMultiplier: cfg.maxMultiplier,
      createdAt: new Date().toISOString(),
    };
    // (fallback when round row insert fails — bet already settled)
  }
  broadcast(round!.id);
  return publicState(round!);
}

export interface PublicPocket {
  id: string;
  pocket: number;
  createdAt: string;
}

/** Last N settled pockets across ALL users — strictly anonymous. */
export async function listRecentPockets(limit: number): Promise<PublicPocket[]> {
  const cap = Math.min(Math.max(limit, 1), 100);
  const rows = await db
    .select({
      id: rouletteRoundsTable.id,
      pocket: rouletteRoundsTable.pocket,
      createdAt: rouletteRoundsTable.createdAt,
    })
    .from(rouletteRoundsTable)
    .orderBy(desc(rouletteRoundsTable.createdAt))
    .limit(cap);
  return rows.map((r) => ({
    id: r.id,
    pocket: r.pocket,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listRecentRounds(opts: {
  userId: string;
  limit: number;
}): Promise<RoulettePublicState[]> {
  const cap = Math.min(Math.max(opts.limit, 1), 50);
  const rows = await db
    .select()
    .from(rouletteRoundsTable)
    .where(eq(rouletteRoundsTable.userId, opts.userId))
    .orderBy(desc(rouletteRoundsTable.createdAt))
    .limit(cap);
  return rows.map((r) => publicState(r));
}
