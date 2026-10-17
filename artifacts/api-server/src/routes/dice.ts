import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import {
  rollDice,
  listRecentRounds,
  getRoundForVerify,
  getRawRound,
  getActiveSeed,
  rotateActiveSeed,
} from "../services/dice";
import {
  requireGameConfig,
  sha256Hex,
  deriveDiceOutcome,
  diceMultiplier,
  diceDidWin,
  diceWinChance,
  DICE_MIN_TARGET,
  DICE_MAX_TARGET,
} from "../services/rtp";
import { badRequest, notFound } from "../lib/errors";

const router: IRouter = Router();

const RollBody = z.object({
  stakeAmount: z
    .string()
    .regex(/^\d{1,18}$/u, "stakeAmount must be positive integer paise"),
  target: z.number().min(DICE_MIN_TARGET).max(DICE_MAX_TARGET),
  direction: z.enum(["over", "under"]),
  useBonus: z.boolean().optional(),
});

const RotateBody = z.object({
  clientSeed: z.string().trim().min(1).max(64).optional(),
});

function mapKnownErr(e: unknown): never {
  const msg = (e as Error).message;
  switch (msg) {
    case "INVALID_DICE_TARGET":
      throw badRequest(
        `Target must be between ${DICE_MIN_TARGET} and ${DICE_MAX_TARGET}`,
      );
    case "INVALID_DICE_DIRECTION":
      throw badRequest("Direction must be 'over' or 'under'");
    case "INVALID_STAKE":
      throw badRequest("Stake must be positive");
    case "STAKE_TOO_LARGE":
      throw badRequest("Stake exceeds maximum");
    case "INSUFFICIENT_BONUS_FUNDS":
      throw badRequest("Insufficient bonus balance");
    case "BONUS_NOT_ALLOWED_FOR_GAME":
      throw badRequest("Bonus balance not eligible for this game");
    case "BONUS_NOT_ALLOWED_FOR_PARTNER":
      throw badRequest("Bonus balance cannot be used on partner games");
    case "GAME_DISABLED":
      throw badRequest("Dice is currently disabled");
    case "ROUND_NOT_FOUND":
      throw notFound("Round not found");
    case "BET_NOT_FOUND":
      throw notFound("Bet not found");
    case "BET_ALREADY_SETTLED":
      throw badRequest("Bet already settled");
    case "SEED_INIT_FAILED":
    case "SEED_ROTATE_CONTENDED":
    case "NONCE_CLAIM_CONTENDED":
      throw badRequest("Seed contention; please retry");
    default:
      throw e;
  }
}

router.get("/config", async (_req, res, next) => {
  try {
    const cfg = await requireGameConfig("dice");
    res.json({
      enabled: cfg.enabled,
      houseEdge: cfg.houseEdge,
      maxMultiplier: cfg.maxMultiplier,
      maxStakePaise: cfg.maxStakePaise.toString(),
      minTarget: DICE_MIN_TARGET,
      maxTarget: DICE_MAX_TARGET,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/seed", requireAuth, async (req, res, next) => {
  try {
    try {
      const out = await getActiveSeed(req.user!.id);
      res.json(out);
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

router.post("/seed/rotate", requireAuth, async (req, res, next) => {
  try {
    const body = RotateBody.parse(req.body ?? {});
    try {
      const out = await rotateActiveSeed(req.user!.id, body.clientSeed);
      res.json(out);
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

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

router.post(
  "/roll",
  requireAuth,
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      const input = RollBody.parse(req.body);
      const stake = BigInt(input.stakeAmount);
      try {
        const out = await rollDice({
          userId: req.user!.id,
          stakeAmount: stake,
          target: input.target,
          direction: input.direction,
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

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    try {
      const out = await getRoundForVerify({
        roundId: id,
        userId: req.user!.id,
      });
      res.json(out);
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

router.get("/:id/verify", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    try {
      const raw = await getRawRound({ roundId: id, userId: req.user!.id });
      const round = await getRoundForVerify({
        roundId: id,
        userId: req.user!.id,
      });
      const recomputedHash = sha256Hex(raw.serverSeed);
      const recomputed = deriveDiceOutcome(
        raw.serverSeed,
        raw.clientSeed,
        raw.nonce,
        { houseEdge: raw.houseEdge, maxMultiplier: raw.maxMultiplier },
      );
      const computedDidWin = diceDidWin(
        recomputed.roll,
        raw.target,
        raw.direction,
      );
      const computedMultiplier = computedDidWin
        ? diceMultiplier({
            target: raw.target,
            direction: raw.direction,
            houseEdge: raw.houseEdge,
            maxMultiplier: raw.maxMultiplier,
          })
        : 0;
      const rollMatch = Math.abs(recomputed.roll - raw.roll) < 0.005;
      const winMatch = computedDidWin === raw.didWin;
      const multiplierMatch =
        Math.abs(computedMultiplier - raw.multiplier) < 0.005;
      const hashMatch = recomputedHash === raw.serverSeedHash;
      res.json({
        ...round,
        computedRoll: recomputed.roll,
        computedDidWin,
        computedMultiplier,
        computedWinChance: diceWinChance(raw.target, raw.direction),
        computedHash: recomputedHash,
        hashMatch,
        rollMatch,
        winMatch,
        multiplierMatch,
        verified: hashMatch && rollMatch && winMatch && multiplierMatch,
      });
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
