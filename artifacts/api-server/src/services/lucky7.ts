import { db, lucky7RoundsTable, type Lucky7Round } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { sha256Hex, deriveLucky7Outcome, type Lucky7Outcome } from "./rtp";
import {
  settleLucky7Bets,
  parseStoredLucky7Bets,
  LUCKY7_MAX_BETS_PER_ROUND,
  type Lucky7BetType,
  type SettledLucky7Bet,
} from "./lucky7Math";

export const LUCKY7_GAME_CODE = "lucky-7";
export { LUCKY7_MAX_BETS_PER_ROUND };

export interface Lucky7PublicState {
  id: string;
  betId: string;
  dice: [number, number];
  total: number;
  result: Lucky7BetType;
  bets: SettledLucky7Bet[];
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
// Fairness model
//
// Lucky 7 is a SHARED server-scheduled table game: one round, one roll, every
// player settles against it. The seed tuple therefore belongs to the round,
// not to a player — the round engine commits `serverSeedHash` when betting
// opens, publishes `serverSeed` at reveal, and the audit row below stores the
// exact tuple the dice were derived from. There is deliberately no per-user
// seed / rotation endpoint here: a player-chosen seed cannot influence a roll
// that is shared with everyone else at the table, so offering one would be a
// fairness claim the engine does not honour.
// ---------------------------------------------------------------------------

/** Derive the round's dice from its committed seed tuple. */
export function deriveLucky7Roll(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): Lucky7Outcome {
  return deriveLucky7Outcome(serverSeed, clientSeed, nonce);
}

// Audit rows only exist for SETTLED rounds, and the round's server seed is
// already public from the reveal phase, so it is always disclosed here.
function publicState(round: Lucky7Round): Lucky7PublicState {
  return {
    id: round.id,
    betId: round.betId,
    dice: [round.die1, round.die2],
    total: round.total,
    result: round.total < 7 ? "under" : round.total > 7 ? "over" : "exactly",
    bets: parseStoredLucky7Bets(round.bets).bets,
    totalStake: round.totalStake.toString(),
    payoutAmount: round.payoutAmount.toString(),
    multiplier: round.multiplier,
    serverSeed: round.serverSeed,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    houseEdge: round.houseEdge,
    maxMultiplier: round.maxMultiplier,
    createdAt: round.createdAt.toISOString(),
  };
}

export async function getRawRound(opts: {
  roundId: string;
  userId: string;
}): Promise<Lucky7Round> {
  const rows = await db
    .select()
    .from(lucky7RoundsTable)
    .where(eq(lucky7RoundsTable.id, opts.roundId))
    .limit(1);
  const round = rows[0];
  if (!round) throw new Error("ROUND_NOT_FOUND");
  if (round.userId !== opts.userId) throw new Error("ROUND_NOT_FOUND");
  return round;
}

export async function getRoundForVerify(opts: {
  roundId: string;
  userId: string;
}): Promise<Lucky7PublicState> {
  return publicState(await getRawRound(opts));
}

export async function listRecentRounds(opts: {
  userId: string;
  limit: number;
}): Promise<Lucky7PublicState[]> {
  const cap = Math.min(Math.max(opts.limit, 1), 50);
  const rows = await db
    .select()
    .from(lucky7RoundsTable)
    .where(eq(lucky7RoundsTable.userId, opts.userId))
    .orderBy(desc(lucky7RoundsTable.createdAt))
    .limit(cap);
  return rows.map((r) => publicState(r));
}

export interface Lucky7VerifyResult {
  computedDice: [number, number];
  computedTotal: number;
  computedResult: Lucky7BetType;
  computedPayout: string;
  computedHash: string;
  hashMatch: boolean;
  rollMatch: boolean;
  payoutMatch: boolean;
  betsMatch: boolean;
  verified: boolean;
}

/**
 * Replay a stored round from its seeds: rehash the server seed, re-roll the
 * dice and re-settle with the stored payout version. Legacy rounds retain
 * their snapshotted house edge and maximum multiplier.
 */
export function verifyLucky7Round(raw: Lucky7Round): Lucky7VerifyResult {
  const computedHash = sha256Hex(raw.serverSeed);
  const roll = deriveLucky7Roll(raw.serverSeed, raw.clientSeed, raw.nonce);
  const { bets: storedBets, payoutVersion } = parseStoredLucky7Bets(raw.bets);
  const { settled, totalPayout } = settleLucky7Bets(
    storedBets.map((b) => ({
      type: b.type,
      amountPaise: BigInt(b.amountPaise),
    })),
    roll,
    raw.houseEdge,
    raw.maxMultiplier,
    payoutVersion,
  );
  const hashMatch = computedHash === raw.serverSeedHash;
  const rollMatch =
    roll.dice[0] === raw.die1 &&
    roll.dice[1] === raw.die2 &&
    roll.total === raw.total;
  const payoutMatch = totalPayout === raw.payoutAmount;
  const betsMatch =
    settled.length === storedBets.length &&
    settled.every(
      (b, i) =>
        b.type === storedBets[i]!.type &&
        b.amountPaise === String(storedBets[i]!.amountPaise) &&
        b.payoutPaise === String(storedBets[i]!.payoutPaise) &&
        b.didWin === storedBets[i]!.didWin,
    );
  return {
    computedDice: roll.dice,
    computedTotal: roll.total,
    computedResult:
      roll.total < 7 ? "under" : roll.total > 7 ? "over" : "exactly",
    computedPayout: totalPayout.toString(),
    computedHash,
    hashMatch,
    rollMatch,
    payoutMatch,
    betsMatch,
    verified: hashMatch && rollMatch && payoutMatch && betsMatch,
  };
}
