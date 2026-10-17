import { crashBetInput } from "../lib/crashBetInput";
import { db, betsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { validateCrashPlacement, cashOutCrash, loseCrash } from "../services/crashRounds";
import { refundStake } from "../services/bets";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import {
  placeBet as placeBetSvc,
  cashOutBet as cashOutBetSvc,
  settleLoss as settleLossSvc,
  listBets,
} from "../services/bets";
import { getGameConfig } from "../services/rtp";
import { recordBetTiming, createFraudFlag } from "../services/fraud";
import { writeAppLog } from "../services/appLog";
import { clientIp } from "../lib/audit";
import { bet as betDto } from "../lib/serialize";
import { badRequest, notFound } from "../lib/errors";

const router: IRouter = Router();

const PlaceBody = crashBetInput;

const CashOutBody = z.object({
  multiplier: z.number().min(1).max(100000),
});

const LossBody = z.object({
  multiplier: z.number().min(1).max(100000).optional(),
});

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
      200,
    );
    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : null;
    const result = await listBets({ userId: req.user!.id, limit, cursor });
    res.json({
      entries: result.entries.map(betDto),
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/place",
  requireAuth,
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      const input = PlaceBody.parse(req.body);
      if (["horse-racing", "bike-racing"].includes(input.gameCode))
        throw badRequest("Place racing bets through the live race betting window.");
      const crashRound = await validateCrashPlacement(req.user!.id, input.gameCode, input.roundId);
      const stake = BigInt(input.stakeAmount);
      const terms = crashRound.config as { minStakePaise: string; maxStakePaise: string; maxMultiplier: number };
      if (!input.useFreeBet && (stake < BigInt(terms.minStakePaise) || stake > BigInt(terms.maxStakePaise))) throw badRequest("Stake is outside the round limits.");
      if (input.autoCashOut !== undefined && input.autoCashOut > terms.maxMultiplier) throw badRequest("Auto cashout exceeds the round limit.");
      // Free bets have a server-forced stake (the grant's fixed amount), so
      // the client-sent stakeAmount is only validated for regular bets.
      if (!input.useFreeBet && stake <= 0n)
        throw badRequest("Stake must be positive");

      const config = await getGameConfig(input.gameCode);
      if (!config) {
        throw badRequest("Unknown game");
      }
      if (!config.enabled) {
        throw badRequest("Game is currently disabled");
      }
      if (!input.useFreeBet && stake > config.maxStakePaise) {
        throw badRequest(
          `Stake exceeds maximum of ${config.maxStakePaise.toString()} paise`,
        );
      }

      const timing = recordBetTiming(req.user!.id);
      if (timing.flagged) {
        void createFraudFlag({
          userId: req.user!.id,
          rule: "bot_timing",
          severity: "high",
          description: timing.reason,
          metadata: { ip: clientIp(req), userAgent: req.headers["user-agent"] },
        });
        void writeAppLog({
          level: "warn",
          kind: "fraud",
          message: `Bot timing flagged: ${timing.reason}`,
          actorId: req.user!.id,
          ip: clientIp(req),
        });
      }

      // Launcher sessions inherit a partnerId + playerRef so bets opened
      // inside a partner iframe are tagged for partner attribution + remote
      // wallet routing without the partner exposing their HMAC secret to
      // the browser.
      const partnerCtx = req.session?.partnerId
        ? {
            partnerId: req.session.partnerId,
            partnerPlayerRef: req.session.partnerPlayerRef ?? null,
          }
        : { partnerId: null, partnerPlayerRef: null };

      try {
        const placed = await placeBetSvc({
          userId: req.user!.id,
          gameCode: input.gameCode,
          roundId: input.roundId ?? null,
          stakeAmount: stake,
          partnerId: partnerCtx.partnerId,
          partnerPlayerRef: partnerCtx.partnerPlayerRef,
          useBonus: input.useBonus,
          useFreeBet: input.useFreeBet,
          crashTerms: { crashAutoCashout: input.autoCashOut, crashPanel: input.panel ?? 0 },
        });
        if (Date.now() >= crashRound.bettingEndsAt.getTime()) {
          await refundStake(placed.id, req.user!.id, placed.stakeAmount);
          await db.update(betsTable).set({ status: "voided", settledAt: new Date() }).where(and(eq(betsTable.id, placed.id), eq(betsTable.status, "placed")));
          throw badRequest("Betting closed while reserving funds. Your stake was refunded.");
        }
        await db.update(betsTable).set({ metadata: { ...(placed.metadata as object), crashFunded: true } }).where(eq(betsTable.id, placed.id));
        res.json(betDto(placed));
      } catch (e) {
        const msg = (e as Error).message;
        if ((e as {code?:string}).code === "23505" || (e as {cause?:{code?:string}}).cause?.code === "23505") throw badRequest("This panel already has a bet in the current round.");
        if (msg === "NO_FREE_BETS")
          throw badRequest("No free bets available");
        if (msg === "FREE_BET_NOT_ALLOWED_FOR_PARTNER")
          throw badRequest("Free bets cannot be used on partner games");
        if (msg === "FREE_BET_NOT_COMBINABLE_WITH_BONUS")
          throw badRequest("Free bets cannot be combined with bonus balance");
        if (msg === "INSUFFICIENT_BONUS_FUNDS")
          throw badRequest("Insufficient bonus balance");
        if (msg === "BONUS_NOT_ALLOWED_FOR_GAME")
          throw badRequest("Bonus balance can only be used on Lunar, Mines, Plinko or Dice");
        if (msg === "BONUS_NOT_ALLOWED_FOR_PARTNER")
          throw badRequest("Bonus balance cannot be used on partner games");
        throw e;
      }
    } catch (err) {
      next(err);
    }
  },
);

router.post("/:id/cashout", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = CashOutBody.parse(req.body);

    try {
      // Multiplier cap is per-game; the service looks up the bet first, then
      // applies the right game's `maxMultiplier`. This keeps the route from
      // hard-coding any specific game (e.g. "lunar").
      const updated = await cashOutCrash(req.user!.id, id, input.multiplier);
      res.json(betDto(updated));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "BET_NOT_FOUND") throw notFound("Bet not found");
      if (msg === "BET_ALREADY_SETTLED")
        throw badRequest("Bet already settled");
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

router.post("/:id/lose", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = LossBody.parse(req.body ?? {});
    try {
      const updated = await loseCrash(req.user!.id, id);
      res.json(betDto(updated));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "BET_NOT_FOUND") throw notFound("Bet not found");
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

export default router;
