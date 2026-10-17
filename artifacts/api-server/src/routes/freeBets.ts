import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  freeBetsSummary,
  grantFreeBets,
  listGrantsAdmin,
  createRainEvent,
  activeRain,
  claimRain,
} from "../services/freeBets";
import { badRequest, notFound, conflict } from "../lib/errors";
import { recordAuditFromReq } from "../lib/audit";

const router: IRouter = Router();
const adminOnly = requireRole("admin", "super_admin");

const AmountStr = z
  .string()
  .regex(/^\d{1,18}$/u, "amountPaise must be positive integer paise");

function grantDto(g: {
  id: string;
  userId: string;
  gameCode: string;
  amountPaise: bigint;
  totalCount: number;
  remainingCount: number;
  source: string;
  expiresAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: g.id,
    userId: g.userId,
    gameCode: g.gameCode,
    amountPaise: g.amountPaise.toString(),
    totalCount: g.totalCount,
    remainingCount: g.remainingCount,
    source: g.source,
    expiresAt: g.expiresAt?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
  };
}

function rainDto(r: {
  id: string;
  gameCode: string;
  amountPaise: bigint;
  betsPerClaim: number;
  maxClaims: number;
  claimedCount: number;
  message: string | null;
  expiresAt: Date;
  createdAt: Date;
}) {
  return {
    id: r.id,
    gameCode: r.gameCode,
    amountPaise: r.amountPaise.toString(),
    betsPerClaim: r.betsPerClaim,
    maxClaims: r.maxClaims,
    claimedCount: r.claimedCount,
    message: r.message,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

// Player: my active free bets for a game.
router.get("/free-bets", requireAuth, async (req, res, next) => {
  try {
    const gameCode =
      typeof req.query.gameCode === "string" ? req.query.gameCode : "lunar";
    const s = await freeBetsSummary(req.user!.id, gameCode);
    res.json({
      count: s.count,
      nextAmountPaise: s.nextAmountPaise.toString(),
      grants: s.grants.map(grantDto),
    });
  } catch (err) {
    next(err);
  }
});

// Player: currently claimable rain drop (if any).
router.get("/rain/active", requireAuth, async (req, res, next) => {
  try {
    const gameCode =
      typeof req.query.gameCode === "string" && req.query.gameCode
        ? req.query.gameCode
        : "lunar";
    const rain = await activeRain(gameCode);
    res.json({ rain: rain ? rainDto(rain) : null });
  } catch (err) {
    next(err);
  }
});

// Player: claim a rain drop — first-come-first-served.
router.post("/rain/:id/claim", requireAuth, async (req, res, next) => {
  try {
    try {
      const { grant, rain } = await claimRain(
        String(req.params.id),
        req.user!.id,
      );
      res.json({ grant: grantDto(grant), rain: rainDto(rain) });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "RAIN_NOT_FOUND") throw notFound("Rain not found");
      if (msg === "RAIN_EXPIRED") throw badRequest("Rain has expired");
      if (msg === "RAIN_ALREADY_CLAIMED")
        throw conflict("You already claimed this rain");
      if (msg === "RAIN_FULLY_CLAIMED")
        throw conflict("All claims are gone — better luck next rain!");
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

// ---- Admin -----------------------------------------------------------------

const GrantBody = z.object({
  userId: z.string().min(1),
  gameCode: z.string().min(1).max(32).optional(),
  amountPaise: AmountStr,
  count: z.number().int().min(1).max(1000),
  expiresInHours: z.number().int().min(1).max(24 * 90).optional(),
});

router.post("/admin/free-bets", adminOnly, async (req, res, next) => {
  try {
    const input = GrantBody.parse(req.body);
    const amount = BigInt(input.amountPaise);
    if (amount <= 0n) throw badRequest("Amount must be positive");
    const grant = await grantFreeBets({
      userId: input.userId,
      gameCode: input.gameCode,
      amountPaise: amount,
      count: input.count,
      source: "admin",
      grantedBy: req.user!.id,
      expiresAt: input.expiresInHours
        ? new Date(Date.now() + input.expiresInHours * 3600_000)
        : null,
    });
    await recordAuditFromReq(req, {
      action: "free_bets.grant",
      targetType: "user",
      targetId: input.userId,
      after: { amountPaise: input.amountPaise, count: input.count },
    });
    res.json(grantDto(grant));
  } catch (err) {
    next(err);
  }
});

router.get("/admin/free-bets", adminOnly, async (req, res, next) => {
  try {
    const userId =
      typeof req.query.userId === "string" && req.query.userId
        ? req.query.userId
        : null;
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
      200,
    );
    const grants = await listGrantsAdmin({ userId, limit });
    res.json({ entries: grants.map(grantDto) });
  } catch (err) {
    next(err);
  }
});

const RainBody = z.object({
  amountPaise: AmountStr,
  betsPerClaim: z.number().int().min(1).max(20).optional(),
  maxClaims: z.number().int().min(1).max(500),
  message: z.string().max(200).optional(),
  ttlSeconds: z.number().int().min(15).max(3600).optional(),
});

router.post("/admin/rain", adminOnly, async (req, res, next) => {
  try {
    const input = RainBody.parse(req.body);
    const amount = BigInt(input.amountPaise);
    if (amount <= 0n) throw badRequest("Amount must be positive");
    const rain = await createRainEvent({
      amountPaise: amount,
      betsPerClaim: input.betsPerClaim,
      maxClaims: input.maxClaims,
      message: input.message ?? null,
      createdBy: req.user!.id,
      ttlMs: (input.ttlSeconds ?? 120) * 1000,
    });
    await recordAuditFromReq(req, {
      action: "rain.create",
      targetType: "rain",
      targetId: rain.id,
      after: { amountPaise: input.amountPaise, maxClaims: input.maxClaims },
    });
    res.json(rainDto(rain));
  } catch (err) {
    next(err);
  }
});

export default router;
