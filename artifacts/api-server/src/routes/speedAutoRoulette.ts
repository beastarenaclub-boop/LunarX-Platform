import { Router } from "express";
import { z } from "zod";
import { SPEED_ROULETTE_CODE, ROULETTE_LIMITS, ROULETTE_PAYOUT_BASE, ROULETTE_HOUSE_EDGE } from "@workspace/api-zod/roulette-game";
import { requireAuth } from "../middlewares/auth";
import { bettingIpRateLimiter, bettingRateLimiter } from "../middlewares/rateLimit";
import { requireGameConfig } from "../services/rtp";
import { getTableRoundSnapshot, placeTableBets } from "../services/tableRounds";
import { badRequest } from "../lib/errors";

const router = Router();
const input = z.object({
  roundId: z.string().min(1).max(100),
  bets: z.array(z.object({
    type: z.enum(["straight", "split", "street", "corner", "line", "dozen", "column", "red", "black", "odd", "even", "high", "low"]),
    numbers: z.array(z.number().int().min(0).max(36)).max(6).optional(),
    selection: z.number().int().min(1).max(3).optional(),
    amountPaise: z.string().regex(/^[1-9]\d{0,14}$/),
  }).strict()).min(1).max(ROULETTE_LIMITS.maxBetsPerSlip),
}).strict();
router.use(requireAuth);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/config", async (_req, res, next) => {
  try {
    const cfg = await requireGameConfig(SPEED_ROULETTE_CODE);
    res.json({ enabled: cfg.enabled, payoutBase: ROULETTE_PAYOUT_BASE, houseEdge: ROULETTE_HOUSE_EDGE,
      betLimits: ROULETTE_LIMITS, maxStakePaise: cfg.maxStakePaise.toString() });
  } catch (error) { next(error); }
});
router.get("/round", async (req, res, next) => {
  try { res.json(await getTableRoundSnapshot(SPEED_ROULETTE_CODE, req.user!.id)); } catch (error) { next(error); }
});
router.post("/spin", bettingIpRateLimiter, bettingRateLimiter, async (req, res, next) => {
  try {
    const body = input.parse(req.body);
    res.json(await placeTableBets({ ...body, userId: req.user!.id, gameCode: SPEED_ROULETTE_CODE }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known: Record<string, string> = {
      BETTING_CLOSED: "Betting is closed. Wait for the next round.", GAME_DISABLED: "This table is currently unavailable.",
      ROULETTE_BET_TOO_SMALL: "Minimum bet is ₹10 per selection.", ROULETTE_STRAIGHT_LIMIT: "Maximum ₹20,000 per number per round.",
      ROULETTE_OTHER_LIMIT: "Maximum ₹1,00,000 per other selection per round.", INVALID_ROULETTE_BET: "Invalid roulette selection.",
      ROULETTE_BET_IN_PROGRESS: "A bet is already being processed.", TOO_MANY_BETS: "Maximum 40 selections per slip.",
      INSUFFICIENT_FUNDS: "Insufficient balance.", STAKE_TOO_LARGE: "Total stake exceeds the table limit.", STAKE_TOO_SMALL: "Minimum bet is ₹10.",
    };
    next(known[message] ? badRequest(known[message]) : error);
  }
});
export default router;
