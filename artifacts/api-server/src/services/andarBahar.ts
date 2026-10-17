import {
  db,
  betsTable,
  andarBaharRoundsTable,
  andarBaharUserSeedsTable,
  type AndarBaharRound,
  type AndarBaharUserSeed,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  requireGameConfig,
  deriveDeckShuffle,
  CARD_GAME_DECKS,
  sha256Hex,
  generateSeed,
} from "./rtp";
import {
  dealAndarBahar,
  settleAndarBaharBets,
  type AndarBaharBetInput,
  type SettledAndarBaharBet,
  type AndarBaharDeal,
  type AndarBaharMainBet,
} from "./andarBaharMath";
import { placeBet, cashOutBet, settleLoss, refundStake } from "./bets";

export const ANDAR_BAHAR_GAME_CODE = "andar-bahar";
export const ANDAR_BAHAR_MAX_BETS_PER_DEAL = 6;
export const ANDAR_BAHAR_DECKS = CARD_GAME_DECKS["andar-bahar"] ?? 1;

export interface DealInput {
  userId: string;
  bets: AndarBaharBetInput[];
}

export interface AndarBaharPublicState {
  id: string;
  betId: string;
  joker: number;
  andarCards: number[];
  baharCards: number[];
  firstSide: AndarBaharMainBet;
  winner: AndarBaharMainBet;
  cardsDealt: number;
  bets: SettledAndarBaharBet[];
  totalStake: string;
  payoutAmount: string;
  multiplier: number;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  maxMultiplier: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Per-user active seed (precommit/reveal fairness model). Mirrors baccarat.
// ---------------------------------------------------------------------------

export interface PublicSeed {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
  createdAt: string;
  lastRotatedAt: string;
}

function publicSeed(row: AndarBaharUserSeed): PublicSeed {
  return {
    serverSeedHash: row.serverSeedHash,
    clientSeed: row.clientSeed,
    nextNonce: row.nextNonce,
    createdAt: row.createdAt.toISOString(),
    lastRotatedAt: row.lastRotatedAt.toISOString(),
  };
}

async function ensureActiveSeed(userId: string): Promise<AndarBaharUserSeed> {
  const existing = await db
    .select()
    .from(andarBaharUserSeedsTable)
    .where(eq(andarBaharUserSeedsTable.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];
  const serverSeed = generateSeed(32);
  const inserted = await db
    .insert(andarBaharUserSeedsTable)
    .values({
      userId,
      serverSeed,
      serverSeedHash: sha256Hex(serverSeed),
      clientSeed: generateSeed(16),
      nextNonce: 0,
    })
    .onConflictDoNothing({ target: andarBaharUserSeedsTable.userId })
    .returning();
  if (inserted[0]) return inserted[0];
  const reread = await db
    .select()
    .from(andarBaharUserSeedsTable)
    .where(eq(andarBaharUserSeedsTable.userId, userId))
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
      .update(andarBaharUserSeedsTable)
      .set({
        serverSeed: fresh,
        serverSeedHash: sha256Hex(fresh),
        clientSeed: freshClient,
        nextNonce: 0,
        lastRotatedAt: now,
      })
      .where(
        and(
          eq(andarBaharUserSeedsTable.userId, userId),
          eq(andarBaharUserSeedsTable.serverSeedHash, current.serverSeedHash),
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
      .update(andarBaharUserSeedsTable)
      .set({ nextNonce: claimedNonce + 1 })
      .where(
        and(
          eq(andarBaharUserSeedsTable.userId, userId),
          eq(andarBaharUserSeedsTable.nextNonce, claimedNonce),
          eq(andarBaharUserSeedsTable.serverSeedHash, seed.serverSeedHash),
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

/** Derive the round for a seed tuple: fresh single-deck shuffle per round. */
export function deriveAndarBaharDeal(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): AndarBaharDeal {
  const { cards } = deriveDeckShuffle(
    serverSeed,
    clientSeed,
    nonce,
    ANDAR_BAHAR_DECKS,
  );
  return dealAndarBahar(cards);
}

function publicState(
  round: AndarBaharRound,
  opts: { revealServerSeed?: boolean } = {},
): AndarBaharPublicState {
  return {
    id: round.id,
    betId: round.betId,
    joker: round.joker,
    andarCards: round.andarCards as number[],
    baharCards: round.baharCards as number[],
    firstSide: round.firstSide as AndarBaharMainBet,
    winner: round.winner as AndarBaharMainBet,
    cardsDealt: round.cardsDealt,
    bets: round.bets as SettledAndarBaharBet[],
    totalStake: round.totalStake.toString(),
    payoutAmount: round.payoutAmount.toString(),
    multiplier: round.multiplier,
    serverSeed: opts.revealServerSeed ? round.serverSeed : null,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    maxMultiplier: round.maxMultiplier,
    createdAt: round.createdAt.toISOString(),
  };
}

async function isSeedRevealable(
  userId: string,
  roundSeedHash: string,
): Promise<boolean> {
  const rows = await db
    .select({ hash: andarBaharUserSeedsTable.serverSeedHash })
    .from(andarBaharUserSeedsTable)
    .where(eq(andarBaharUserSeedsTable.userId, userId))
    .limit(1);
  if (!rows[0]) return true;
  return rows[0].hash !== roundSeedHash;
}

export async function getRawRound(opts: {
  roundId: string;
  userId: string;
}): Promise<AndarBaharRound> {
  const rows = await db
    .select()
    .from(andarBaharRoundsTable)
    .where(eq(andarBaharRoundsTable.id, opts.roundId))
    .limit(1);
  const round = rows[0];
  if (!round) throw new Error("ROUND_NOT_FOUND");
  if (round.userId !== opts.userId) throw new Error("ROUND_NOT_FOUND");
  return round;
}

export async function getRoundForVerify(opts: {
  roundId: string;
  userId: string;
}): Promise<AndarBaharPublicState> {
  const round = await getRawRound(opts);
  const reveal = await isSeedRevealable(opts.userId, round.serverSeedHash);
  return publicState(round, { revealServerSeed: reveal });
}

export async function playAndarBahar(
  input: DealInput,
): Promise<AndarBaharPublicState> {
  if (input.bets.length === 0) throw new Error("NO_BETS");
  if (input.bets.length > ANDAR_BAHAR_MAX_BETS_PER_DEAL) {
    throw new Error("TOO_MANY_BETS");
  }
  // One bet per spot — duplicate types must be merged client-side.
  const seen = new Set<string>();
  for (const b of input.bets) {
    if (seen.has(b.type)) throw new Error("DUPLICATE_BET_TYPE");
    seen.add(b.type);
  }
  const cfg = await requireGameConfig(ANDAR_BAHAR_GAME_CODE);
  if (!cfg.enabled) throw new Error("GAME_DISABLED");

  // Validate every bet BEFORE any money moves — settle against a dummy deal
  // purely for validation + total-stake computation.
  const dummyDeal: AndarBaharDeal = {
    joker: 0,
    andarCards: [1],
    baharCards: [],
    firstSide: "andar",
    winner: "andar",
    cardsDealt: 1,
  };
  const { totalStake } = settleAndarBaharBets(
    input.bets,
    dummyDeal,
    cfg.maxMultiplier,
  );
  if (totalStake <= 0n) throw new Error("INVALID_STAKE");
  if (totalStake > cfg.maxStakePaise) throw new Error("STAKE_TOO_LARGE");

  // 1) Debit total stake / create the aggregate bet row.
  const bet = await placeBet({
    userId: input.userId,
    gameCode: ANDAR_BAHAR_GAME_CODE,
    stakeAmount: totalStake,
  });

  // 2) Claim nonce + derive the deal; refund + void on any throw.
  let serverSeed: string;
  let serverSeedHash: string;
  let clientSeed: string;
  let nonce: number;
  let deal: AndarBaharDeal;
  let settled: SettledAndarBaharBet[];
  let totalPayout: bigint;
  try {
    const claimed = await claimNonce(input.userId);
    serverSeed = claimed.serverSeed;
    serverSeedHash = claimed.serverSeedHash;
    clientSeed = claimed.clientSeed;
    nonce = claimed.nonce;
    deal = deriveAndarBaharDeal(serverSeed, clientSeed, nonce);
    const result = settleAndarBaharBets(input.bets, deal, cfg.maxMultiplier, 2);
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
        "[andar-bahar] refund after pre-settlement failure failed",
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

  // 3) Persist the provably-fair audit row BEFORE the wallet settlement so a
  // settled real-money round always has a durable cards/seeds/bets record.
  // If the settlement below fails we delete this row alongside refund + void.
  const [round] = await db
    .insert(andarBaharRoundsTable)
    .values({
      betId: bet.id,
      userId: input.userId,
      serverSeed,
      serverSeedHash,
      clientSeed,
      nonce,
      joker: deal.joker,
      andarCards: deal.andarCards,
      baharCards: deal.baharCards,
      firstSide: deal.firstSide,
      winner: deal.winner,
      cardsDealt: deal.cardsDealt,
      bets: settled,
      totalStake,
      payoutAmount: totalPayout,
      multiplier: displayMultiplier,
      maxMultiplier: cfg.maxMultiplier,
    })
    .returning()
    .catch(async (err) => {
      // Round record failed — void the wager entirely before any credit.
      try {
        await refundStake(bet.id, input.userId, totalStake);
        await db
          .update(betsTable)
          .set({ status: "voided", settledAt: new Date() })
          .where(eq(betsTable.id, bet.id));
      } catch (refundErr) {
        console.error(
          "[andar-bahar] refund after audit-persist failure failed",
          refundErr,
        );
      }
      throw err;
    });
  if (!round) throw new Error("ROUND_PERSIST_FAILED");

  // 4) Settle through the shared bets service.
  // On failure: delete the audit row, refund the stake, void the bet.
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
      await db
        .delete(andarBaharRoundsTable)
        .where(eq(andarBaharRoundsTable.id, round.id));
      await refundStake(bet.id, input.userId, totalStake);
      await db
        .update(betsTable)
        .set({ status: "voided", settledAt: new Date() })
        .where(eq(betsTable.id, bet.id));
    } catch (refundErr) {
      console.error(
        "[andar-bahar] refund after settlement failure failed",
        refundErr,
      );
    }
    throw err;
  }

  // Sanity: the padded-multiplier credit should reproduce totalPayout
  // exactly; if it ever diverges, reconcile the audit row to the credited
  // amount and log loudly for ops.
  if (payoutAmount !== totalPayout) {
    console.error(
      `[andar-bahar] credited payout ${payoutAmount} != computed ${totalPayout} for round ${round.id}`,
    );
    await db
      .update(andarBaharRoundsTable)
      .set({ payoutAmount })
      .where(eq(andarBaharRoundsTable.id, round.id));
    round.payoutAmount = payoutAmount;
  }
  return publicState(round);
}

export async function listRecentRounds(opts: {
  userId: string;
  limit: number;
}): Promise<AndarBaharPublicState[]> {
  const cap = Math.min(Math.max(opts.limit, 1), 50);
  const rows = await db
    .select()
    .from(andarBaharRoundsTable)
    .where(eq(andarBaharRoundsTable.userId, opts.userId))
    .orderBy(desc(andarBaharRoundsTable.createdAt))
    .limit(cap);
  return rows.map((r) => publicState(r));
}
