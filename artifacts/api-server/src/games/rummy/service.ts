/**
 * Rummy Royale — the server's table.
 *
 * One player, three computer seats, real money: the entry is a `bets` row
 * (`placeBet`, so partner wallets, bonus rules and the ledger are the
 * platform's), the table is a `rummy_rounds` row, and the round settles when
 * the player declares, a computer seat declares, the stock runs out or the
 * turn cap is reached. The computer seats act SYNCHRONOUSLY inside the request
 * that hands them the turn and their moves come back as `frames` for the
 * client to animate; the client never decides anything.
 *
 * THE DEAL IS STEERED. `decideOutcomeFor` picks the deal from a handful of
 * candidates classified by a bot-vs-bot play-out (`sim.ts`), under the same
 * engine, modes, bank and forces as the tables — on the stream
 * `rummy#<partner>` (the stream OWNER's, for a partner sharing streams). What
 * is steered is the hand the player is dealt; settlement is what really
 * happened at the table, which is why a forced "you" can still be lost by a
 * player who plays badly and won by one who plays well against "computer".
 *
 * A turn the player has not taken within TURN_MS is played for them by the
 * computer policy — checked on their next request, never by a sweeper (mines'
 * shape): a table nobody comes back to is caught up, one missed turn per
 * elapsed window, the moment its owner (or `/active`) looks at it again.
 */
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import { db, betsTable, rummyRoundsTable, type RummyRound } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { generateSeed, sha256Hex } from "../../services/rtp";
import { getGameConfig } from "../../services/rtp";
import { placeBet, cashOutBet, settleLoss, refundStake } from "../../services/bets";
import { decideOutcomeFor, settleBank } from "../../services/resultEngine/engine";

import { streamKey, parseStreamKey } from "../../lib/crashStream";
const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505";
import { logger } from "../../lib/logger";
import {
  analyzeHand,
  autoStep,
  discardCard,
  drawCard,
  dropPlayer,
  isWild,
  type Card,
  type TableState,
} from "./rules";
import { deriveDeal, isDeal, rummyOutcomeSpace, tableFromDeal, type RummyDeal } from "./sim";
import { payoutPaise, payouts, type RummyClass } from "./math";

export const RUMMY_GAME_CODE = "rummy-royale";
/** How long the player has for a turn before the computer plays it for them. */
export const TURN_MS = 20_000;

export interface CreateRummyRoundInput {
  userId: string;
  /** Straight off `req.session` via `tableBetPartnerContext` — handed to `placeBet` UNTOUCHED (see mines). */
  partnerId?: string | null;
  partnerPlayerRef?: string | null;
  partnerSessionId?: string | null;
  stakeAmount: bigint;
  useBonus?: boolean;
  displayName?: string | null;
}

export interface RummyPublicSeat {
  name: string;
  cards: number;
  folded: boolean;
  /** Revealed once the round is over. */
  hand?: Card[];
}

/**
 * The table as the PLAYER may see it: their own hand, everyone's card count,
 * the piles' faces and sizes — never a computer seat's hand or the stock's
 * order until the round is over.
 */
export interface RummyTableView {
  phase: TableState["phase"];
  seats: RummyPublicSeat[];
  hand: Card[];
  stockCount: number;
  discard: Card[];
  indicator: Card | null;
  wild: number;
  current: number;
  step: TableState["step"];
  drawnFromOpen: string | null;
  turns: number;
  message: string;
  result: {
    winner: number | null;
    reason: string;
    points: number[];
  } | null;
}

/**
 * One move, for the client to animate: who did what, and the table as it
 * stood AFTER it. The computer seats act inside one request, so without the
 * snapshots the client would see three turns land at once. A stock draw
 * shows no card.
 */
export interface RummyFrame {
  seat: number;
  action: "draw" | "discard" | "declare" | "auto";
  source?: "stock" | "open";
  card?: Card;
  message: string;
  table: RummyTableView;
}

export interface RummyPublicRound extends RummyTableView {
  id: string;
  betId: string;
  stakeAmount: string;
  status: RummyRound["status"];
  /** Milliseconds the player has left on their turn (null when it is not theirs). */
  turnMsLeft: number | null;
  payoutAmount: string | null;
  multiplier: number | null;
  /** The returns this round settles at, stake included. */
  returns: Record<RummyClass, number>;
  createdAt: string;
  settledAt: string | null;
}

function readState(round: RummyRound): TableState {
  return round.state as TableState;
}

export function tableView(s: TableState): RummyTableView {
  const over = s.phase === "finished";
  return {
    phase: s.phase,
    seats: s.players.map((p) => ({
      name: p.name,
      cards: p.hand.length,
      folded: p.folded,
      ...(over ? { hand: p.hand } : {}),
    })),
    hand: s.players[0]!.hand,
    stockCount: s.stock.length,
    discard: s.discard,
    indicator: s.indicator,
    wild: s.wild,
    current: s.current,
    step: s.step,
    drawnFromOpen: s.drawnFromOpen ?? null,
    turns: s.turns,
    message: s.message,
    result: s.result,
  };
}

export function publicRound(round: RummyRound, payout: bigint | null = round.payoutAmount): RummyPublicRound {
  const s = readState(round);
  const mine = s.current === 0 && s.phase === "playing" && !s.players[0]!.folded;
  return {
    ...tableView(s),
    id: round.id,
    betId: round.betId,
    stakeAmount: round.stakePaise.toString(),
    status: round.status,
    turnMsLeft: mine && round.turnDeadline ? Math.max(0, round.turnDeadline.getTime() - Date.now()) : null,
    payoutAmount: payout === null ? null : payout.toString(),
    multiplier: round.multiplier,
    returns: payouts(round.houseEdge, round.maxMultiplier),
    createdAt: round.createdAt.toISOString(),
    settledAt: round.settledAt?.toISOString() ?? null,
  };
}

async function loadOwned(roundId: string, userId: string): Promise<RummyRound> {
  const [round] = await db.select().from(rummyRoundsTable).where(eq(rummyRoundsTable.id, roundId)).limit(1);
  if (!round || round.userId !== userId) throw new Error("ROUND_NOT_FOUND");
  return round;
}

async function activeFor(userId: string): Promise<RummyRound | null> {
  const [round] = await db
    .select()
    .from(rummyRoundsTable)
    .where(and(eq(rummyRoundsTable.userId, userId), eq(rummyRoundsTable.status, "active")))
    .limit(1);
  return round ?? null;
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

function frameFor(before: TableState, after: TableState): RummyFrame | null {
  if (after === before) return null;
  const seat = before.current;
  const table = tableView(after);
  if (after.phase === "finished" && after.result?.winner === seat) {
    return { seat, action: "declare", card: after.discard.at(-1), message: after.message, table };
  }
  if (before.step === "draw" && after.step === "discard") {
    const fromOpen = after.drawnFromOpen !== undefined;
    return {
      seat,
      action: "draw",
      source: fromOpen ? "open" : "stock",
      ...(fromOpen ? { card: after.players[seat]!.hand.at(-1) } : {}),
      message: after.message,
      table,
    };
  }
  if (before.step === "discard" && after.discard.length > before.discard.length) {
    return { seat, action: "discard", card: after.discard.at(-1), message: after.message, table };
  }
  return { seat, action: "auto", message: after.message, table };
}

/** Let the computer seats act until it is the player's turn again, or the round is over. */
function runBots(s: TableState, frames: RummyFrame[]): TableState {
  // Bounded: each seat's turn is two steps, and a table drawn at MAX_TURNS
  // ends on its own; the guard is against a rules bug, not a real path.
  for (let guard = 0; s.phase === "playing" && (s.current !== 0 || s.players[0]!.folded) && guard < 4_000; guard++) {
    const next = autoStep(s);
    const f = frameFor(s, next);
    if (f) frames.push(f);
    if (next === s) break;
    s = next;
  }
  return s;
}

/** Play the player's turn for them (a missed deadline), then the bots. */
function autoPlayer(s: TableState, frames: RummyFrame[]): TableState {
  for (let guard = 0; s.phase === "playing" && s.current === 0 && guard < 2; guard++) {
    const next = autoStep(s);
    const f = frameFor(s, next);
    if (f) frames.push({ ...f, action: f.action === "declare" ? "declare" : "auto" });
    if (next === s) break;
    s = next;
  }
  return runBots(s, frames);
}

function deadlineFor(s: TableState): Date | null {
  return s.phase === "playing" && s.current === 0 && !s.players[0]!.folded ? new Date(Date.now() + TURN_MS) : null;
}

/**
 * Write the table back, guarded on the turn the caller read: two requests on
 * one table (a double tap, a retry landing after the original) cannot both
 * apply — the loser sees TURN_CONFLICT and re-reads.
 */
async function writeState(round: RummyRound, before: TableState, after: TableState): Promise<RummyRound> {
  const [updated] = await db
    .update(rummyRoundsTable)
    .set({ state: after, turnDeadline: deadlineFor(after) })
    .where(
      and(
        eq(rummyRoundsTable.id, round.id),
        eq(rummyRoundsTable.status, "active"),
        sql`(${rummyRoundsTable.state}->>'turns')::int = ${before.turns}`,
        sql`${rummyRoundsTable.state}->>'step' = ${before.step}`,
        sql`(${rummyRoundsTable.state}->>'current')::int = ${before.current}`,
        sql`(${rummyRoundsTable.state}->'players'->0->>'folded')::boolean = ${before.players[0]!.folded}`,
      ),
    )
    .returning();
  if (!updated) throw new Error("TURN_CONFLICT");
  return updated;
}

/**
 * Settle the wallet idempotently, then commit terminal status and bank ledger
 * together. A retry reads the actual credited bet before completing the round.
 */
async function settleFinished(round: RummyRound): Promise<RummyRound> {
  const s = readState(round);
  if (s.phase !== "finished" || round.status !== "active") return round;
  const winner = s.result!.winner;
  const cls: RummyClass = winner === null ? "draw" : winner === 0 ? "you" : "computer";
  const returns = payouts(round.houseEdge, round.maxMultiplier);
  const multiplier = returns[cls];
  const status = cls === "you" ? "won" : cls === "draw" ? "drawn" : "lost";

  let payout = 0n;
  try {
    if (cls === "computer") {
      await settleLoss(round.betId, round.userId, 0);
    } else {
      const settled = await cashOutBet({
        betId: round.betId,
        userId: round.userId,
        multiplier,
        tablePayoutPaise: payoutPaise(cls, round.stakePaise, round.houseEdge, round.maxMultiplier),
        // The round's PINNED cap: the authorization proof on a non-crash game
        // (lib/cashoutAuthority), and immune to a config edit mid-round.
        maxMultiplierCap: round.maxMultiplier,
      });
      payout = settled.payoutAmount ?? payoutPaise(cls, round.stakePaise, round.houseEdge, round.maxMultiplier);
    }
  } catch (err) {
    if ((err as Error).message !== "BET_ALREADY_SETTLED") {
      throw err;
    }
    // Already paid (a retry after a crash between the credit and the write
    // below): the bet row holds the truth, not our zero.
    const [bet] = await db.select().from(betsTable).where(eq(betsTable.id, round.betId)).limit(1);
    payout = bet?.payoutAmount ?? 0n;
  }
  return db.transaction(async tx => {
    const [done] = await tx.update(rummyRoundsTable).set({ status, winner, reason:s.result!.reason, points:s.result!.points,
      multiplier, settledAt:new Date(), turnDeadline:null, payoutAmount:payout })
      .where(and(eq(rummyRoundsTable.id,round.id),eq(rummyRoundsTable.status,"active"))).returning();
    if (!done) return (await tx.select().from(rummyRoundsTable).where(eq(rummyRoundsTable.id,round.id)))[0]!;
    await settleBank({gameCode:RUMMY_GAME_CODE,partnerId:null,roundId:round.id,totalStakePaise:round.stakePaise,totalPayoutPaise:payout},tx);
    return done;
  });
}

/**
 * Bring a table up to date with the clock: every full TURN_MS the player has
 * let pass since their deadline is one turn the computer takes for them. Then
 * settle if that ended the round. Idempotent; called before every read.
 */
async function catchUp(round: RummyRound, frames: RummyFrame[]): Promise<RummyRound> {
  if (round.status !== "active") return round;
  let s = readState(round);
  if (s.phase === "playing" && round.turnDeadline && s.current === 0 && !s.players[0]!.folded) {
    const late = Date.now() - round.turnDeadline.getTime();
    if (late >= 0) {
      const missed = Math.floor(late / TURN_MS) + 1;
      let next = s;
      for (let i = 0; i < missed && next.phase === "playing"; i++) next = autoPlayer(next, frames);
      if (next !== s) {
        try {
          round = await writeState(round, s, next);
        } catch (err) {
          if ((err as Error).message !== "TURN_CONFLICT") throw err;
          // Somebody else moved the table first; read theirs.
          frames.length = 0;
          return catchUp(await loadOwned(round.id, round.userId), frames);
        }
        s = next;
      }
    }
  }
  if (s.phase === "finished") round = await settleFinished(round);
  return round;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createRound(input: CreateRummyRoundInput): Promise<{ round: RummyPublicRound; frames: RummyFrame[] }> {
  const cfg = await getGameConfig(RUMMY_GAME_CODE);
  if (!cfg) throw new Error(`GAME_NOT_FOUND:${RUMMY_GAME_CODE}`);
  if (!cfg.enabled) throw new Error("GAME_DISABLED");
  if (input.stakeAmount <= 0n) throw new Error("INVALID_STAKE");
  if (input.stakeAmount < cfg.minStakePaise) throw new Error("STAKE_TOO_SMALL");
  if (input.stakeAmount > cfg.maxStakePaise) throw new Error("STAKE_TOO_LARGE");

  // A table left open is caught up first: abandoned for long enough it has
  // finished and settled by now, and the player may sit down again.
  const existing = await activeFor(input.userId);
  if (existing) {
    const caught = await catchUp(existing, []);
    if (caught.status === "active") throw new Error("ACTIVE_ROUND_EXISTS");
  }

  const bet = await placeBet({
    useBonus: input.useBonus,
    userId: input.userId,
    gameCode: RUMMY_GAME_CODE,
    stakeAmount: input.stakeAmount,

    partnerId: input.partnerId ?? null,
    partnerPlayerRef: input.partnerPlayerRef ?? null,

  });

  const serverSeed = generateSeed(32);
  const serverSeedHash = sha256Hex(serverSeed);
  const clientSeed = generateSeed(16);
  const nonce = crypto.randomInt(0, 1_000_000_000);
  const seed = { serverSeed, clientSeed, nonce };
  const roundId = nanoid();
  // The engine stream: the partner's own, or the owner's when it shares one.
  const streamPartner = null;
  const key = streamKey(RUMMY_GAME_CODE, streamPartner);

  let deal: RummyDeal;
  let source = "drawn";
  let decision: Awaited<ReturnType<typeof decideOutcomeFor>> | null = null;
  try {
    const decided = await decideOutcomeFor({
      gameCode: RUMMY_GAME_CODE,
      partnerId: streamPartner,
      roundId,
      seed,
      space: rummyOutcomeSpace,
      payoutFor: (_bets, outcome) => {
        const cls = rummyOutcomeSpace.classify(outcome) as RummyClass | null;
        return cls ? payoutPaise(cls, input.stakeAmount, cfg.houseEdge, cfg.maxMultiplier) : 0n;
      },
      drawHonest: () => deriveDeal(serverSeed, clientSeed, nonce),
      // The whole book is this one entry; who pays it is the BET's partner.
      book: [{ userId: input.userId, partyId: input.partnerId ?? "local", bets: null, stakePaise: input.stakeAmount }],
    });
    deal = isDeal(decided.outcome) ? decided.outcome : deriveDeal(serverSeed, clientSeed, nonce);
    source = decided.source;
    decision = decided;
  } catch (err) {
    // The engine must never keep a table from being dealt.
    logger.warn({ err, roundId }, "[rummy] engine decision failed — dealing honestly");
    deal = deriveDeal(serverSeed, clientSeed, nonce);
  }

  const state = tableFromDeal(deal, input.displayName?.trim() || "You");
  let round: RummyRound;
  try {
    round = await db.transaction(async tx => {
    const [inserted] = await tx
      .insert(rummyRoundsTable)
      .values({
        id: roundId,
        betId: bet.id,
        userId: input.userId,
        streamKey: key,
        stakePaise: input.stakeAmount,
        serverSeed,
        serverSeedHash,
        clientSeed,
        nonce,
        deal,
        resultSource: source,
        predictedClass: rummyOutcomeSpace.classify(deal),
        state,
        status: "active",
        turnDeadline: deadlineFor(state),
        houseEdge: cfg.houseEdge,
        maxMultiplier: cfg.maxMultiplier,
      })
      .returning();
    if (decision) await decision.commit(tx);
    return inserted!;
    });
    decision?.afterCommit?.();
  } catch (err) {
    // The debit is undone and the bet voided; a failed refund is left
    // 'placed' for the stranded-bet screen (see mines for why no void here).
    try {
      await refundStake(bet.id, input.userId, input.stakeAmount);
    } catch (refundErr) {
      logger.error({ err: refundErr, betId: bet.id }, "[rummy] refund failed after round insert failure");
    }
    if (isUniqueViolation(err)) throw new Error("ACTIVE_ROUND_EXISTS");
    throw err;
  }
  // The computer seats open when the deal says so.
  const frames: RummyFrame[] = [];
  if (state.current !== 0) {
    const next = runBots(state, frames);
    round = await writeState(round, state, next);
    round = await catchUp(round, frames);
  }
  return { round: publicRound(round), frames };
}

export type PlayerAction =
  | { type: "draw"; source: "stock" | "open" }
  | { type: "discard"; cardId: string; declare?: boolean }
  | { type: "drop" };

export async function act(opts: { roundId: string; userId: string; action: PlayerAction }): Promise<{ round: RummyPublicRound; frames: RummyFrame[] }> {
  const frames: RummyFrame[] = [];
  let round = await catchUp(await loadOwned(opts.roundId, opts.userId), frames);
  if (round.status !== "active") throw new Error("ROUND_NOT_ACTIVE");
  const s = readState(round);
  if (s.phase !== "playing") throw new Error("ROUND_NOT_ACTIVE");
  if (s.current !== 0 || s.players[0]!.folded) throw new Error("NOT_YOUR_TURN");

  let next: TableState;
  const a = opts.action;
  if (a.type === "draw") {
    if (s.step !== "draw") throw new Error("DRAW_FIRST");
    const top = a.source === "stock" ? s.stock.at(-1) : s.discard.at(-1);
    if (!top) throw new Error("PILE_EMPTY");
    if (a.source === "open" && isWild(top, s.wild)) throw new Error("OPEN_JOKER");
    next = drawCard(s, a.source);
  } else if (a.type === "discard") {
    if (s.step !== "discard") throw new Error("DRAW_FIRST");
    if (!s.players[0]!.hand.some((c) => c.id === a.cardId)) throw new Error("CARD_NOT_IN_HAND");
    if (s.drawnFromOpen === a.cardId) throw new Error("CANNOT_RETURN_OPEN_CARD");
    if (a.declare) {
      const hand = s.players[0]!.hand.filter((c) => c.id !== a.cardId);
      if (!analyzeHand(hand, s.wild).valid) throw new Error("INVALID_DECLARATION");
    }
    next = discardCard(s, a.cardId, a.declare === true);
  } else {
    if (s.step !== "draw") throw new Error("DRAW_FIRST");
    next = dropPlayer(s);
  }
  if (next === s) throw new Error("ILLEGAL_MOVE");
  const mine = frameFor(s, next);
  if (mine) frames.push(mine);
  next = runBots(next, frames);
  round = await writeState(round, s, next);
  if (next.phase === "finished") round = await settleFinished(round);
  return { round: publicRound(round), frames };
}

export async function getActiveRound(opts: { userId: string }): Promise<{ round: RummyPublicRound; frames: RummyFrame[] } | null> {
  const existing = await activeFor(opts.userId);
  if (!existing) return null;
  const frames: RummyFrame[] = [];
  const round = await catchUp(existing, frames);
  return { round: publicRound(round), frames };
}

export async function getRound(opts: { roundId: string; userId: string }): Promise<{ round: RummyPublicRound; frames: RummyFrame[] }> {
  const frames: RummyFrame[] = [];
  const round = await catchUp(await loadOwned(opts.roundId, opts.userId), frames);
  return { round: publicRound(round), frames };
}

export async function listRecentRounds(opts: { userId: string; limit: number }): Promise<RummyPublicRound[]> {
  const rows = await db
    .select()
    .from(rummyRoundsTable)
    .where(eq(rummyRoundsTable.userId, opts.userId))
    .orderBy(desc(rummyRoundsTable.createdAt))
    .limit(opts.limit);
  return rows.map((r) => publicRound(r));
}
