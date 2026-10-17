import { Router, type IRouter } from "express";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, tableRoundsTable, tableRoundBetsTable } from "@workspace/db";
import {
  VEGETABLE_MODES,
  VEGETABLE_RTP,
  VEGETABLE_TICKETS,
  VEGETABLE_JUNK_CHANCE,
  VEGETABLE_OUTCOME_VERSION,
} from "@workspace/api-zod/vegetable-game";
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
  deriveVegetableOutcome,
  settleVegetableBets,
  type VegetableBet,
} from "../services/vegetableMath";
import { badRequest, notFound } from "../lib/errors";

const router: IRouter = Router();
const code = "vegetable-bowl";
const betBody = z
  .object({
    roundId: z.string().min(1).max(100),
    bets: z
      .array(
        z
          .object({
            type: z.enum(["normal", "hard", "risk"]),
            amountPaise: z.string().regex(/^\d{1,12}$/),
          })
          .strict(),
      )
      .min(1)
      .max(3),
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
      modes: VEGETABLE_MODES,
      tickets: VEGETABLE_TICKETS,
      theoreticalRtp: VEGETABLE_RTP,
      outcomeVersion: VEGETABLE_OUTCOME_VERSION,
      junkChance: VEGETABLE_JUNK_CHANCE,
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
        throw badRequest("Vegetable Bowl is currently paused.");
      res.json(
        await placeTableBets({ ...body, gameCode: code, userId: req.user!.id }),
      );
    } catch (error) {
      const messages: Record<string, string> = {
        BETTING_CLOSED: "Betting is closed. Wait for the next round.",
        INSUFFICIENT_FUNDS: "Insufficient wallet balance.",
        STAKE_TOO_SMALL: "Minimum bet is ₹1 per option.",
        STAKE_TOO_LARGE: "The bet exceeds the round limit.",
        DUPLICATE_BET_TYPE: "Choose each option only once per slip.",
        INVALID_VEGETABLE_BET: "Choose Normal, Hard or Risk.",
      };
      next(
        messages[(error as Error).message]
          ? badRequest(messages[(error as Error).message])
          : error,
      );
    }
  },
);
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
    const outcome = deriveVegetableOutcome(
      round.serverSeed,
      round.clientSeed,
      round.nonce,
      (round.config as RoundConfigSnapshot).vegetableOutcomeVersion ?? 1,
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
    res.json({
      roundId: round.id,
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      outcome,
      hashMatch: sha256Hex(round.serverSeed) === round.serverSeedHash,
      outcomeMatch: isDeepStrictEqual(outcome, round.outcome),
      slips: slips.map((slip) => ({
        id: slip.id,
        status: slip.status,
        payoutAmount: slip.payoutAmount.toString(),
        computedPayout: settleVegetableBets(
          (
            slip.bets as { type: VegetableBet["type"]; amountPaise: string }[]
          ).map((b) => ({ ...b, amountPaise: BigInt(b.amountPaise) })),
          outcome.total,
          (round.config as RoundConfigSnapshot).payoutVersion ?? 1,
        ).totalPayout.toString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});
export default router;
