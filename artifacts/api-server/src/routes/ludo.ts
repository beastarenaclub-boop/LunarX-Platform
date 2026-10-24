import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middlewares/auth";
import {
  bettingIpRateLimiter,
  bettingRateLimiter,
} from "../middlewares/rateLimit";
import { actLudo, joinLudo, ludoProof, ludoTable } from "../services/ludo";
import { forbidden } from "../lib/errors";
const router = Router();
const moveLimiter = rateLimit({
  windowMs: 60000,
  limit: 180,
  keyGenerator: (req) => req.user?.id ?? "anon",
  validate: { xForwardedForHeader: false, ip: false },
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: { message: "Please slow down and wait for the board to update" },
  },
});
router.use(requireAuth);
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.session?.partnerId)
    return next(forbidden("Ludo is available with a site player wallet"));
  next();
});
router.get("/state", async (req, res, next) => {
  try {
    res.json(await ludoTable(req.user!.id));
  } catch (e) {
    next(e);
  }
});
router.get("/:id/proof", async (req, res, next) => {
  try {
    res.json(
      await ludoProof(req.user!.id, z.string().uuid().parse(req.params.id)),
    );
  } catch (e) {
    next(e);
  }
});
router.post(
  "/join",
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      const input = z
        .object({
          capacity: z.union([z.literal(2), z.literal(4)]),
          entryPaise: z.number().int().positive(),
          requestId: z.string().uuid(),
        })
        .strict()
        .parse(req.body);
      res.json(await joinLudo(req.user!.id, input));
    } catch (e) {
      next(e);
    }
  },
);
router.post("/:id/action", moveLimiter, async (req, res, next) => {
  try {
    const input = z
      .object({
        type: z.enum(["roll", "move", "leave"]),
        version: z.number().int().nonnegative(),
        requestId: z.string().uuid(),
        token: z.number().int().min(0).max(3).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await actLudo(
        req.user!.id,
        z.string().uuid().parse(req.params.id),
        input,
      ),
    );
  } catch (e) {
    next(e);
  }
});
export default router;
