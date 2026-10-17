import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import {
  createRound,
  reveal,
  cashout,
  getRound,
  getActiveRound,
  listRecentRounds,
  MIN_MINES,
  MAX_MINES,
} from "../services/mines";
import { badRequest, notFound } from "../lib/errors";
import { requireGameConfig, minesMultiplier } from "../services/rtp";

const router: IRouter = Router();

router.get("/config", async (_req, res, next) => {
  try {
    const cfg = await requireGameConfig("mines");
    const multipliers: Record<string, number[]> = {};
    for (let mineCount = MIN_MINES; mineCount <= MAX_MINES; mineCount++) {
      multipliers[mineCount] = Array.from({ length: 25 - mineCount }, (_, i) =>
        minesMultiplier({ gridSize: 25, mineCount, revealedSafe: i + 1,
          houseEdge: cfg.houseEdge, maxMultiplier: cfg.maxMultiplier }));
    }
    res.json({ enabled: cfg.enabled, houseEdge: cfg.houseEdge,
      maxStakePaise: cfg.maxStakePaise.toString(), maxMultiplier: cfg.maxMultiplier, multipliers });
  } catch (err) { next(err); }
});

const PlaceBody = z.object({
  stakeAmount: z.string().regex(/^\d{1,18}$/u, "stakeAmount must be positive integer paise"),
  mineCount: z.number().int().min(MIN_MINES).max(MAX_MINES),
  useBonus: z.boolean().optional(),
});

const RevealBody = z.object({
  cellIndex: z.number().int().min(0).max(255),
});

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
    case "INVALID_CELL":
      throw badRequest("Invalid cell");
    case "CELL_ALREADY_REVEALED":
      throw badRequest("Cell already revealed");
    case "INVALID_MINE_COUNT":
      throw badRequest("Invalid mine count");
    case "INVALID_STAKE":
      throw badRequest("Stake must be positive");
    case "STAKE_TOO_LARGE":
      throw badRequest("Stake exceeds maximum");
    case "GAME_DISABLED":
      throw badRequest("Mines is currently disabled");
    case "NO_REVEAL_YET":
      throw badRequest("Reveal at least one cell before cashing out");
    case "BET_NOT_FOUND":
      throw notFound("Bet not found");
    case "BET_ALREADY_SETTLED":
      throw badRequest("Bet already settled");
    case "REVEAL_CONFLICT":
      throw badRequest("Round state changed — please retry");
    case "ACTIVE_ROUND_EXISTS":
      throw badRequest("You already have an active mines round — finish it first");
    default:
      throw e;
  }
}

router.get("/recent", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1),
      50,
    );
    const rows = await listRecentRounds({ userId: req.user!.id, limit });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/active", requireAuth, async (req, res, next) => {
  try {
    const out = await getActiveRound({ userId: req.user!.id });
    res.json(out);
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
      const stake = BigInt(input.stakeAmount);
      try {
        const out = await createRound({
          userId: req.user!.id,
          stakeAmount: stake,
          mineCount: input.mineCount,
          useBonus: input.useBonus,
        });
        res.json(out);
      } catch (e) {
        mapKnownErr(e);
      }
    } catch (err) {
      next(err);
    }
  },
);

router.post("/:id/reveal", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = RevealBody.parse(req.body);
    try {
      const out = await reveal({
        roundId: id,
        userId: req.user!.id,
        cellIndex: input.cellIndex,
      });
      res.json(out);
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

router.post("/:id/cashout", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    try {
      const out = await cashout({ roundId: id, userId: req.user!.id });
      res.json(out);
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    try {
      const out = await getRound({ roundId: id, userId: req.user!.id });
      res.json(out);
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
