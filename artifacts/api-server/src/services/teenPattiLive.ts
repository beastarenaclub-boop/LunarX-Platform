import { storedPayoutVersion } from "@workspace/api-zod/game-economics";
import {
  db,
  teenPattiLiveRoundsTable,
  type TeenPattiLiveRound,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { sha256Hex } from "./rtp";
import {
  deriveTeenPattiDeal,
  TEEN_PATTI_MAX_BETS_PER_DEAL,
  TEEN_PATTI_DECKS,
} from "./teenPatti";
import {
  settleTeenPattiBets,
  type SettledTeenPattiBet,
  type TeenPattiDeal,
} from "./teenPattiMath";

export const TEEN_PATTI_LIVE_GAME_CODE = "teen-patti-live";

// ---------------------------------------------------------------------------
// Teen Patti 20-20 LIVE — the 3D live-dealer table.
//
// This game is a SEPARATE game from the flat Teen Patti 20/20 table: its own
// game code, wallet scope, round clock, config row and history. What it is
// NOT is a second implementation of the rules — dealing, hand ranking, the
// paytable and settlement are imported from the existing teen patti modules,
// so the two tables can never drift apart on the maths.
//
// Fairness model: one deal is shared by the whole table, so the seed tuple
// belongs to the round, not to a player. The round engine commits
// `serverSeedHash` when betting opens, publishes `serverSeed` at reveal, and
// the audit row below stores the exact tuple the cards were dealt from. There
// is deliberately no per-user seed / rotation endpoint here (unlike the flat
// table's instant-play mode): a player-chosen seed cannot influence a deal
// shared with everyone else, so offering one would be a fairness claim the
// engine does not honour.
// ---------------------------------------------------------------------------

/** Same five markets and the same one-bet-per-spot rule as the flat table. */
export const TEEN_PATTI_LIVE_MAX_BETS_PER_ROUND = TEEN_PATTI_MAX_BETS_PER_DEAL;
/** Single deck, shared with the flat table's shuffle. */
export const TEEN_PATTI_LIVE_DECKS = TEEN_PATTI_DECKS;

export interface TeenPattiLivePublicState {
  id: string;
  betId: string;
  handACards: number[];
  handBCards: number[];
  handACategory: string;
  handBCategory: string;
  winner: "playerA" | "playerB" | "tie";
  bets: SettledTeenPattiBet[];
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

/** Derive the round's deal from its committed seed tuple. */
export function deriveTeenPattiLiveDeal(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): TeenPattiDeal {
  return deriveTeenPattiDeal(serverSeed, clientSeed, nonce);
}

// Audit rows only exist for SETTLED rounds, and the round's server seed is
// already public from the reveal phase, so it is always disclosed here.
function publicState(round: TeenPattiLiveRound): TeenPattiLivePublicState {
  return {
    id: round.id,
    betId: round.betId,
    handACards: round.handACards as number[],
    handBCards: round.handBCards as number[],
    handACategory: round.handACategory,
    handBCategory: round.handBCategory,
    winner: round.winner as "playerA" | "playerB" | "tie",
    bets: round.bets as SettledTeenPattiBet[],
    totalStake: round.totalStake.toString(),
    payoutAmount: round.payoutAmount.toString(),
    multiplier: round.multiplier,
    serverSeed: round.serverSeed,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    maxMultiplier: round.maxMultiplier,
    createdAt: round.createdAt.toISOString(),
  };
}

export async function getRawRound(opts: {
  roundId: string;
  userId: string;
}): Promise<TeenPattiLiveRound> {
  const rows = await db
    .select()
    .from(teenPattiLiveRoundsTable)
    .where(eq(teenPattiLiveRoundsTable.id, opts.roundId))
    .limit(1);
  const round = rows[0];
  if (!round) throw new Error("ROUND_NOT_FOUND");
  if (round.userId !== opts.userId) throw new Error("ROUND_NOT_FOUND");
  return round;
}

export async function getRoundForVerify(opts: {
  roundId: string;
  userId: string;
}): Promise<TeenPattiLivePublicState> {
  return publicState(await getRawRound(opts));
}

export async function listRecentRounds(opts: {
  userId: string;
  limit: number;
}): Promise<TeenPattiLivePublicState[]> {
  const cap = Math.min(Math.max(opts.limit, 1), 50);
  const rows = await db
    .select()
    .from(teenPattiLiveRoundsTable)
    .where(eq(teenPattiLiveRoundsTable.userId, opts.userId))
    .orderBy(desc(teenPattiLiveRoundsTable.createdAt))
    .limit(cap);
  return rows.map((r) => publicState(r));
}

export interface TeenPattiLiveVerifyResult {
  computedWinner: "playerA" | "playerB" | "tie";
  computedHandACategory: string;
  computedHandBCategory: string;
  computedPayout: string;
  computedHash: string;
  hashMatch: boolean;
  dealMatch: boolean;
  payoutMatch: boolean;
  verified: boolean;
}

/**
 * Replay a stored deal from its seeds: rehash the server seed, re-deal both
 * hands and re-settle the stored bets with the max multiplier that was
 * snapshotted when the round settled (never with today's config).
 */
export function verifyTeenPattiLiveRound(
  raw: TeenPattiLiveRound,
): TeenPattiLiveVerifyResult {
  const computedHash = sha256Hex(raw.serverSeed);
  const deal = deriveTeenPattiLiveDeal(
    raw.serverSeed,
    raw.clientSeed,
    raw.nonce,
  );
  const storedBets = raw.bets as SettledTeenPattiBet[];
  const { totalPayout } = settleTeenPattiBets(
    storedBets.map((b) => ({
      type: b.type,
      amountPaise: BigInt(b.amountPaise),
    })),
    deal,
    raw.maxMultiplier,
    storedPayoutVersion(raw.bets),
  );
  const hashMatch = computedHash === raw.serverSeedHash;
  const dealMatch =
    JSON.stringify(deal.handACards) === JSON.stringify(raw.handACards) &&
    JSON.stringify(deal.handBCards) === JSON.stringify(raw.handBCards) &&
    deal.winner === raw.winner;
  const payoutMatch = totalPayout === raw.payoutAmount;
  return {
    computedWinner: deal.winner,
    computedHandACategory: deal.handA.category,
    computedHandBCategory: deal.handB.category,
    computedPayout: totalPayout.toString(),
    computedHash,
    hashMatch,
    dealMatch,
    payoutMatch,
    verified: hashMatch && dealMatch && payoutMatch,
  };
}
