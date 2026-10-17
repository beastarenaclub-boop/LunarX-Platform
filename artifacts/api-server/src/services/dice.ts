import {
  db,
  betsTable,
  diceRoundsTable,
  diceUserSeedsTable,
  type DiceRound,
  type DiceDirection,
  type DiceUserSeed,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  requireGameConfig,
  deriveDiceOutcome,
  diceMultiplier,
  diceDidWin,
  sha256Hex,
  generateSeed,
  DICE_MIN_TARGET,
  DICE_MAX_TARGET,
} from "./rtp";
import { placeBet, cashOutBet, settleLoss, refundStake } from "./bets";
import { postEntry } from "./wallet";

export const DICE_GAME_CODE = "dice";

export interface RollDiceInput {
  userId: string;
  stakeAmount: bigint;
  target: number;
  direction: DiceDirection;
  useBonus?: boolean;
}

export interface DicePublicState {
  id: string;
  betId: string;
  stakeAmount: string;
  target: number;
  direction: DiceDirection;
  roll: number;
  didWin: boolean;
  multiplier: number;
  payoutAmount: string;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  houseEdge: number;
  maxMultiplier: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Per-user active seed (precommit/reveal fairness model). Mirrors plinko.
// ---------------------------------------------------------------------------

export interface PublicSeed {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
  createdAt: string;
  lastRotatedAt: string;
}

function publicSeed(row: DiceUserSeed): PublicSeed {
  return {
    serverSeedHash: row.serverSeedHash,
    clientSeed: row.clientSeed,
    nextNonce: row.nextNonce,
    createdAt: row.createdAt.toISOString(),
    lastRotatedAt: row.lastRotatedAt.toISOString(),
  };
}

async function ensureActiveSeed(userId: string): Promise<DiceUserSeed> {
  const existing = await db
    .select()
    .from(diceUserSeedsTable)
    .where(eq(diceUserSeedsTable.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];
  const serverSeed = generateSeed(32);
  const inserted = await db
    .insert(diceUserSeedsTable)
    .values({
      userId,
      serverSeed,
      serverSeedHash: sha256Hex(serverSeed),
      clientSeed: generateSeed(16),
      nextNonce: 0,
    })
    .onConflictDoNothing({ target: diceUserSeedsTable.userId })
    .returning();
  if (inserted[0]) return inserted[0];
  const reread = await db
    .select()
    .from(diceUserSeedsTable)
    .where(eq(diceUserSeedsTable.userId, userId))
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
      .update(diceUserSeedsTable)
      .set({
        serverSeed: fresh,
        serverSeedHash: sha256Hex(fresh),
        clientSeed: freshClient,
        nextNonce: 0,
        lastRotatedAt: now,
      })
      .where(
        and(
          eq(diceUserSeedsTable.userId, userId),
          eq(diceUserSeedsTable.serverSeedHash, current.serverSeedHash),
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
      .update(diceUserSeedsTable)
      .set({ nextNonce: claimedNonce + 1 })
      .where(
        and(
          eq(diceUserSeedsTable.userId, userId),
          eq(diceUserSeedsTable.nextNonce, claimedNonce),
          eq(diceUserSeedsTable.serverSeedHash, seed.serverSeedHash),
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
  round: DiceRound,
  stake: bigint,
  opts: { revealServerSeed?: boolean } = {},
): DicePublicState {
  return {
    id: round.id,
    betId: round.betId,
    stakeAmount: stake.toString(),
    target: round.target,
    direction: round.direction,
    roll: round.roll,
    didWin: round.didWin,
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

async function isSeedRevealable(
  userId: string,
  roundSeedHash: string,
): Promise<boolean> {
  const rows = await db
    .select({ hash: diceUserSeedsTable.serverSeedHash })
    .from(diceUserSeedsTable)
    .where(eq(diceUserSeedsTable.userId, userId))
    .limit(1);
  if (!rows[0]) return true;
  return rows[0].hash !== roundSeedHash;
}

export async function getRawRound(opts: {
  roundId: string;
  userId: string;
}): Promise<DiceRound> {
  const rows = await db
    .select()
    .from(diceRoundsTable)
    .where(eq(diceRoundsTable.id, opts.roundId))
    .limit(1);
  const round = rows[0];
  if (!round) throw new Error("ROUND_NOT_FOUND");
  if (round.userId !== opts.userId) throw new Error("ROUND_NOT_FOUND");
  return round;
}

export async function getRoundForVerify(opts: {
  roundId: string;
  userId: string;
}): Promise<DicePublicState> {
  const rows = await db
    .select()
    .from(diceRoundsTable)
    .where(eq(diceRoundsTable.id, opts.roundId))
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

export async function rollDice(input: RollDiceInput): Promise<DicePublicState> {
  if (
    !Number.isFinite(input.target) ||
    input.target < DICE_MIN_TARGET ||
    input.target > DICE_MAX_TARGET
  ) {
    throw new Error("INVALID_DICE_TARGET");
  }
  if (input.direction !== "over" && input.direction !== "under") {
    throw new Error("INVALID_DICE_DIRECTION");
  }
  const cfg = await requireGameConfig(DICE_GAME_CODE);
  if (!cfg.enabled) throw new Error("GAME_DISABLED");
  if (input.stakeAmount <= 0n) throw new Error("INVALID_STAKE");
  if (input.stakeAmount > cfg.maxStakePaise) throw new Error("STAKE_TOO_LARGE");

  // 1) Debit stake / create bet row.
  const bet = await placeBet({
    userId: input.userId,
    gameCode: DICE_GAME_CODE,
    stakeAmount: input.stakeAmount,
    useBonus: input.useBonus,
  });

  // 2) Claim nonce + derive outcome. Pre-settlement compensation refunds
  //    + voids the bet on any throw between placeBet and successful
  //    settlement (mirrors the plinko model).
  let serverSeed: string;
  let serverSeedHash: string;
  let clientSeed: string;
  let nonce: number;
  let roll: number;
  let multiplier: number;
  let didWin: boolean;
  try {
    const claimed = await claimNonce(input.userId);
    serverSeed = claimed.serverSeed;
    serverSeedHash = claimed.serverSeedHash;
    clientSeed = claimed.clientSeed;
    nonce = claimed.nonce;
    const outcome = deriveDiceOutcome(serverSeed, clientSeed, nonce, {
      houseEdge: cfg.houseEdge,
      maxMultiplier: cfg.maxMultiplier,
    });
    roll = outcome.roll;
    didWin = diceDidWin(roll, input.target, input.direction);
    multiplier = didWin
      ? diceMultiplier({
          target: input.target,
          direction: input.direction,
          houseEdge: cfg.houseEdge,
          maxMultiplier: cfg.maxMultiplier,
        })
      : 0;
  } catch (err) {
    try {
      await refundStake(bet.id, input.userId, input.stakeAmount);
      await db
        .update(betsTable)
        .set({ status: "voided", settledAt: new Date() })
        .where(eq(betsTable.id, bet.id));
    } catch (refundErr) {
      console.error(
        "[dice] refund after pre-settlement failure failed",
        refundErr,
      );
    }
    throw err;
  }

  // 3) Settle through shared bets service. Win → cashOutBet; loss → settleLoss.
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
    try {
      await refundStake(bet.id, input.userId, input.stakeAmount);
      await db
        .update(betsTable)
        .set({ status: "voided", settledAt: new Date() })
        .where(eq(betsTable.id, bet.id));
    } catch (refundErr) {
      console.error("[dice] refund after settlement failure failed", refundErr);
    }
    throw err;
  }

  // 4) Persist round audit row. Failure here is logged only.
  let round: DiceRound | undefined;
  try {
    const inserted = await db
      .insert(diceRoundsTable)
      .values({
        betId: bet.id,
        userId: input.userId,
        serverSeed,
        serverSeedHash,
        clientSeed,
        nonce,
        target: input.target,
        direction: input.direction,
        roll,
        didWin,
        multiplier,
        payoutAmount,
        houseEdge: cfg.houseEdge,
        maxMultiplier: cfg.maxMultiplier,
      })
      .returning();
    round = inserted[0];
  } catch (err) {
    console.error("[dice] failed to persist dice_round (bet already settled)", err);
    return {
      id: `tmp_${bet.id}`,
      betId: bet.id,
      stakeAmount: input.stakeAmount.toString(),
      target: input.target,
      direction: input.direction,
      roll,
      didWin,
      multiplier,
      payoutAmount: payoutAmount.toString(),
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
}): Promise<DicePublicState[]> {
  const cap = Math.min(Math.max(opts.limit, 1), 50);
  const rows = await db
    .select()
    .from(diceRoundsTable)
    .where(eq(diceRoundsTable.userId, opts.userId))
    .orderBy(desc(diceRoundsTable.createdAt))
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
