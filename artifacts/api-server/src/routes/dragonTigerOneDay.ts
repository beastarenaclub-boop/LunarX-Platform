import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import { oneDayTable } from "../services/dragonTigerOneDay";
const router: IRouter = Router();
const input = z
  .object({
    roundId: z.number().int().positive(),
    stage: z.enum(["first", "second"]),
    quoteId: z.string().max(60),
    selections: z
      .array(
        z
          .object({
            market: z.string().max(40),
            amountPaise: z.string().regex(/^[1-9]\d{0,6}$/),
          })
          .strict(),
      )
      .min(1)
      .max(56),
  })
  .strict();
router.use(requireAuth);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.get("/table", async (req, res, next) => {
  try {
    res.json(await oneDayTable(req.user!.id));
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
      res.json(await oneDayTable(req.user!.id, input.parse(req.body)));
    } catch (error) {
      next(error);
    }
  },
);
export default router;
