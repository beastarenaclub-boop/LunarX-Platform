import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  L7_GAME,
  L7_SPOTS,
  L7_PROFIT,
  L7_VERSION,
} from "@workspace/api-zod/lucky7-live";
import { requireAuth } from "../middlewares/auth";
import {
  bettingIpRateLimiter,
  bettingRateLimiter,
} from "../middlewares/rateLimit";
import { getTableRoundSnapshot } from "../services/tableRounds";
import { requireGameConfig } from "../services/rtp";
import { placeL7Live, l7History, verifyL7Live } from "../services/lucky7Live";
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
            spot: z.enum(L7_SPOTS),
            amountPaise: z.string().regex(/^[1-9]\d{0,14}$/),
          })
          .strict(),
      )
      .min(1)
      .max(7),
  })
  .strict();
router.get("/config", async (_req, res, next) => {
  try {
    const c = await requireGameConfig(L7_GAME);
    res.json({
      enabled: c.enabled,
      minStakePaise: String(c.minStakePaise),
      maxStakePaise: String(c.maxStakePaise),
      payouts: L7_PROFIT,
      version: L7_VERSION,
    });
  } catch (e) {
    next(e);
  }
});
router.get("/round", async (req, res, next) => {
  try {
    res.json(await getTableRoundSnapshot(L7_GAME, req.user!.id));
  } catch (e) {
    next(e);
  }
});
router.get("/history", async (req, res, next) => {
  try {
    res.json(await l7History(req.user!.id));
  } catch (e) {
    next(e);
  }
});
router.get("/:id/verify", async (req, res, next) => {
  try {
    res.json(await verifyL7Live(String(req.params.id)));
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
      res.json(await placeL7Live(req.user!.id, input.roundId, input.bets));
    } catch (e) {
      next(e);
    }
  },
);
export default router;
