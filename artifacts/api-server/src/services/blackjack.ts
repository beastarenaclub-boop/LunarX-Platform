import {
  db,
  betsTable,
  blackjackRoundsTable,
  blackjackUserSeedsTable,
  type BlackjackRound,
  type BlackjackUserSeed,
} from "@workspace/db";
import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import {
  requireGameConfig,
  deriveDeckShuffle,
  CARD_GAME_DECKS,
  sha256Hex,
  generateSeed,
} from "./rtp";
import {
  handValue,
  isBlackjack,
  isAce,
  isTenValue,
  cardRank,
  dealerPlay,
  settleRound,
  applyTimeoutStand,
  insuranceStake,
  type BlackjackHand,
  type RoundResults,
} from "./blackjackMath";
import { placeBet, cashOutBet, settleLoss, refundStake } from "./bets";
import { logger } from "../lib/logger";

export const BLACKJACK_GAME_CODE = "blackjack";
export const BLACKJACK_DECKS = CARD_GAME_DECKS["blackjack"] ?? 6;
/** Idle rounds are auto-stood + settled after this long without an action. */
export const BLACKJACK_ACTION_TIMEOUT_MS = 120_000;

export type BlackjackActionName =
  | "hit"
  | "stand"
  | "double"
  | "split"
  | "insurance";

export interface BlackjackPublicHand {
  cards: number[];
  total: number;
  soft: boolean;
  busted: boolean;
  stood: boolean;
  doubled: boolean;
  fromSplit: boolean;
}

export interface BlackjackPublicState {
  id: string;
  status: "insurance" | "active" | "settled";
  hands: BlackjackPublicHand[];
  activeHand: number;
  /** Hole card hidden (null) until the round leaves the player phase. */
  dealerCards: (number | null)[];
  dealerTotal: number | null;
  stakeAmount: string;
  totalStake: string;
  payoutAmount: string;
  insurance: string | null;
  allowedActions: BlackjackActionName[];
  results: RoundResults | null;
  actions: string[];
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  maxMultiplier: number;
  createdAt: string;
  settledAt: string | null;
}

// ---------------------------------------------------------------------------
// Per-user active seed — identical precommit/reveal model to baccarat.
// ---------------------------------------------------------------------------

export interface PublicSeed {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
  createdAt: string;
  lastRotatedAt: string;
}

function publicSeed(row: BlackjackUserSeed): PublicSeed {
  return {
    serverSeedHash: row.serverSeedHash,
    clientSeed: row.clientSeed,
    nextNonce: row.nextNonce,
    createdAt: row.createdAt.toISOString(),
    lastRotatedAt: row.lastRotatedAt.toISOString(),
  };
}

async function ensureActiveSeed(userId: string): Promise<BlackjackUserSeed> {
  const existing = await db
    .select()
    .from(blackjackUserSeedsTable)
    .where(eq(blackjackUserSeedsTable.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];
  const serverSeed = generateSeed(32);
  const inserted = await db
    .insert(blackjackUserSeedsTable)
    .values({
      userId,
      serverSeed,
      serverSeedHash: sha256Hex(serverSeed),
      clientSeed: generateSeed(16),
      nextNonce: 0,
    })
    .onConflictDoNothing({ target: blackjackUserSeedsTable.userId })
    .returning();
  if (inserted[0]) return inserted[0];
  const reread = await db
    .select()
    .from(blackjackUserSeedsTable)
    .where(eq(blackjackUserSeedsTable.userId, userId))
    .limit(1);
  if (!reread[0]) throw new Error("SEED_INIT_FAILED");
  return reread[0];
}

export async function getActiveSeed(userId: string): Promise<PublicSeed> {
  return publicSeed(await ensureActiveSeed(userId));
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
  // Rotation mid-round would leak the shoe of the in-flight hand.
  const open = await findUnsettledRound(userId);
  if (open) throw new Error("ROUND_IN_PROGRESS");
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await ensureActiveSeed(userId);
    const fresh = generateSeed(32);
    const freshClient = newClientSeed?.trim() || generateSeed(16);
    const [swapped] = await db
      .update(blackjackUserSeedsTable)
      .set({
        serverSeed: fresh,
        serverSeedHash: sha256Hex(fresh),
        clientSeed: freshClient,
        nextNonce: 0,
        lastRotatedAt: new Date(),
      })
      .where(
        and(
          eq(blackjackUserSeedsTable.userId, userId),
          eq(blackjackUserSeedsTable.serverSeedHash, current.serverSeedHash),
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
      .update(blackjackUserSeedsTable)
      .set({ nextNonce: claimedNonce + 1 })
      .where(
        and(
          eq(blackjackUserSeedsTable.userId, userId),
          eq(blackjackUserSeedsTable.nextNonce, claimedNonce),
          eq(blackjackUserSeedsTable.serverSeedHash, seed.serverSeedHash),
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

// ---------------------------------------------------------------------------
// Shoe helpers
// ---------------------------------------------------------------------------

export function deriveShoe(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): number[] {
  return deriveDeckShuffle(serverSeed, clientSeed, nonce, BLACKJACK_DECKS)
    .cards;
}

function roundShoe(round: BlackjackRound): number[] {
  return deriveShoe(round.serverSeed, round.clientSeed, round.nonce);
}

// ---------------------------------------------------------------------------
// Public state
// ---------------------------------------------------------------------------

function allowedActionsFor(round: BlackjackRound): BlackjackActionName[] {
  if (round.status === "insurance") return ["insurance"];
  if (round.status !== "active") return [];
  const hands = round.hands as BlackjackHand[];
  const hand = hands[round.activeHand];
  if (!hand) return [];
  const acts: BlackjackActionName[] = ["hit", "stand"];
  if (hand.cards.length === 2 && !hand.doubled) {
    acts.push("double");
    if (
      hands.length === 1 &&
      !hand.fromSplit &&
      cardRank(hand.cards[0]!) === cardRank(hand.cards[1]!)
    ) {
      acts.push("split");
    }
  }
  return acts;
}

function publicState(
  round: BlackjackRound,
  opts: { revealServerSeed?: boolean } = {},
): BlackjackPublicState {
  const hands = (round.hands as BlackjackHand[]).map((h) => {
    const v = handValue(h.cards);
    return {
      cards: h.cards,
      total: v.total,
      soft: v.soft,
      busted: v.busted,
      stood: h.stood,
      doubled: h.doubled,
      fromSplit: h.fromSplit,
    };
  });
  const dealer = round.dealerCards as number[];
  const playerPhase =
    round.status === "insurance" || round.status === "active";
  const dealerCards: (number | null)[] = playerPhase
    ? [dealer[0]!, null]
    : dealer;
  const dealerTotal = playerPhase ? null : handValue(dealer).total;
  return {
    id: round.id,
    status: (round.status === "settling" ? "active" : round.status) as
      | "insurance"
      | "active"
      | "settled",
    hands,
    activeHand: round.activeHand,
    dealerCards,
    dealerTotal,
    stakeAmount: round.stakeAmount.toString(),
    totalStake: round.totalStake.toString(),
    payoutAmount: round.payoutAmount.toString(),
    insurance: round.insurance,
    allowedActions: allowedActionsFor(round),
    results: (round.results as RoundResults | null) ?? null,
    actions: round.actions as string[],
    serverSeed: opts.revealServerSeed ? round.serverSeed : null,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    maxMultiplier: round.maxMultiplier,
    createdAt: round.createdAt.toISOString(),
    settledAt: round.settledAt?.toISOString() ?? null,
  };
}

async function isSeedRevealable(
  userId: string,
  roundSeedHash: string,
): Promise<boolean> {
  const rows = await db
    .select({ hash: blackjackUserSeedsTable.serverSeedHash })
    .from(blackjackUserSeedsTable)
    .where(eq(blackjackUserSeedsTable.userId, userId))
    .limit(1);
  if (!rows[0]) return true;
  return rows[0].hash !== roundSeedHash;
}

// ---------------------------------------------------------------------------
// Round lookup + optimistic-locking update
// ---------------------------------------------------------------------------

async function findUnsettledRound(
  userId: string,
): Promise<BlackjackRound | null> {
  const rows = await db
    .select()
    .from(blackjackRoundsTable)
    .where(
      and(
        eq(blackjackRoundsTable.userId, userId),
        ne(blackjackRoundsTable.status, "settled"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Optimistic concurrency: every mutation is a conditional UPDATE keyed on
 * (id, version). The integer version bumps on every write, so two
 * concurrent actions on the same round can't both win the transition.
 * (Timestamps are unusable as a CAS stamp — Postgres keeps microseconds,
 * JS Dates only milliseconds, so a read-back Date never equals the stored
 * value.)
 */
async function updateRoundCas(
  round: BlackjackRound,
  patch: Partial<{
    status: string;
    hands: unknown;
    activeHand: number;
    dealerCards: unknown;
    drawnCount: number;
    insurance: string | null;
    actions: unknown;
    results: unknown;
    totalStake: bigint;
    payoutAmount: bigint;
    settledAt: Date | null;
  }>,
): Promise<BlackjackRound> {
  const [updated] = await db
    .update(blackjackRoundsTable)
    .set({ ...patch, lastActionAt: new Date(), version: round.version + 1 })
    .where(
      and(
        eq(blackjackRoundsTable.id, round.id),
        eq(blackjackRoundsTable.version, round.version),
      ),
    )
    .returning();
  if (!updated) throw new Error("ROUND_CONFLICT");
  return updated;
}

// ---------------------------------------------------------------------------
// Dealer resolution + wallet settlement
// ---------------------------------------------------------------------------

/**
 * Finish the round: play the dealer (when needed), persist results
 * (status='settling') BEFORE any wallet movement, then settle every bet row
 * idempotently and mark 'settled'. Safe to re-run — a crash mid-settlement
 * leaves status='settling' and the next touch retries only the unsettled
 * bet rows.
 */
async function resolveAndSettle(
  round: BlackjackRound,
): Promise<BlackjackRound> {
  let current = round;
  if (current.status === "insurance" || current.status === "active") {
    const hands = current.hands as BlackjackHand[];
    const shoe = roundShoe(current);
    let drawn = current.drawnCount;
    const draw = (): number => {
      const c = shoe[drawn];
      if (c === undefined) throw new Error("SHOE_EXHAUSTED");
      drawn += 1;
      return c;
    };
    let dealerCards = current.dealerCards as number[];
    const dealerBJ = isBlackjack(dealerCards);
    const anyLive = hands.some((h) => !handValue(h.cards).busted);
    const soloNatural =
      hands.length === 1 && !hands[0]!.fromSplit && isBlackjack(hands[0]!.cards);
    if (anyLive && !dealerBJ && !soloNatural) {
      dealerCards = dealerPlay(dealerCards, draw);
    }
    const { results, totalStake, totalPayout } = settleRound({
      hands,
      dealerCards,
      dealerBlackjack: dealerBJ,
      baseStake: current.stakeAmount,
      payoutVersion: current.payoutVersion,
      insuranceTaken: current.insurance === "taken",
    });
    const actions = [...(current.actions as string[]), "dealer"];
    current = await updateRoundCas(current, {
      status: "settling",
      dealerCards,
      drawnCount: drawn,
      actions,
      results,
      totalStake,
      payoutAmount: totalPayout,
    });
  }
  if (current.status !== "settling") return current;

  // Wallet settlement: each bet row settles at its hand's outcome multiplier.
  // cashOutBet/settleLoss are conditional on status='placed', so re-running
  // after a partial failure is safe (BET_ALREADY_SETTLED is swallowed).
  const results = current.results as RoundResults;
  const hands = current.hands as BlackjackHand[];
  const base = current.stakeAmount;
  const jobs: { betId: string; stake: bigint; ret: bigint }[] = [];
  for (let i = 0; i < hands.length; i++) {
    const r = results.hands[i]!;
    const totalHandReturn = BigInt(r.payoutPaise);
    const perBetRet = hands[i]!.doubled ? totalHandReturn / 2n : totalHandReturn;
    const mainBetId = i === 0 ? current.betId : current.splitBetId;
    if (mainBetId) jobs.push({ betId: mainBetId, stake: base, ret: perBetRet });
    const dblBetId = i === 0 ? current.doubleMainBetId : current.doubleSplitBetId;
    if (hands[i]!.doubled && dblBetId) {
      jobs.push({ betId: dblBetId, stake: base, ret: totalHandReturn - perBetRet });
    }
  }
  if (current.insuranceBetId && results.insurance) {
    const ins = BigInt(results.insurance.stakePaise);
    jobs.push({
      betId: current.insuranceBetId,
      stake: ins,
      ret: BigInt(results.insurance.payoutPaise),
    });
  }
  for (const job of jobs) {
    try {
      if (job.ret > 0n) {
        // Padded multiplier so floor(stake × mult) reproduces ret exactly.
        const mult = Math.min(
          (Number(job.ret) + 0.5) / Number(job.stake),
          current.maxMultiplier,
        );
        await cashOutBet({
          betId: job.betId,
          userId: current.userId,
          multiplier: mult,
          maxMultiplierCap: current.maxMultiplier,
        });
      } else {
        await settleLoss(job.betId, current.userId, 0);
      }
    } catch (err) {
      if ((err as Error).message === "BET_ALREADY_SETTLED") continue;
      logger.error(
        { err, roundId: current.id, betId: job.betId },
        "[blackjack] bet settlement failed — round left in 'settling' for retry",
      );
      throw err;
    }
  }
  return await updateRoundCas(current, {
    status: "settled",
    settledAt: new Date(),
  });
}

/** Auto-stand every live hand of a timed-out round and settle it. */
async function timeoutRound(round: BlackjackRound): Promise<BlackjackRound> {
  let current = round;
  if (current.status === "insurance") {
    current = await updateRoundCas(current, {
      insurance: "declined",
      status: "active",
      actions: [...(current.actions as string[]), "insurance:decline"],
    });
    // Dealer might still have blackjack — resolveAndSettle handles it.
  }
  if (current.status === "active") {
    // Deals any deferred split second card before standing, so settlement
    // never sees a one-card hand and the action log stays replayable.
    const {
      hands,
      actions: standActions,
      drawnCount,
    } = applyTimeoutStand(
      current.hands as BlackjackHand[],
      roundShoe(current),
      current.drawnCount,
    );
    current = await updateRoundCas(current, {
      hands,
      actions: [...(current.actions as string[]), ...standActions],
      drawnCount,
    });
  }
  return resolveAndSettle(current);
}

/**
 * Background sweeper: settles abandoned rounds without waiting for the
 * player to come back. Every pass claims a batch of rounds idle past the
 * action timeout (including crashed 'settling' rounds) and finishes them.
 * Concurrency with a live player action is safe — every transition goes
 * through the version CAS, so one side simply loses with ROUND_CONFLICT.
 */
export function startBlackjackTimeoutSweeper(): void {
  const sweep = async (): Promise<void> => {
    const cutoff = new Date(Date.now() - BLACKJACK_ACTION_TIMEOUT_MS);
    const rows = await db
      .select()
      .from(blackjackRoundsTable)
      .where(
        and(
          inArray(blackjackRoundsTable.status, [
            "insurance",
            "active",
            "settling",
          ]),
          lt(blackjackRoundsTable.lastActionAt, cutoff),
        ),
      )
      .limit(25);
    for (const row of rows) {
      try {
        if (row.status === "settling") await resolveAndSettle(row);
        else await timeoutRound(row);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg !== "ROUND_CONFLICT") {
          logger.warn(
            { err, roundId: row.id },
            "[blackjack] timeout sweep failed for round",
          );
        }
      }
    }
  };
  const timer = setInterval(() => {
    void sweep().catch((err) =>
      logger.error({ err }, "[blackjack] timeout sweeper pass failed"),
    );
  }, 30_000);
  timer.unref?.();
  logger.info("[blackjack] timeout sweeper started");
}

function isTimedOut(round: BlackjackRound): boolean {
  return (
    Date.now() - round.lastActionAt.getTime() > BLACKJACK_ACTION_TIMEOUT_MS
  );
}

/** Fetch the player's active round, applying timeout/settling recovery. */
export async function getActiveRound(
  userId: string,
): Promise<BlackjackPublicState | null> {
  const round = await findUnsettledRound(userId);
  if (!round) return null;
  if (round.status === "settling") {
    return publicState(await resolveAndSettle(round));
  }
  if (isTimedOut(round)) {
    return publicState(await timeoutRound(round));
  }
  return publicState(round);
}

// ---------------------------------------------------------------------------
// Deal
// ---------------------------------------------------------------------------

export async function deal(input: {
  userId: string;
  stakeAmount: bigint;
}): Promise<BlackjackPublicState> {
  const cfg = await requireGameConfig(BLACKJACK_GAME_CODE);
  if (!cfg.enabled) throw new Error("GAME_DISABLED");
  if (input.stakeAmount <= 0n) throw new Error("INVALID_STAKE");
  // Reserve headroom: worst-case wager is split + two doubles + insurance
  // = 4.5× base. Cap the BASE stake against maxStakePaise directly (matches
  // other games' UX); doubles/splits each re-check funds at action time.
  if (input.stakeAmount > cfg.maxStakePaise) throw new Error("STAKE_TOO_LARGE");

  const existing = await findUnsettledRound(input.userId);
  if (existing) {
    if (existing.status === "settling" || isTimedOut(existing)) {
      await (existing.status === "settling"
        ? resolveAndSettle(existing)
        : timeoutRound(existing));
    } else {
      throw new Error("ROUND_IN_PROGRESS");
    }
  }

  // 1) Debit the base stake.
  const bet = await placeBet({
    userId: input.userId,
    gameCode: BLACKJACK_GAME_CODE,
    stakeAmount: input.stakeAmount,
  });

  // 2) Claim nonce, derive shoe, deal. Refund + void on any failure.
  let round: BlackjackRound;
  try {
    const claimed = await claimNonce(input.userId);
    const shoe = deriveShoe(
      claimed.serverSeed,
      claimed.clientSeed,
      claimed.nonce,
    );
    const p1 = shoe[0]!;
    const d1 = shoe[1]!;
    const p2 = shoe[2]!;
    const d2 = shoe[3]!;
    const hands: BlackjackHand[] = [
      {
        cards: [p1, p2],
        stood: false,
        doubled: false,
        busted: false,
        fromSplit: false,
      },
    ];
    const dealerCards = [d1, d2];
    const upAce = isAce(d1);
    const upTen = isTenValue(d1);
    const playerBJ = isBlackjack([p1, p2]);
    // Status decision:
    //  - Ace up → insurance decision first (peek afterwards).
    //  - Ten up → immediate peek; dealer BJ ends the round at once.
    //  - Player natural (no ace up) → round resolves immediately.
    let status: string = "active";
    if (upAce) status = "insurance";
    else if (upTen && isBlackjack(dealerCards)) status = "settling_pending";
    else if (playerBJ) status = "settling_pending";
    const inserted = await db
      .insert(blackjackRoundsTable)
      .values({
        userId: input.userId,
        betId: bet.id,
        serverSeed: claimed.serverSeed,
        serverSeedHash: claimed.serverSeedHash,
        clientSeed: claimed.clientSeed,
        nonce: claimed.nonce,
        status: status === "settling_pending" ? "active" : status,
        stakeAmount: input.stakeAmount,
        hands,
        activeHand: 0,
        dealerCards,
        drawnCount: 4,
        insurance: upAce ? "offered" : null,
        actions: ["deal"],
        results: null,
        totalStake: input.stakeAmount,
        payoutAmount: 0n,
        maxMultiplier: cfg.maxMultiplier,
      })
      .returning()
      .then((r) => r[0]);
    if (!inserted) throw new Error("ROUND_PERSIST_FAILED");
    round = inserted;
    if (status === "settling_pending") {
      round = await resolveAndSettle(round);
    }
  } catch (err) {
    try {
      await refundStake(bet.id, input.userId, input.stakeAmount);
      await db
        .update(betsTable)
        .set({ status: "voided", settledAt: new Date() })
        .where(eq(betsTable.id, bet.id));
    } catch (refundErr) {
      logger.error(
        { err: refundErr, betId: bet.id },
        "[blackjack] refund after deal failure failed",
      );
    }
    throw err;
  }
  return publicState(round);
}

// ---------------------------------------------------------------------------
// Shared table-round integration
// ---------------------------------------------------------------------------

/**
 * Deal a hand INTO a shared table round. The stake was already debited during
 * the betting window (betId provided); the shoe is derived from the ROUND's
 * committed server seed with a per-player client seed so every player at the
 * table gets an independent, verifiable shoe from the same commitment.
 * Naturals resolve immediately; other hands enter insurance/active and are
 * played through the normal action endpoints until the table round's
 * settlement deadline force-finishes them.
 */
export async function dealForTableRound(input: {
  payoutVersion?: number;
  userId: string;
  betId: string;
  stakeAmount: bigint;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  maxMultiplier: number;
}): Promise<BlackjackRound> {
  const shoe = deriveShoe(input.serverSeed, input.clientSeed, input.nonce);
  const p1 = shoe[0]!;
  const d1 = shoe[1]!;
  const p2 = shoe[2]!;
  const d2 = shoe[3]!;
  const hands: BlackjackHand[] = [
    { cards: [p1, p2], stood: false, doubled: false, busted: false, fromSplit: false },
  ];
  const dealerCards = [d1, d2];
  const upAce = isAce(d1);
  const upTen = isTenValue(d1);
  const playerBJ = isBlackjack([p1, p2]);
  let status: string = "active";
  let settleNow = false;
  if (upAce) status = "insurance";
  else if ((upTen && isBlackjack(dealerCards)) || playerBJ) settleNow = true;
  const inserted = await db
    .insert(blackjackRoundsTable)
    .values({
      userId: input.userId,
      betId: input.betId,
      payoutVersion: input.payoutVersion ?? 1,
      serverSeed: input.serverSeed,
      serverSeedHash: input.serverSeedHash,
      clientSeed: input.clientSeed,
      nonce: input.nonce,
      status,
      stakeAmount: input.stakeAmount,
      hands,
      activeHand: 0,
      dealerCards,
      drawnCount: 4,
      insurance: upAce ? "offered" : null,
      actions: ["deal"],
      results: null,
      totalStake: input.stakeAmount,
      payoutAmount: 0n,
      maxMultiplier: input.maxMultiplier,
    })
    .returning()
    .then((r) => r[0]);
  if (!inserted) throw new Error("ROUND_PERSIST_FAILED");
  return settleNow ? await resolveAndSettle(inserted) : inserted;
}

/**
 * Force-finish a set of blackjack rounds (table-round settlement deadline):
 * auto-stand idle hands, play the dealer, settle every linked bet. Returns
 * the final per-round rows (settled) keyed by id. Already-settled rounds are
 * returned as-is; ROUND_CONFLICT (concurrent player action) is retried once
 * with a fresh read.
 */
export async function forceFinishRounds(
  roundIds: string[],
): Promise<Map<string, BlackjackRound>> {
  const out = new Map<string, BlackjackRound>();
  if (roundIds.length === 0) return out;
  const rows = await db
    .select()
    .from(blackjackRoundsTable)
    .where(inArray(blackjackRoundsTable.id, roundIds));
  for (const row of rows) {
    let current = row;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (current.status === "settled") break;
        current =
          current.status === "settling"
            ? await resolveAndSettle(current)
            : await timeoutRound(current);
        break;
      } catch (err) {
        if ((err as Error).message !== "ROUND_CONFLICT") throw err;
        const fresh = await db
          .select()
          .from(blackjackRoundsTable)
          .where(eq(blackjackRoundsTable.id, current.id))
          .limit(1);
        if (!fresh[0]) break;
        current = fresh[0];
      }
    }
    out.set(current.id, current);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

async function requireActionableRound(
  userId: string,
  roundId: string,
): Promise<BlackjackRound> {
  const rows = await db
    .select()
    .from(blackjackRoundsTable)
    .where(eq(blackjackRoundsTable.id, roundId))
    .limit(1);
  const round = rows[0];
  if (!round || round.userId !== userId) throw new Error("ROUND_NOT_FOUND");
  if (round.status === "settled") throw new Error("ROUND_ALREADY_SETTLED");
  if (round.status === "settling") {
    await resolveAndSettle(round);
    throw new Error("ROUND_ALREADY_SETTLED");
  }
  if (isTimedOut(round)) {
    await timeoutRound(round);
    throw new Error("ROUND_TIMED_OUT");
  }
  return round;
}

/**
 * Advance activeHand and commit the move in ONE CAS update (optionally
 * carrying extra fields such as a freshly placed component bet id, so the
 * bet link is atomic with the hand mutation). Returns whether all hands
 * are complete — the CALLER settles outside its refund path, so a
 * settlement failure never triggers a stake refund.
 */
async function commitMove(
  round: BlackjackRound,
  hands: BlackjackHand[],
  actions: string[],
  drawnCount: number,
  extraPatch: Partial<{
    splitBetId: string;
    doubleMainBetId: string;
    doubleSplitBetId: string;
  }> = {},
): Promise<{ round: BlackjackRound; complete: boolean }> {
  let activeHand = round.activeHand;
  const shoe = roundShoe(round);
  let drawn = drawnCount;
  const done = (h: BlackjackHand) => h.stood || h.busted;
  while (activeHand < hands.length && done(hands[activeHand]!)) {
    activeHand += 1;
    // Second split hand receives its deferred second card on activation.
    const nxt = hands[activeHand];
    if (nxt && nxt.cards.length === 1) {
      const c = shoe[drawn];
      if (c === undefined) throw new Error("SHOE_EXHAUSTED");
      nxt.cards.push(c);
      drawn += 1;
    }
  }
  const complete = activeHand >= hands.length;
  const updated = await updateRoundCas(round, {
    hands,
    actions,
    drawnCount: drawn,
    activeHand: complete ? hands.length - 1 : activeHand,
    ...extraPatch,
  } as Parameters<typeof updateRoundCas>[1]);
  return { round: updated, complete };
}

/** Advance activeHand / trigger dealer once the current hand is complete. */
async function advanceOrResolve(
  round: BlackjackRound,
  hands: BlackjackHand[],
  actions: string[],
  drawnCount: number,
): Promise<BlackjackRound> {
  const { round: updated, complete } = await commitMove(
    round,
    hands,
    actions,
    drawnCount,
  );
  return complete ? resolveAndSettle(updated) : updated;
}

export async function actionHit(
  userId: string,
  roundId: string,
): Promise<BlackjackPublicState> {
  const round = await requireActionableRound(userId, roundId);
  if (round.status !== "active") throw new Error("ACTION_NOT_ALLOWED");
  const hands = structuredClone(round.hands as BlackjackHand[]);
  const hand = hands[round.activeHand];
  if (!hand || hand.stood || hand.busted) throw new Error("ACTION_NOT_ALLOWED");
  const shoe = roundShoe(round);
  const c = shoe[round.drawnCount];
  if (c === undefined) throw new Error("SHOE_EXHAUSTED");
  hand.cards.push(c);
  const v = handValue(hand.cards);
  if (v.busted) hand.busted = true;
  else if (v.total === 21) hand.stood = true; // nothing sensible left to do
  const actions = [...(round.actions as string[]), `hit:${round.activeHand}`];
  const updated = await advanceOrResolve(
    round,
    hands,
    actions,
    round.drawnCount + 1,
  );
  return publicState(updated);
}

export async function actionStand(
  userId: string,
  roundId: string,
): Promise<BlackjackPublicState> {
  const round = await requireActionableRound(userId, roundId);
  if (round.status !== "active") throw new Error("ACTION_NOT_ALLOWED");
  const hands = structuredClone(round.hands as BlackjackHand[]);
  const hand = hands[round.activeHand];
  if (!hand || hand.stood || hand.busted) throw new Error("ACTION_NOT_ALLOWED");
  hand.stood = true;
  const actions = [...(round.actions as string[]), `stand:${round.activeHand}`];
  const updated = await advanceOrResolve(round, hands, actions, round.drawnCount);
  return publicState(updated);
}

export async function actionDouble(
  userId: string,
  roundId: string,
): Promise<BlackjackPublicState> {
  const round = await requireActionableRound(userId, roundId);
  if (round.status !== "active") throw new Error("ACTION_NOT_ALLOWED");
  const hands = structuredClone(round.hands as BlackjackHand[]);
  const hi = round.activeHand;
  const hand = hands[hi];
  if (
    !hand ||
    hand.stood ||
    hand.busted ||
    hand.doubled ||
    hand.cards.length !== 2
  ) {
    throw new Error("ACTION_NOT_ALLOWED");
  }
  const dblField = hi === 0 ? "doubleMainBetId" : "doubleSplitBetId";
  if (round[dblField as "doubleMainBetId"]) throw new Error("ACTION_NOT_ALLOWED");
  // Debit the additional stake FIRST — insufficient funds must leave the
  // round untouched.
  const dblBet = await placeBet({
    userId,
    gameCode: BLACKJACK_GAME_CODE,
    stakeAmount: round.stakeAmount,
  });
  // Link + hand mutation happen in ONE CAS update; if it fails the bet was
  // never referenced by the round, so a refund is safe. Settlement runs
  // AFTER the try/catch — its failure leaves the round in 'settling' for
  // idempotent retry, never a refund.
  let committed: { round: BlackjackRound; complete: boolean };
  try {
    const shoe = roundShoe(round);
    const c = shoe[round.drawnCount];
    if (c === undefined) throw new Error("SHOE_EXHAUSTED");
    hand.doubled = true;
    hand.cards.push(c);
    if (handValue(hand.cards).busted) hand.busted = true;
    hand.stood = true;
    const actions = [...(round.actions as string[]), `double:${hi}`];
    committed = await commitMove(round, hands, actions, round.drawnCount + 1, {
      [dblField]: dblBet.id,
    });
  } catch (err) {
    await refundUnlinkedBet(dblBet.id, userId, round.stakeAmount, "double");
    throw err;
  }
  const updated = committed.complete
    ? await resolveAndSettle(committed.round)
    : committed.round;
  return publicState(updated);
}

/**
 * Refund + void a component bet that was debited but never linked to the
 * round (pre-link failure only — a linked bet must always settle via
 * resolveAndSettle instead).
 */
async function refundUnlinkedBet(
  betId: string,
  userId: string,
  stake: bigint,
  label: string,
): Promise<void> {
  try {
    await refundStake(betId, userId, stake);
    await db
      .update(betsTable)
      .set({ status: "voided", settledAt: new Date() })
      .where(eq(betsTable.id, betId));
  } catch (refundErr) {
    logger.error(
      { err: refundErr, betId },
      `[blackjack] ${label} refund failed`,
    );
  }
}

export async function actionSplit(
  userId: string,
  roundId: string,
): Promise<BlackjackPublicState> {
  const round = await requireActionableRound(userId, roundId);
  if (round.status !== "active") throw new Error("ACTION_NOT_ALLOWED");
  if (round.splitBetId) throw new Error("ACTION_NOT_ALLOWED");
  const hands = structuredClone(round.hands as BlackjackHand[]);
  if (hands.length !== 1) throw new Error("ACTION_NOT_ALLOWED");
  const hand = hands[0]!;
  if (
    hand.stood ||
    hand.busted ||
    hand.doubled ||
    hand.cards.length !== 2 ||
    cardRank(hand.cards[0]!) !== cardRank(hand.cards[1]!)
  ) {
    throw new Error("ACTION_NOT_ALLOWED");
  }
  const splitBet = await placeBet({
    userId,
    gameCode: BLACKJACK_GAME_CODE,
    stakeAmount: round.stakeAmount,
  });
  let committed: { round: BlackjackRound; complete: boolean };
  try {
    const shoe = roundShoe(round);
    let drawn = round.drawnCount;
    const draw = (): number => {
      const c = shoe[drawn];
      if (c === undefined) throw new Error("SHOE_EXHAUSTED");
      drawn += 1;
      return c;
    };
    const moved = hand.cards[1]!;
    hand.cards = [hand.cards[0]!];
    hand.fromSplit = true;
    const second: BlackjackHand = {
      cards: [moved],
      stood: false,
      doubled: false,
      busted: false,
      fromSplit: true,
    };
    hands.push(second);
    // First hand's second card arrives immediately; hand 1's on activation.
    hand.cards.push(draw());
    const splitAces = isAce(hand.cards[0]!);
    if (splitAces) {
      hand.stood = true;
      second.cards.push(draw());
      second.stood = true;
    }
    const actions = [...(round.actions as string[]), "split"];
    committed = await commitMove(round, hands, actions, drawn, {
      splitBetId: splitBet.id,
    });
  } catch (err) {
    await refundUnlinkedBet(splitBet.id, userId, round.stakeAmount, "split");
    throw err;
  }
  const updated = committed.complete
    ? await resolveAndSettle(committed.round)
    : committed.round;
  return publicState(updated);
}

export async function actionInsurance(
  userId: string,
  roundId: string,
  take: boolean,
): Promise<BlackjackPublicState> {
  const round = await requireActionableRound(userId, roundId);
  if (round.status !== "insurance" || round.insurance !== "offered") {
    throw new Error("ACTION_NOT_ALLOWED");
  }
  let insuranceBetId: string | null = null;
  if (take) {
    const ins = insuranceStake(round.stakeAmount);
    const bet = await placeBet({
      userId,
      gameCode: BLACKJACK_GAME_CODE,
      stakeAmount: ins,
    });
    insuranceBetId = bet.id;
  }
  const actions = [
    ...(round.actions as string[]),
    take ? "insurance:take" : "insurance:decline",
  ];
  const dealerCards = round.dealerCards as number[];
  const dealerBJ = isBlackjack(dealerCards);
  const hands = round.hands as BlackjackHand[];
  const playerBJ =
    hands.length === 1 && !hands[0]!.fromSplit && isBlackjack(hands[0]!.cards);
  let updated: BlackjackRound;
  try {
    updated = await updateRoundCas(round, {
      status: "active",
      insurance: take ? "taken" : "declined",
      insuranceBetId,
      actions,
    } as never);
  } catch (err) {
    // CAS lost → the insurance bet was never linked; refund is safe.
    if (insuranceBetId) {
      await refundUnlinkedBet(
        insuranceBetId,
        userId,
        insuranceStake(round.stakeAmount),
        "insurance",
      );
    }
    throw err;
  }
  // Peek: dealer blackjack (or an untouchable player natural) ends the
  // round immediately. Settlement failures leave 'settling' for retry —
  // never a refund, the bet is linked now.
  if (dealerBJ || playerBJ) {
    return publicState(await resolveAndSettle(updated));
  }
  return publicState(updated);
}

// ---------------------------------------------------------------------------
// History + verify
// ---------------------------------------------------------------------------

export async function listRecentRounds(opts: {
  userId: string;
  limit: number;
}): Promise<BlackjackPublicState[]> {
  const cap = Math.min(Math.max(opts.limit, 1), 50);
  const rows = await db
    .select()
    .from(blackjackRoundsTable)
    .where(
      and(
        eq(blackjackRoundsTable.userId, opts.userId),
        eq(blackjackRoundsTable.status, "settled"),
      ),
    )
    .orderBy(desc(blackjackRoundsTable.createdAt))
    .limit(cap);
  return rows.map((r) => publicState(r));
}

export async function getRawRound(opts: {
  roundId: string;
  userId: string;
}): Promise<BlackjackRound> {
  const rows = await db
    .select()
    .from(blackjackRoundsTable)
    .where(eq(blackjackRoundsTable.id, opts.roundId))
    .limit(1);
  const round = rows[0];
  if (!round || round.userId !== opts.userId) throw new Error("ROUND_NOT_FOUND");
  return round;
}

export async function getRoundForVerify(opts: {
  roundId: string;
  userId: string;
}): Promise<BlackjackPublicState> {
  const round = await getRawRound(opts);
  const reveal =
    round.status === "settled" &&
    (await isSeedRevealable(opts.userId, round.serverSeedHash));
  return publicState(round, { revealServerSeed: reveal });
}
