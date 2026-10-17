import { isRetiredGame } from "../lib/retiredGames";
import {
  db,
  tableRoundsTable as rounds,
  betsTable as bets,
  type TableRound,
  type Bet,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  CRASH_GAME_CODES,
  deriveCrashPoint,
  generateSeed,
  requireGameConfig,
  sha256Hex,
} from "./rtp";
import { cashOutBet, settleLoss } from "./bets";
import { badRequest, notFound } from "../lib/errors";
import { logger } from "../lib/logger";

type Config = {
  owner: string;
  houseEdge: number;
  maxMultiplier: number;
  minStakePaise: string;
  maxStakePaise: string;
  version: 3;
};
const config = (round: TableRound) => round.config as Config;
const crashPoint = (round: TableRound) =>
  (round.outcome as { crashPoint: number }).crashPoint;
export const crashMultiplierAt = (elapsedMs: number) =>
  Math.floor(Math.exp(Math.max(0, elapsedMs) / 10000) * 100) / 100;

export async function crashRoundForUser(id: string, userId: string) {
  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, id))
    .limit(1);
  if (!round || !id.startsWith("crash-") || config(round).owner !== userId)
    throw notFound("Crash round not found.");
  return round;
}

/** The hidden crash threshold never leaves the server before the flight ends. */
function publicRound(round: TableRound, now: number) {
  const startsAt = round.bettingEndsAt.getTime(),
    endsAt = round.revealEndsAt.getTime();
  const phase =
    now < startsAt ? "betting" : now < endsAt ? "flying" : "crashed";
  return {
    id: round.id,
    gameCode: round.gameCode,
    phase,
    now,
    startsAt,
    bettingMs: startsAt - round.createdAt.getTime(),
    multiplier:
      phase === "flying"
        ? crashMultiplierAt(now - startsAt)
        : phase === "crashed"
          ? crashPoint(round)
          : 1,
    nextRoundAt: phase === "crashed" ? round.settleEndsAt.getTime() : null,
    crashPoint: phase === "crashed" ? crashPoint(round) : null,
    serverSeed: phase === "crashed" ? round.serverSeed : null,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    version: 3,
    houseEdge: config(round).houseEdge,
    maxMultiplier: config(round).maxMultiplier,
  };
}

async function createCurrent(
  userId: string,
  gameCode: string,
  requestedClientSeed?: string,
  turbo = false,
) {
  if (isRetiredGame(gameCode)) throw badRequest("This game is no longer available.");
  if (!CRASH_GAME_CODES.has(gameCode)) throw badRequest("Unknown crash game.");
  const cfg = await requireGameConfig(gameCode);
  if (!cfg.enabled) throw badRequest("Game is temporarily disabled.");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`crash:${userId}:${gameCode}`}))`,
    );
    const now = Date.now();
    const [last] = await tx
      .select()
      .from(rounds)
      .where(
        and(
          eq(rounds.gameCode, gameCode),
          sql`${rounds.config}->>'owner' = ${userId}`,
        ),
      )
      .orderBy(desc(rounds.createdAt))
      .limit(1);
    if (last && now < last.settleEndsAt.getTime()) return last;
    const serverSeed = generateSeed(),
      clientSeed = requestedClientSeed?.slice(0, 128) || generateSeed(16);
    const threshold = deriveCrashPoint(
      serverSeed,
      clientSeed,
      0,
      cfg.houseEdge,
      cfg.maxMultiplier,
      3,
    );
    const startsAt =
      now + (turbo ? cfg.turboBettingWindowMs : cfg.bettingWindowMs);
    const holdMs = turbo
      ? Math.max(500, Math.round(cfg.interRoundDelayMs * 0.6))
      : cfg.interRoundDelayMs;
    const endsAt = startsAt + Math.log(threshold) * 10000;
    const [round] = await tx
      .insert(rounds)
      .values({
        id: `crash-${nanoid()}`,
        gameCode,
        serverSeed,
        serverSeedHash: sha256Hex(serverSeed),
        clientSeed,
        nonce: 0,
        createdAt: new Date(now),
        bettingEndsAt: new Date(startsAt),
        revealEndsAt: new Date(Math.ceil(endsAt)),
        settleEndsAt: new Date(Math.ceil(endsAt + holdMs)),
        outcome: { crashPoint: threshold },
        config: {
          owner: userId,
          version: 3,
          houseEdge: cfg.houseEdge,
          maxMultiplier: cfg.maxMultiplier,
          minStakePaise: cfg.minStakePaise.toString(),
          maxStakePaise: cfg.maxStakePaise.toString(),
        },
      })
      .returning();
    return round;
  });
}

/** Auto cashout is locked at placement, so disconnecting cannot change the odds. */
async function settleDueBet(bet: Bet, round: TableRound, now: number) {
  if (bet.status !== "placed") return bet;
  if ((bet.metadata as { crashFunded?: boolean } | null)?.crashFunded === false)
    return bet;
  const target = Number(
    (bet.metadata as { crashAutoCashout?: number } | null)?.crashAutoCashout,
  );
  const reached =
    Number.isFinite(target) &&
    target >= 1.01 &&
    target <= crashPoint(round) &&
    now >= round.bettingEndsAt.getTime() + Math.log(target) * 10000;
  try {
    if (reached)
      return await cashOutBet({
        betId: bet.id,
        userId: bet.userId,
        multiplier: target,
        maxMultiplierCap: config(round).maxMultiplier,
      });
    if (now >= round.revealEndsAt.getTime())
      return await settleLoss(bet.id, bet.userId, crashPoint(round));
  } catch (error) {
    if ((error as Error).message !== "BET_ALREADY_SETTLED") throw error;
    const [updated] = await db.select().from(bets).where(eq(bets.id, bet.id));
    return updated;
  }
  return bet;
}

export async function currentCrashRound(
  userId: string,
  gameCode: string,
  id?: string,
  clientSeed?: string,
  turbo = false,
) {
  const round = id
    ? await crashRoundForUser(id, userId)
    : await createCurrent(userId, gameCode, clientSeed, turbo);
  if (round.gameCode !== gameCode) throw notFound("Crash round not found.");
  const slips = await db
    .select()
    .from(bets)
    .where(and(eq(bets.roundId, round.id), eq(bets.userId, userId)))
    .orderBy(bets.placedAt);
  const now = Date.now();
  if (now >= round.revealEndsAt.getTime() && round.phase !== "settled")
    await db
      .update(rounds)
      .set({ phase: "settled", settledAt: new Date(round.revealEndsAt) })
      .where(eq(rounds.id, round.id));
  const settled = [];
  for (const slip of slips) settled.push(await settleDueBet(slip, round, now));
  return {
    ...publicRound(round, now),
    bets: settled.map((b) => ({
      id: b.id,
      stakeAmount: b.stakeAmount.toString(),
      status: b.status,
      payoutAmount: b.payoutAmount.toString(),
      multiplier: b.multiplier,
      panel: (b.metadata as { crashPanel?: number } | null)?.crashPanel ?? 0,
      autoCashOut:
        (b.metadata as { crashAutoCashout?: number } | null)
          ?.crashAutoCashout ?? null,
    })),
  };
}

export async function validateCrashPlacement(
  userId: string,
  gameCode: string,
  roundId?: string,
) {
  if (!CRASH_GAME_CODES.has(gameCode) || !roundId)
    throw badRequest("Place this bet through its game controls.");
  const round = await crashRoundForUser(roundId, userId);
  if (
    round.gameCode !== gameCode ||
    Date.now() >= round.bettingEndsAt.getTime()
  )
    throw badRequest("Betting has closed. Wait for the next round.");
  return round;
}

export async function cashOutCrash(
  userId: string,
  id: string,
  requested: number,
) {
  const [bet] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.id, id), eq(bets.userId, userId)));
  if (!bet) throw notFound("Bet not found.");
  if (!CRASH_GAME_CODES.has(bet.gameCode))
    throw badRequest("This game settles through its own game controls.");
  if ((bet.metadata as { crashFunded?: boolean } | null)?.crashFunded === false)
    throw badRequest("Bet funding is still pending.");
  // Previously accepted client rounds finish under their original terms.
  if (!bet.roundId?.startsWith("crash-"))
    return cashOutBet({ betId: id, userId, multiplier: requested });
  const round = await crashRoundForUser(bet.roundId, userId),
    now = Date.now();
  const settled = await settleDueBet(bet, round, now);
  if (settled.status === "cashed_out") return settled;
  if (settled.status !== "placed")
    throw badRequest("The round has already crashed.");
  if (now < round.bettingEndsAt.getTime())
    throw badRequest("The flight has not started.");
  const current = crashMultiplierAt(now - round.bettingEndsAt.getTime());
  if (requested < 1.01 || requested > current || requested >= crashPoint(round))
    throw badRequest("Cashout multiplier is not available.");
  return cashOutBet({
    betId: id,
    userId,
    multiplier: requested,
    maxMultiplierCap: config(round).maxMultiplier,
  });
}

export async function loseCrash(userId: string, id: string) {
  const [bet] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.id, id), eq(bets.userId, userId)));
  if (!bet) throw notFound("Bet not found.");
  if (!CRASH_GAME_CODES.has(bet.gameCode))
    throw badRequest("This game settles automatically.");
  if (!bet.roundId?.startsWith("crash-")) return settleLoss(id, userId, null);
  return settleDueBet(
    bet,
    await crashRoundForUser(bet.roundId, userId),
    Date.now(),
  );
}

export function startCrashSettlement() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const pending = await db
        .select({ bet: bets, round: rounds })
        .from(bets)
        .innerJoin(rounds, eq(bets.roundId, rounds.id))
        .where(
          and(
            eq(bets.status, "placed"),
            inArray(bets.gameCode, [...CRASH_GAME_CODES]),
            sql`${rounds.id} like 'crash-%'`,
          ),
        )
        .limit(500);
      for (const { bet, round } of pending)
        await settleDueBet(bet, round, Date.now());
      await db
        .update(rounds)
        .set({ phase: "settled", settledAt: new Date() })
        .where(
          and(
            inArray(rounds.gameCode, [...CRASH_GAME_CODES]),
            eq(rounds.phase, "betting"),
            sql`${rounds.id} like 'crash-%' AND ${rounds.revealEndsAt} <= now()`,
          ),
        );
    } catch (error) {
      logger.error({ error }, "Crash settlement failed");
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(tick, 500);
  timer.unref();
  return () => clearInterval(timer);
}
