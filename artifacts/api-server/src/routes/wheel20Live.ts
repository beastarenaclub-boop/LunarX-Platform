import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  W20_GAME,
  W20_SPOTS,
  W20_PROFIT,
  W20_VERSION,
} from "@workspace/api-zod/wheel20-live";
import { requireAuth } from "../middlewares/auth";
import {
  bettingIpRateLimiter,
  bettingRateLimiter,
} from "../middlewares/rateLimit";
import { getTableRoundSnapshot } from "../services/tableRounds";
import { requireGameConfig } from "../services/rtp";
import {
  placeW20Live,
  w20History,
  verifyW20Live,
} from "../services/wheel20Live";
import { badRequest } from "../lib/errors";
const router: IRouter = Router();
router.use(requireAuth);
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  return req.session?.partnerId
    ? next(badRequest("This table uses the shared lobby wallet."))
    : next();
});
const Bet = z
  .object({
    roundId: z.string().min(1).max(100),
    bets: z
      .array(
        z
          .object({
            spot: z.enum(W20_SPOTS),
            amountPaise: z.string().regex(/^[1-9]\d{0,14}$/),
          })
          .strict(),
      )
      .min(1)
      .max(9),
  })
  .strict();
router.get("/config", async (_req, res, next) => {
  try {
    const c = await requireGameConfig(W20_GAME);
    res.json({
      enabled: c.enabled,
      minStakePaise: String(c.minStakePaise),
      maxStakePaise: String(c.maxStakePaise),
      payouts: W20_PROFIT,
      version: W20_VERSION,
    });
  } catch (e) {
    next(e);
  }
});
router.get("/round", async (req, res, next) => {
  try {
    res.json(await getTableRoundSnapshot(W20_GAME, req.user!.id));
  } catch (e) {
    next(e);
  }
});
router.get("/history", async (req, res, next) => {
  try {
    res.json(await w20History(req.user!.id));
  } catch (e) {
    next(e);
  }
});
router.get("/:id/verify", async (req, res, next) => {
  try {
    res.json(await verifyW20Live(String(req.params.id)));
  } catch (e) {
    next(e);
  }
});
router.post(
  "/bet",
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      const input = Bet.parse(req.body);
      res.json(await placeW20Live(req.user!.id, input.roundId, input.bets));
    } catch (e) {
      next(e);
    }
  },
);
export default router;
