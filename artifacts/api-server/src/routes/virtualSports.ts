import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { bettingIpRateLimiter, bettingRateLimiter } from "../middlewares/rateLimit";
import { placeVirtualSportsBet, virtualSportsState } from "../services/virtualSports";

const router: IRouter = Router();
router.use(requireAuth);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/state", async (req, res, next) => {
  try { res.json(await virtualSportsState(req.user!.id)); } catch (error) { next(error); }
});
router.post("/bets", bettingIpRateLimiter, bettingRateLimiter, async (req, res, next) => {
  if (!req.is("application/json") || req.get("X-Sports-Client") !== "1") {
    res.status(400).json({ error: "Expected a sports client JSON request." }); return;
  }
  // Older practice-only screens must never debit the shared wallet.
  if (req.get("X-Sports-Wallet") !== "1") {
    res.status(409).json({ error: "Refresh virtual sports to connect your shared wallet before placing a bet." }); return;
  }
  try { res.json(await placeVirtualSportsBet(req.user!.id, req.body)); } catch (error) { next(error); }
});
router.post("/refill", (_req, res) => {
  res.status(410).json({ error: "Virtual sports uses your shared wallet. Open Wallet to add funds." });
});
export default router;
