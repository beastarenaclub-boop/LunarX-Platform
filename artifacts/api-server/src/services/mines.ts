import crypto from "node:crypto";
import { db, betsTable, minesRoundsTable, type MinesRound } from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  requireGameConfig,
  deriveMinesOutcome,
  minesMultiplier,
  sha256Hex,
  generateSeed,
} from "./rtp";
import { placeBet, cashOutBet, settleLoss, refundStake } from "./bets";
import { postEntry } from "./wallet";

export const MINES_GAME_CODE = "mines";
export const MINES_GRID_SIZE = 25;
export const MIN_MINES = 1;
export const MAX_MINES = 24;

export interface CreateMinesRoundInput {
  userId: string;
  stakeAmount: bigint;
  mineCount: number;
  useBonus?: boolean;
}

export interface MinesPublicState {
  id: string;
  betId: string;
  stakeAmount: string;
  status: MinesRound["status"];
  gridSize: number;
  mineCount: number;
  revealedIndexes: number[];
  // Only present once the round is busted/cashed out (provably-fair reveal).
  mineIndexes: number[] | null;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  multiplier: number;
  nextMultiplier: number;
  maxMultiplier: number;
  payoutAmount: string | null;
  createdAt: string;
  settledAt: string | null;
}

function readJsonArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.filter((x): x is number => typeof x === "number");
  return [];
}

function publicState(round: MinesRound, payoutAmount: bigint | null): MinesPublicState {
  const revealed = readJsonArray(round.revealedIndexes);
  const mines = readJsonArray(round.mineIndexes);
  const settled = round.status !== "active";
  const next = settled
    ? round.multiplier
    : minesMultiplier({
        payoutVersion: round.payoutVersion,
        gridSize: round.gridSize,
        mineCount: round.mineCount,
        revealedSafe: revealed.length + 1,
        houseEdge: round.houseEdge,
        maxMultiplier: round.maxMultiplier,
      });
  return {
    id: round.id,
    betId: round.betId,
    stakeAmount: "0", // filled in by caller (we have it on the bet)
    status: round.status,
    gridSize: round.gridSize,
    mineCount: round.mineCount,
    revealedIndexes: revealed,
    mineIndexes: settled ? mines : null,
    serverSeed: settled ? round.serverSeed : null,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    multiplier: round.multiplier,
    nextMultiplier: next,
    maxMultiplier: round.maxMultiplier,
    payoutAmount: payoutAmount !== null ? payoutAmount.toString() : null,
    createdAt: round.createdAt.toISOString(),
    settledAt: round.settledAt ? round.settledAt.toISOString() : null,
  };
}

async function loadOwned(roundId: string, userId: string) {
  const rows = await db
    .select()
    .from(minesRoundsTable)
    .where(eq(minesRoundsTable.id, roundId))
    .limit(1);
  const round = rows[0];
  if (!round) throw new Error("ROUND_NOT_FOUND");
  if (round.userId !== userId) throw new Error("ROUND_NOT_FOUND");
  return round;
}

async function loadBet(betId: string) {
  const rows = await db.select().from(betsTable).where(eq(betsTable.id, betId)).limit(1);
  return rows[0]!;
}

export async function createRound(input: CreateMinesRoundInput): Promise<MinesPublicState> {
  if (input.mineCount < MIN_MINES || input.mineCount > MAX_MINES) {
    throw new Error("INVALID_MINE_COUNT");
  }
  const cfg = await requireGameConfig(MINES_GAME_CODE);
  if (!cfg.enabled) throw new Error("GAME_DISABLED");
  if (input.stakeAmount <= 0n) throw new Error("INVALID_STAKE");
  if (input.stakeAmount > cfg.maxStakePaise) throw new Error("STAKE_TOO_LARGE");

  // Enforce single-active-round invariant. Without this, a user can place a
  // second round while the first is still active, locking funds in a round
  // that no UI can resume (/active only returns one).
  const existingActive = await db
    .select({ id: minesRoundsTable.id })
    .from(minesRoundsTable)
    .where(and(eq(minesRoundsTable.userId, input.userId), eq(minesRoundsTable.status, "active")))
    .limit(1);
  if (existingActive.length > 0) throw new Error("ACTIVE_ROUND_EXISTS");

  // 1) Place the bet (debits wallet + emits bets:global placed event).
  const bet = await placeBet({
    useBonus: input.useBonus,
    userId: input.userId,
    gameCode: MINES_GAME_CODE,
    stakeAmount: input.stakeAmount,
  });

  // 2) Commit fairness seeds for this round.
  const serverSeed = generateSeed(32);
  const serverSeedHash = sha256Hex(serverSeed);
  const clientSeed = generateSeed(16);
  const nonce = crypto.randomInt(0, 1_000_000_000);

  // 3) Derive mine layout (kept secret until the round settles).
  const { mineIndexes } = deriveMinesOutcome(
    serverSeed,
    clientSeed,
    nonce,
    { houseEdge: cfg.houseEdge, maxMultiplier: cfg.maxMultiplier },
    { gridSize: MINES_GRID_SIZE, mineCount: input.mineCount },
  );

  // 4) Persist the round. If this fails — including via the partial unique
  //    index `mines_rounds_one_active_per_user_idx` (DB-level guarantee that
  //    only one active round per user can exist even under concurrent /place
  //    requests) — we MUST refund the wallet debit + void the bet, otherwise
  //    we'd leave a debited bet with no playable round.
  let round: MinesRound | undefined;
  try {
    const inserted = await db
      .insert(minesRoundsTable)
      .values({
        betId: bet.id,
        userId: input.userId,
        serverSeed,
        serverSeedHash,
        clientSeed,
        nonce,
        gridSize: MINES_GRID_SIZE,
        mineCount: input.mineCount,
        mineIndexes,
        revealedIndexes: [],
        houseEdge: cfg.houseEdge,
        maxMultiplier: cfg.maxMultiplier,
        multiplier: 1,
        status: "active",
      })
      .returning();
    round = inserted[0];
  } catch (err) {
    // Compensating rollback: refund stake + void bet.
    try {
      await refundStake(bet.id, input.userId, input.stakeAmount);
    } catch (refundErr) {
      console.error("[mines] refund failed after round insert failure", refundErr);
    }
    await db
      .update(betsTable)
      .set({ status: "voided", settledAt: new Date() })
      .where(and(eq(betsTable.id, bet.id), eq(betsTable.status, "placed")));
    // Map the unique-violation (race winner=other request) to the same
    // friendly error the application-level pre-check uses. Drizzle wraps
    // the pg error so we have to look at err.cause too.
    const e = err as { code?: string; cause?: { code?: string }; message?: string } | null;
    const pgCode = e?.code ?? e?.cause?.code;
    if (
      pgCode === "23505" ||
      (typeof e?.message === "string" && e.message.includes("mines_rounds_one_active_per_user_idx"))
    ) {
      throw new Error("ACTIVE_ROUND_EXISTS");
    }
    throw err;
  }

  const out = publicState(round!, null);
  out.stakeAmount = bet.stakeAmount.toString();
  return out;
}

export async function reveal(opts: {
  roundId: string;
  userId: string;
  cellIndex: number;
}): Promise<MinesPublicState> {
  const round = await loadOwned(opts.roundId, opts.userId);
  if (round.status !== "active") throw new Error("ROUND_NOT_ACTIVE");
  const cell = opts.cellIndex;
  if (!Number.isInteger(cell) || cell < 0 || cell >= round.gridSize) {
    throw new Error("INVALID_CELL");
  }
  const revealed = readJsonArray(round.revealedIndexes);
  if (revealed.includes(cell)) throw new Error("CELL_ALREADY_REVEALED");
  const mines = readJsonArray(round.mineIndexes);

  const bet = await loadBet(round.betId);
  const isMine = mines.includes(cell);
  const newRevealed = [...revealed, cell];

  if (isMine) {
    // Bust path — race-safe transition to 'busted'. The conditional update
    // also pins the expected reveal count so two concurrent reveals on the
    // same active round can't both succeed and overwrite each other's
    // revealedIndexes. The loser sees rowCount 0 → REVEAL_CONFLICT.
    const [updated] = await db
      .update(minesRoundsTable)
      .set({
        revealedIndexes: newRevealed,
        status: "busted",
        settledAt: new Date(),
      })
      .where(
        and(
          eq(minesRoundsTable.id, round.id),
          eq(minesRoundsTable.status, "active"),
          sql`jsonb_array_length(${minesRoundsTable.revealedIndexes}) = ${revealed.length}`,
        ),
      )
      .returning();
    if (!updated) throw new Error("REVEAL_CONFLICT");
    // settleLoss is itself idempotent + race-safe (conditional update).
    await settleLoss(round.betId, opts.userId, null);
    const out = publicState(updated, 0n);
    out.stakeAmount = bet.stakeAmount.toString();
    return out;
  }

  // Safe — recompute multiplier for next state.
  const newMultiplier = minesMultiplier({
    payoutVersion: round.payoutVersion,
    gridSize: round.gridSize,
    mineCount: round.mineCount,
    revealedSafe: newRevealed.length,
    houseEdge: round.houseEdge,
    maxMultiplier: round.maxMultiplier,
  });

  // If this reveal cleared every safe cell, auto-cashout at the max
  // achievable multiplier so the user can't be stuck with no cells left.
  const safeTotal = round.gridSize - round.mineCount;
  if (newRevealed.length >= safeTotal) {
    // Auto-cashout: claim the round transition first (so concurrent reveals
    // can't both attempt cashOutBet), then settle the bet.
    const [updated] = await db
      .update(minesRoundsTable)
      .set({
        revealedIndexes: newRevealed,
        multiplier: newMultiplier,
        status: "cashed_out",
        settledAt: new Date(),
      })
      .where(
        and(
          eq(minesRoundsTable.id, round.id),
          eq(minesRoundsTable.status, "active"),
          sql`jsonb_array_length(${minesRoundsTable.revealedIndexes}) = ${revealed.length}`,
        ),
      )
      .returning();
    if (!updated) throw new Error("REVEAL_CONFLICT");
    let settled;
    try {
      settled = await cashOutBet({
        betId: round.betId,
        userId: opts.userId,
        multiplier: newMultiplier,
        maxMultiplierCap: round.maxMultiplier,
      });
    } catch (err) {
      // Roll round back to active so user can retry; otherwise round is
      // 'cashed_out' while bet is still 'placed' (irreconcilable split).
      // We restore the prior revealedIndexes too so the auto-cashout guard
      // still triggers on the next attempt.
      await db
        .update(minesRoundsTable)
        .set({ status: "active", settledAt: null, revealedIndexes: revealed, multiplier: round.multiplier })
        .where(
          and(
            eq(minesRoundsTable.id, round.id),
            eq(minesRoundsTable.status, "cashed_out"),
          ),
        );
      throw err;
    }
    const out = publicState(updated, settled.payoutAmount);
    out.stakeAmount = bet.stakeAmount.toString();
    return out;
  }

  // Safe reveal — race-safe progression update.
  const [updated] = await db
    .update(minesRoundsTable)
    .set({ revealedIndexes: newRevealed, multiplier: newMultiplier })
    .where(
      and(
        eq(minesRoundsTable.id, round.id),
        eq(minesRoundsTable.status, "active"),
        sql`jsonb_array_length(${minesRoundsTable.revealedIndexes}) = ${revealed.length}`,
      ),
    )
    .returning();
  if (!updated) throw new Error("REVEAL_CONFLICT");
  const out = publicState(updated, null);
  out.stakeAmount = bet.stakeAmount.toString();
  return out;
}

export async function cashout(opts: {
  roundId: string;
  userId: string;
}): Promise<MinesPublicState> {
  const round = await loadOwned(opts.roundId, opts.userId);
  if (round.status !== "active") throw new Error("ROUND_NOT_ACTIVE");
  const revealed = readJsonArray(round.revealedIndexes);
  if (revealed.length === 0) throw new Error("NO_REVEAL_YET");

  const m = round.multiplier;
  const expectedRevealCount = revealed.length;
  // Claim the round transition atomically before crediting the wallet.
  // We pin BOTH status='active' AND the reveal count we computed `m` from,
  // so a concurrent reveal that advances the multiplier wins the race and
  // our stale cashout fails (REVEAL_CONFLICT) rather than overwriting the
  // higher multiplier with a lower stale value.
  const [updated] = await db
    .update(minesRoundsTable)
    .set({
      multiplier: m,
      status: "cashed_out",
      settledAt: new Date(),
    })
    .where(
      and(
        eq(minesRoundsTable.id, round.id),
        eq(minesRoundsTable.status, "active"),
        sql`jsonb_array_length(${minesRoundsTable.revealedIndexes}) = ${expectedRevealCount}`,
      ),
    )
    .returning();
  if (!updated) throw new Error("REVEAL_CONFLICT");
  let settled;
  try {
    settled = await cashOutBet({
      betId: round.betId,
      userId: opts.userId,
      multiplier: m,
      maxMultiplierCap: round.maxMultiplier,
    });
  } catch (err) {
    // Roll the round back so user can retry; otherwise round is stuck
    // 'cashed_out' while bet is still 'placed' (irreconcilable split state).
    await db
      .update(minesRoundsTable)
      .set({ status: "active", settledAt: null })
      .where(
        and(
          eq(minesRoundsTable.id, round.id),
          eq(minesRoundsTable.status, "cashed_out"),
        ),
      );
    throw err;
  }
  const bet = await loadBet(round.betId);
  const out = publicState(updated, settled.payoutAmount);
  out.stakeAmount = bet.stakeAmount.toString();
  return out;
}

export async function getRound(opts: {
  roundId: string;
  userId: string;
}): Promise<MinesPublicState> {
  const round = await loadOwned(opts.roundId, opts.userId);
  const bet = await loadBet(round.betId);
  const payout = round.status === "cashed_out" ? bet.payoutAmount : round.status === "busted" ? 0n : null;
  const out = publicState(round, payout);
  out.stakeAmount = bet.stakeAmount.toString();
  return out;
}

export async function listRecentRounds(opts: {
  userId: string;
  limit: number;
}): Promise<MinesPublicState[]> {
  const cap = Math.min(Math.max(opts.limit, 1), 50);
  const rows = await db
    .select()
    .from(minesRoundsTable)
    .where(eq(minesRoundsTable.userId, opts.userId))
    .orderBy(desc(minesRoundsTable.createdAt))
    .limit(cap);
  if (rows.length === 0) return [];
  // Batch-load bets so we can attach stakeAmount + payoutAmount per round
  // without N+1 queries (frontend renders the list as a sidebar).
  const betIds = rows.map((r) => r.betId);
  const bets = await db
    .select()
    .from(betsTable)
    .where(inArray(betsTable.id, betIds));
  const betById = new Map(bets.map((b) => [b.id, b]));
  return rows.map((r) => {
    const bet = betById.get(r.betId);
    const payout =
      r.status === "cashed_out" ? (bet?.payoutAmount ?? null) :
      r.status === "busted" ? 0n : null;
    const out = publicState(r, payout);
    out.stakeAmount = bet ? bet.stakeAmount.toString() : "0";
    return out;
  });
}

export async function getActiveRound(opts: {
  userId: string;
}): Promise<MinesPublicState | null> {
  const rows = await db
    .select()
    .from(minesRoundsTable)
    .where(and(eq(minesRoundsTable.userId, opts.userId), eq(minesRoundsTable.status, "active")))
    .orderBy(desc(minesRoundsTable.createdAt))
    .limit(1);
  const active = rows[0];
  if (!active) return null;
  const bet = await loadBet(active.betId);
  const out = publicState(active, null);
  out.stakeAmount = bet.stakeAmount.toString();
  return out;
}
