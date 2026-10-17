import { Router, type IRouter, type RequestHandler } from "express";
import { forexState, placeForexTrade } from "../services/forex";
import { requireAuth } from "../middlewares/auth";
import { forexQuoteFeed } from "../../../../lib/forex/quotes.mjs";
import {
  bettingIpRateLimiter,
  bettingRateLimiter,
} from "../middlewares/rateLimit";

const router: IRouter = Router();
router.use(requireAuth);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.get("/quotes", async (_req, res, next) => {
  try { res.json(await forexQuoteFeed.read()); } catch (error) { next(error); }
});
router.get("/state", async (req, res, next) => {
  try {
    res.json(await forexState(req.user!.id));
  } catch (error) {
    next(error);
  }
});
const validBody: RequestHandler = (req, res, next) => {
  if (!req.is("application/json") || !req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "Expected a JSON object." });
    return;
  }
  next();
};
router.post("/session", validBody, async (req, res, next) => {
  try { res.json(await forexState(req.user!.id)); } catch (error) { next(error); }
});
router.post("/trades", bettingIpRateLimiter, bettingRateLimiter, validBody, async (req, res, next) => {
  try { res.json(await placeForexTrade(req.user!.id, req.body)); } catch (error) { next(error); }
});
router.post("/refill", (_req, res) => {
  res.status(410).json({ error: "Forex Trading uses your shared wallet. Open Wallet to add funds." });
});
export default router;
