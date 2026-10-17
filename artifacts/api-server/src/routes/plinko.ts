import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import {
  dropBall,
  listRecentRounds,
  getRoundForVerify,
  getRawRound,
  getActiveSeed,
  rotateActiveSeed,
} from "../services/plinko";
import {
  PLINKO_ROWS_OPTIONS,
  PLINKO_RISK_OPTIONS,
  plinkoMultiplierTable,
  requireGameConfig,
  sha256Hex,
  derivePlinkoOutcome,
} from "../services/rtp";
import { badRequest, notFound } from "../lib/errors";

const router: IRouter = Router();

const DropBody = z.object({
  stakeAmount: z
    .string()
    .regex(/^\d{1,18}$/u, "stakeAmount must be positive integer paise"),
  rows: z.union([z.literal(8), z.literal(12), z.literal(16)]),
  risk: z.enum(["low", "medium", "high"]),
  useBonus: z.boolean().optional(),
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
    case "INVALID_PLINKO_ROWS":
      throw badRequest("Invalid rows (must be 8, 12, or 16)");
    case "INVALID_PLINKO_RISK":
      throw badRequest("Invalid risk (must be low, medium, or high)");
    case "INVALID_PLINKO_SHAPE":
      throw badRequest("Invalid plinko shape");
    case "INVALID_STAKE":
      throw badRequest("Stake must be positive");
    case "STAKE_TOO_LARGE":
      throw badRequest("Stake exceeds maximum");
    case "GAME_DISABLED":
      throw badRequest("Plinko is currently disabled");
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

const RotateBody = z.object({
  clientSeed: z.string().trim().min(1).max(64).optional(),
});

router.get("/config", async (_req, res, next) => {
  try {
    const cfg = await requireGameConfig("plinko");
    const tables: Record<string, Record<string, number[]>> = {};
    for (const risk of PLINKO_RISK_OPTIONS) {
      tables[risk] = {};
      for (const rows of PLINKO_ROWS_OPTIONS) {
        tables[risk]![String(rows)] = plinkoMultiplierTable(
          rows,
          risk,
          cfg.houseEdge,
          cfg.maxMultiplier,
        );
      }
    }
    res.json({
      enabled: cfg.enabled,
      houseEdge: cfg.houseEdge,
      maxMultiplier: cfg.maxMultiplier,
      maxStakePaise: cfg.maxStakePaise.toString(),
      rowsOptions: PLINKO_ROWS_OPTIONS,
      riskOptions: PLINKO_RISK_OPTIONS,
      multipliers: tables,
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
  "/drop",
  requireAuth,
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      const input = DropBody.parse(req.body);
      const stake = BigInt(input.stakeAmount);
      try {
        const out = await dropBall({
          userId: req.user!.id,
          stakeAmount: stake,
          rows: input.rows,
          risk: input.risk,
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
      // Rotation-aware: serverSeed is null while the round's seed is still
      // the user's active seed; revealed once it has been rotated.
      const out = await getRoundForVerify({ roundId: id, userId: req.user!.id });
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
      // Internally we need the raw seed to recompute, but the response
      // payload (`round`) has it stripped unless the seed has been rotated.
      const raw = await getRawRound({ roundId: id, userId: req.user!.id });
      const round = await getRoundForVerify({
        roundId: id,
        userId: req.user!.id,
      });
      const recomputedHash = sha256Hex(raw.serverSeed);
      const recomputed = derivePlinkoOutcome(
        raw.serverSeed,
        raw.clientSeed,
        raw.nonce,
        { houseEdge: raw.houseEdge, maxMultiplier: raw.maxMultiplier },
        { rows: raw.rows, risk: raw.risk },
      );
      const pathStr = recomputed.path.map((r) => (r ? "R" : "L"));
      const storedPath = round.path;
      const pathMatch =
        pathStr.length === storedPath.length &&
        pathStr.every((p, i) => p === storedPath[i]);
      const bucketMatch = recomputed.bucket === raw.bucket;
      const multiplierMatch =
        Math.abs(recomputed.multiplier - raw.multiplier) < 0.005;
      const hashMatch = recomputedHash === raw.serverSeedHash;
      res.json({
        ...round,
        computedPath: pathStr,
        computedBucket: recomputed.bucket,
        computedMultiplier: recomputed.multiplier,
        // computedHash is always returned: it's the SHA-256 of the round's
        // server seed and is identical to the publicly-committed
        // serverSeedHash (already exposed via /seed and /drop). It does not
        // leak the raw seed, so it's safe to echo regardless of rotation.
        computedHash: recomputedHash,
        hashMatch,
        pathMatch,
        bucketMatch,
        multiplierMatch,
        verified: hashMatch && pathMatch && bucketMatch && multiplierMatch,
      });
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
