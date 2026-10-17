import { Router, type IRouter } from "express";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, tableRoundsTable, tableRoundBetsTable } from "@workspace/db";
import {
  CRAZY_TIME_TYPES,
  CRAZY_TIME_SPOTS,
  CRAZY_TIME_MAX_RETURN,
  CRAZY_TIME_VERSION,
  type CrazyTimeBet,
} from "@workspace/api-zod/crazy-time-game";
import { requireAuth } from "../middlewares/auth";
import {
  bettingIpRateLimiter,
  bettingRateLimiter,
} from "../middlewares/rateLimit";
import { requireGameConfig, sha256Hex } from "../services/rtp";
import {
  getTableRoundSnapshot,
  isOutcomeDisclosed,
  placeTableBets,
  type RoundConfigSnapshot,
} from "../services/tableRounds";
import {
  deriveCrazyTimeOutcome,
  settleCrazyTimeBets,
} from "../services/crazyTimeMath";
import { badRequest, notFound } from "../lib/errors";

const router: IRouter = Router();
const code = "crazy-time";
// The advisory-lock transaction reserves one connection while the shared
// betting service uses another. Bound concurrent reservations so a burst of
// submissions cannot exhaust the default 10-connection pool and deadlock.
const placementSlots: Promise<unknown>[] = Array.from({ length: 3 }, () =>
  Promise.resolve(),
);
let nextSlot = 0;
function withPlacementSlot<T>(work: () => Promise<T>): Promise<T> {
  const slot = nextSlot++ % placementSlots.length;
  const task = placementSlots[slot].then(work);
  placementSlots[slot] = task.catch(() => undefined);
  return task;
}
const betBody = z
  .object({
    roundId: z.string().min(1).max(100),
    bets: z
      .array(
        z
          .object({
            type: z.enum(CRAZY_TIME_TYPES),
            amountPaise: z.string().regex(/^\d{1,13}$/),
            choice: z.number().int().min(0).max(107).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
router.use(requireAuth);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.get("/config", async (_req, res, next) => {
  try {
    const cfg = await requireGameConfig(code);
    res.json({
      enabled: cfg.enabled,
      minStakePaise: cfg.minStakePaise.toString(),
      maxStakePaise: cfg.maxStakePaise.toString(),
      maxMultiplier: CRAZY_TIME_MAX_RETURN,
      spots: CRAZY_TIME_SPOTS,
      version: CRAZY_TIME_VERSION,
      bettingWindowMs: cfg.bettingWindowMs,
      revealDurationMs: cfg.revealDurationMs,
      settleDurationMs: cfg.settleDurationMs,
    });
  } catch (error) {
    next(error);
  }
});
router.get("/round", async (req, res, next) => {
  try {
    res.json(await getTableRoundSnapshot(code, req.user!.id));
  } catch (error) {
    next(error);
  }
});
router.post(
  "/bet",
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      const body = betBody.parse(req.body);
      if (!(await requireGameConfig(code)).enabled)
        throw badRequest("Crazy Time is paused.");
      // One combined auto-submitted slip per player/round. A lost HTTP response
      // can be retried without charging twice, including across server workers.
      const accepted = await withPlacementSlot(() =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`${code}:${body.roundId}:${req.user!.id}`}, 0))`,
          );
          const [existing] = await tx
            .select()
            .from(tableRoundBetsTable)
            .where(
              and(
                eq(tableRoundBetsTable.roundId, body.roundId),
                eq(tableRoundBetsTable.userId, req.user!.id),
                eq(tableRoundBetsTable.gameCode, code),
              ),
            );
          if (existing) {
            if (!isDeepStrictEqual(existing.bets, body.bets))
              throw badRequest("Your bets are already locked for this round.");
            return {
              slipId: existing.id,
              roundId: existing.roundId,
              totalStake: existing.totalStake.toString(),
              status: existing.status,
            };
          }
          return placeTableBets({
            ...body,
            gameCode: code,
            userId: req.user!.id,
          });
        }),
      );
      res.json(accepted);
    } catch (error) {
      const messages: Record<string, string> = {
        BETTING_CLOSED: "Betting is closed. Wait for the next round.",
        INSUFFICIENT_FUNDS: "Insufficient wallet balance.",
        STAKE_TOO_SMALL: "Minimum bet is ₹1 per spot.",
        STAKE_TOO_LARGE: "The bet exceeds the table limit.",
        DUPLICATE_BET_TYPE: "Choose each spot only once per slip.",
        INVALID_CRAZY_TIME_BET: "Choose a valid wheel spot.",
        INVALID_BONUS_CHOICE: "Choose a valid bonus box or colour.",
      };
      next(
        messages[(error as Error).message]
          ? badRequest(messages[(error as Error).message])
          : error,
      );
    }
  },
);
router.get("/recent", async (req, res, next) => {
  try {
    const slips = await db
      .select({ slip: tableRoundBetsTable, round: tableRoundsTable })
      .from(tableRoundBetsTable)
      .innerJoin(
        tableRoundsTable,
        eq(tableRoundBetsTable.roundId, tableRoundsTable.id),
      )
      .where(
        and(
          eq(tableRoundBetsTable.gameCode, code),
          eq(tableRoundBetsTable.userId, req.user!.id),
          eq(tableRoundBetsTable.status, "settled"),
        ),
      )
      .orderBy(desc(tableRoundBetsTable.createdAt))
      .limit(20);
    res.json(
      slips.map(({ slip, round }) => ({
        roundId: round.id,
        outcome: round.outcome,
        bets: slip.bets,
        totalStake: slip.totalStake.toString(),
        payoutAmount: slip.payoutAmount.toString(),
        createdAt: slip.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    next(error);
  }
});
router.get("/:id/verify", async (req, res, next) => {
  try {
    const [round] = await db
      .select()
      .from(tableRoundsTable)
      .where(
        and(
          eq(tableRoundsTable.id, String(req.params.id)),
          eq(tableRoundsTable.gameCode, code),
        ),
      );
    if (!round) throw notFound("Round not found.");
    if (!isOutcomeDisclosed(round))
      throw badRequest("The round has not been revealed yet.");
    const outcome = deriveCrazyTimeOutcome(
      round.serverSeed,
      round.clientSeed,
      round.nonce,
      (round.config as RoundConfigSnapshot).crazyTimeVersion ?? 1,
    );
    const slips = await db
      .select()
      .from(tableRoundBetsTable)
      .where(
        and(
          eq(tableRoundBetsTable.roundId, round.id),
          eq(tableRoundBetsTable.userId, req.user!.id),
        ),
      );
    const receipts = slips.map((slip) => {
      const computed = settleCrazyTimeBets(
        (slip.bets as CrazyTimeBet[]).map((b) => ({
          ...b,
          amountPaise: BigInt(b.amountPaise),
        })),
        outcome,
        (round.config as RoundConfigSnapshot).payoutVersion ?? 1,
      ).totalPayout.toString();
      return {
        id: slip.id,
        status: slip.status,
        payoutAmount: slip.payoutAmount.toString(),
        computedPayout: computed,
        payoutMatch:
          slip.status === "settled"
            ? computed === slip.payoutAmount.toString()
            : null,
      };
    });
    const hashMatch = sha256Hex(round.serverSeed) === round.serverSeedHash;
    const outcomeMatch = isDeepStrictEqual(outcome, round.outcome);
    res.json({
      roundId: round.id,
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      outcome,
      hashMatch,
      outcomeMatch,
      slips: receipts,
      verified:
        hashMatch &&
        outcomeMatch &&
        receipts.every((s) => s.payoutMatch !== false),
    });
  } catch (error) {
    next(error);
  }
});
export default router;
