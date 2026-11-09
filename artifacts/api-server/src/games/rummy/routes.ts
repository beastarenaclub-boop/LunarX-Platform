import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/auth";
import { bettingRateLimiter, bettingIpRateLimiter, bettingRateLimiter as settlementRateLimiter } from "../../middlewares/rateLimit";
import { createRound, act, getRound, getActiveRound, listRecentRounds, RUMMY_GAME_CODE, TURN_MS } from "./service";
import { payouts } from "./math";
import { tableBetPartnerContext, assertTableGameAllowed } from "../../services/handoffGames";
import { getGameConfig as effectiveGameConfig } from "../../services/rtp";
import { badRequest, notFound } from "../../lib/errors";

const router: IRouter = Router();

const DealBody = z.object({
  stakeAmount: z.string().regex(/^\d{1,18}$/u, "stakeAmount must be positive integer paise"),
  useBonus: z.boolean().optional(),
});
const DrawBody = z.object({ source: z.enum(["stock", "open"]) });
const DiscardBody = z.object({ cardId: z.string().min(1).max(16), declare: z.boolean().optional() });

function mapKnownErr(e: unknown): never {
  const msg = (e as Error).message;
  switch (msg) {
    case "INSUFFICIENT_BONUS_FUNDS":
      throw badRequest("Insufficient bonus balance");
    case "BONUS_NOT_ALLOWED_FOR_GAME":
      throw badRequest("Bonus balance not eligible for this game");
    case "BONUS_NOT_ALLOWED_FOR_PARTNER":
      throw badRequest("Bonus balance cannot be used on partner games");
    case "ROUND_NOT_FOUND":
      throw notFound("Round not found");
    case "ROUND_NOT_ACTIVE":
      throw badRequest("Round already settled");
    case "INVALID_STAKE":
      throw badRequest("Stake must be positive");
    case "STAKE_TOO_SMALL":
      throw badRequest("Stake is below the table minimum");
    case "STAKE_TOO_LARGE":
      throw badRequest("Stake exceeds maximum");
    case "GAME_DISABLED":
      throw badRequest("Rummy Royale is currently disabled");
    case "GAME_NOT_ALLOWED":
      throw badRequest("This game is not enabled for your operator");
    case "ACTIVE_ROUND_EXISTS":
      throw badRequest("You already have a rummy table open — finish it first");
    case "NOT_YOUR_TURN":
      throw badRequest("It is not your turn");
    case "DRAW_FIRST":
      throw badRequest("Draw a card first");
    case "PILE_EMPTY":
      throw badRequest("That pile is empty");
    case "OPEN_JOKER":
      throw badRequest("A joker cannot be picked from the open pile");
    case "CARD_NOT_IN_HAND":
      throw badRequest("That card is not in your hand");
    case "CANNOT_RETURN_OPEN_CARD":
      throw badRequest("The card you picked from the open pile cannot go straight back");
    case "INVALID_DECLARATION":
      throw badRequest("Not ready: arrange all 13 cards with at least 2 sequences, including 1 pure sequence");
    case "ILLEGAL_MOVE":
      throw badRequest("That move is not allowed now");
    case "TURN_CONFLICT":
      throw badRequest("Table state changed — please retry");
    case "BET_NOT_FOUND":
      throw notFound("Bet not found");
    case "BET_ALREADY_SETTLED":
      throw badRequest("Bet already settled");
    default:
      throw e;
  }
}

router.get("/config", async (req, res, next) => {
  try {
    // The table this player will actually be PAID under (a partner's edge and
    // limits, not the platform's) — the instant games' shape.
    const cfg = await effectiveGameConfig(RUMMY_GAME_CODE);
    if (!cfg) throw new Error(`GAME_NOT_FOUND:${RUMMY_GAME_CODE}`);
    res.json({
      enabled: cfg.enabled,
      houseEdge: cfg.houseEdge,
      maxMultiplier: cfg.maxMultiplier,
      minStakePaise: cfg.minStakePaise.toString(),
      maxStakePaise: cfg.maxStakePaise.toString(),
      returns: payouts(cfg.houseEdge, cfg.maxMultiplier),
      turnMs: TURN_MS,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/recent", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1), 50);
    res.json(await listRecentRounds({ userId: req.user!.id, limit }));
  } catch (err) {
    next(err);
  }
});

router.get("/active", requireAuth, async (req, res, next) => {
  try {
    res.json(await getActiveRound({ userId: req.user!.id }));
  } catch (err) {
    next(err);
  }
});

router.post("/deal", requireAuth, bettingIpRateLimiter, bettingRateLimiter, async (req, res, next) => {
  try {
    const input = DealBody.parse(req.body);
    try {
      // A partner not entitled to the game is refused before any wallet work.
      await assertTableGameAllowed(req.session, RUMMY_GAME_CODE);
      res.json(
        await createRound({
          userId: req.user!.id,
          displayName: req.user!.displayName ?? null,
          ...tableBetPartnerContext(req.session),
          stakeAmount: BigInt(input.stakeAmount),
          useBonus: input.useBonus,
        }),
      );
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    try {
      res.json(await getRound({ roundId: String(req.params.id), userId: req.user!.id }));
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

router.post("/:id/draw", requireAuth, settlementRateLimiter, async (req, res, next) => {
  try {
    const body = DrawBody.parse(req.body);
    try {
      res.json(await act({ roundId: String(req.params.id), userId: req.user!.id, action: { type: "draw", source: body.source } }));
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

router.post("/:id/discard", requireAuth, settlementRateLimiter, async (req, res, next) => {
  try {
    const body = DiscardBody.parse(req.body);
    try {
      res.json(
        await act({
          roundId: String(req.params.id),
          userId: req.user!.id,
          action: { type: "discard", cardId: body.cardId, declare: body.declare },
        }),
      );
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

router.post("/:id/drop", requireAuth, settlementRateLimiter, async (req, res, next) => {
  try {
    try {
      res.json(await act({ roundId: String(req.params.id), userId: req.user!.id, action: { type: "drop" } }));
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
