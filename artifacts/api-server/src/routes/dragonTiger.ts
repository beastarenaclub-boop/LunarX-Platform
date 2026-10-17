import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import { dragonTigerTable } from "../services/dragonTiger";

const router: IRouter = Router();
const amount = z.number().int().min(0).max(5000).multipleOf(10);
const slip = z
  .object({
    roundId: z.number().int().positive(),
    spots: z.object({ dragon: amount, tiger: amount, tie: amount }).strict(),
  })
  .strict();

router.use(requireAuth);
router.get("/table", async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await dragonTigerTable(req.user!.id));
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
      res.json(await dragonTigerTable(req.user!.id, slip.parse(req.body)));
    } catch (error) {
      next(error);
    }
  },
);

export default router;
