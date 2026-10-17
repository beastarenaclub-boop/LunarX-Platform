import { Router, type IRouter } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { CHICKEN_DIFFICULTIES } from "@workspace/api-zod/chicken-road-game";
import { requireAuth } from "../middlewares/auth";
import { bettingIpRateLimiter, bettingRateLimiter } from "../middlewares/rateLimit";
import { badRequest } from "../lib/errors";
import { chickenConfig, chickenState, getChickenRound, startChicken, moveChicken } from "../services/chickenRoad";

const router: IRouter = Router();
router.use(requireAuth);
// This native game uses the lobby's shared wallet. Partner callback wallets
// require a dedicated integration rather than falling back to local cash.
router.use((req, _res, next) => req.session?.partnerId ? next(badRequest("Chicken Road is available through the shared lobby wallet.")) : next());
const Place = z.object({
  requestId: z.string().uuid(), difficulty: z.enum(CHICKEN_DIFFICULTIES),
  stakeAmount: z.string().regex(/^\d{1,15}$/), clientSeed: z.string().min(8).max(64).regex(/^[a-zA-Z0-9_-]+$/),
}).strict();
const Move = z.object({ expectedStep: z.number().int().min(0).max(24) }).strict();
const moveLimiter = rateLimit({ windowMs: 60000, limit: 240, keyGenerator: req => req.user!.id, standardHeaders: "draft-7", legacyHeaders: false });
router.get("/config", async (_req, res, next) => { try { res.json(await chickenConfig()); } catch (e) { next(e); } });
router.get("/state", async (req, res, next) => { try { res.json(await chickenState(req.user!.id)); } catch (e) { next(e); } });
router.post("/place", bettingIpRateLimiter, bettingRateLimiter, async (req, res, next) => {
  try { res.json(await startChicken(req.user!.id, Place.parse(req.body))); } catch (e) { next(e); }
});
router.get("/:id", async (req, res, next) => { try { res.json(await getChickenRound(req.user!.id, String(req.params.id))); } catch (e) { next(e); } });
for (const action of ["step", "cashout"] as const) router.post(`/:id/${action}`, moveLimiter, async (req, res, next) => {
  try { res.json(await moveChicken(req.user!.id, String(req.params.id), action, Move.parse(req.body).expectedStep)); } catch (e) { next(e); }
});
export default router;
