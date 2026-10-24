import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  JOKER_GAME,
  JOKER_SPOTS,
  JOKER_RETURNS,
  JOKER_VERSION,
} from "@workspace/api-zod/teenpatti-joker";
import { requireAuth } from "../middlewares/auth";
import {
  bettingIpRateLimiter,
  bettingRateLimiter,
} from "../middlewares/rateLimit";
import { getTableRoundSnapshot } from "../services/tableRounds";
import { requireGameConfig } from "../services/rtp";
import {
  placeJokerBets,
  jokerHistory,
  verifyJokerRound,
} from "../services/teenPattiJoker";
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
            spot: z.enum(JOKER_SPOTS),
            amountPaise: z.string().regex(/^[1-9]\d{0,14}$/),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
router.get("/config", async (_req, res, next) => {
  try {
    const c = await requireGameConfig(JOKER_GAME);
    res.json({
      enabled: c.enabled,
      minStakePaise: String(c.minStakePaise),
      maxStakePaise: String(c.maxStakePaise),
      payouts: Object.fromEntries(
        Object.entries(JOKER_RETURNS).map(([spot, value]) => [
          spot,
          value / 100,
        ]),
      ),
      version: JOKER_VERSION,
    });
  } catch (e) {
    next(e);
  }
});
router.get("/round", async (req, res, next) => {
  try {
    res.json(await getTableRoundSnapshot(JOKER_GAME, req.user!.id));
  } catch (e) {
    next(e);
  }
});
router.get("/history", async (req, res, next) => {
  try {
    res.json(await jokerHistory(req.user!.id));
  } catch (e) {
    next(e);
  }
});
router.get("/:id/verify", async (req, res, next) => {
  try {
    res.json(await verifyJokerRound(String(req.params.id)));
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
      res.json(await placeJokerBets(req.user!.id, input.roundId, input.bets));
    } catch (e) {
      next(e);
    }
  },
);
export default router;
