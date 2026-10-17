import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { bettingIpRateLimiter, bettingRateLimiter } from "../middlewares/rateLimit";
import { requireStepUp } from "../middlewares/stepUp";
import { lotteryState, buyLotteryTicket, cancelLotteryTicket, lotteryAdminState, updateLotterySettings } from "../services/lottery";
const router: IRouter = Router();
router.use(requireAuth);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/bootstrap", async (req, res, next) => {
  try { res.json(await lotteryState(req.user!.id)); } catch (error) { next(error); }
});
router.post("/tickets", bettingIpRateLimiter, bettingRateLimiter, async (req, res, next) => {
  try { res.json(await buyLotteryTicket(req.user!.id, req.body, req.get("Idempotency-Key"))); } catch (error) { next(error); }
});
router.post("/tickets/:id/cancel", bettingIpRateLimiter, bettingRateLimiter, async (req, res, next) => {
  try { res.json(await cancelLotteryTicket(req.user!.id, String(req.params.id))); } catch (error) { next(error); }
});
router.get("/admin", requireRole("admin", "super_admin", "support"), async (req, res, next) => {
  try { res.json(await lotteryAdminState(z.coerce.number().int().min(1).max(100000).parse(req.query.page ?? 1))); } catch (error) { next(error); }
});
router.put("/admin/settings", requireRole("admin", "super_admin"), requireStepUp, async (req, res, next) => {
  try { res.json(await updateLotterySettings(req.user!.id, req.body)); } catch (error) { next(error); }
});
export default router;
