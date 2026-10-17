import { Router, type IRouter, type RequestHandler } from "express";
import { requireAuth } from "../middlewares/auth";
import { bettingIpRateLimiter, bettingRateLimiter } from "../middlewares/rateLimit";
import { placeWingoBet, wingoState } from "../services/wingo";

const router: IRouter = Router();
router.use(requireAuth);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const validBody: RequestHandler = (req, res, next) => {
  if (!req.is("application/json") || !req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "Expected a JSON object." });
    return;
  }
  next();
};
router.post("/session", validBody, async (req, res, next) => {
  try { res.json(await wingoState(req.user!.id)); }
  catch (error) { next(error); }
});
router.get("/state", async (req, res, next) => {
  try { res.json(await wingoState(req.user!.id, Number(req.query.duration ?? 30))); }
  catch (error) { next(error); }
});
router.post("/bets", bettingIpRateLimiter, bettingRateLimiter, validBody, async (req, res, next) => {
  try { res.json(await placeWingoBet(req.user!.id, req.body)); }
  catch (error) { next(error); }
});
// Old clients cannot mint shared funds through the retired practice refill.
router.post("/refill", (_req, res) => {
  res.status(410).json({ error: "Win Go uses your shared wallet. Open Wallet to add funds." });
});
export default router;
