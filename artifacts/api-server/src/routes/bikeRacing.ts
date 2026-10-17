import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { bettingRateLimiter, bettingIpRateLimiter } from "../middlewares/rateLimit";
import { bikeGameConfig } from "../services/bikeGame";
import { bikeLiveState, placeBikeLiveBet } from "../services/bikeLiveGame";

const router: IRouter = Router();
const slip = z.object({
  roundId: z.string().min(1).max(80), requestId: z.string().uuid(), venueId: z.literal("apex"),
  bets: z.array(z.object({ bikeId: z.number().int().min(1).max(6), amountPaise: z.string().regex(/^\d{1,18}$/) }).strict()).min(1).max(6),
}).strict();
router.get("/game/config", requireAuth, async (_req, res, next) => {
  try { res.json(await bikeGameConfig()); } catch (e) { next(e); }
});
router.get("/game/live", requireAuth, async (req, res, next) => {
  try { res.json(await bikeLiveState(req.user!.id)); } catch (e) { next(e); }
});
router.post("/game/live", requireAuth, bettingIpRateLimiter, bettingRateLimiter, async (req, res, next) => {
  try { res.json(await placeBikeLiveBet(req.user!.id, slip.parse(req.body))); } catch (e) { next(e); }
});
export default router;
