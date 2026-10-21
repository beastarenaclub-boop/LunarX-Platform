import { Router } from "express";
import { z } from "zod";
import { POKER_GAMES } from "@workspace/api-zod/poker";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import { pokerTable } from "../services/poker";
const router = Router();
const input = z
  .object({
    roundId: z.number().int().positive(),
    quoteId: z.string().max(90),
    requestId: z.string().uuid(),
    selections: z
      .array(
        z
          .object({
            market: z.string().max(30),
            amountPaise: z.string().regex(/^[1-9]\d{0,6}$/),
          })
          .strict(),
      )
      .min(1)
      .max(18),
  })
  .strict();
router.use(requireAuth);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.get("/:game/table", async (req, res, next) => {
  try {
    res.json(
      await pokerTable(
        req.user!.id,
        z.enum(POKER_GAMES).parse(req.params.game),
      ),
    );
  } catch (error) {
    next(error);
  }
});
router.post(
  "/:game/bet",
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      res.json(
        await pokerTable(
          req.user!.id,
          z.enum(POKER_GAMES).parse(req.params.game),
          input.parse(req.body),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);
export default router;
