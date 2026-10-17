import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { bettingIpRateLimiter, bettingRateLimiter } from "../middlewares/rateLimit";
import { rummyTable } from "../services/rummy";
import { STAKES } from "@workspace/api-zod/rummy";

const stake = z.number().int().refine(v => STAKES.includes(v as typeof STAKES[number]));
const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), stake }).strict(),
  z.object({ type: z.literal("auto-start"), stake, rounds: z.number().int().min(1).max(50),
    lossLimit: z.number().positive().max(1e8), profitTarget: z.number().positive().max(1e8) }).strict(),
  z.object({ type: z.literal("auto-stop") }).strict(),
  z.object({ type: z.literal("auto-play"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("drop") }).strict(),
  z.object({ type: z.literal("draw"), source: z.enum(["stock", "open"]) }).strict(),
  z.object({ type: z.literal("discard"), id: z.string().min(1).max(40), declare: z.boolean().optional() }).strict(),
]);
const router = Router();
router.use(requireAuth);
router.get("/table", async (req, res, next) => {
  try { res.setHeader("Cache-Control", "no-store"); res.json(await rummyTable(req.user!.id, req.user!.displayName ?? "You")); }
  catch (e) { next(e); }
});
router.post("/action", bettingIpRateLimiter, bettingRateLimiter, async (req, res, next) => {
  try { const input = z.object({ version: z.number().int().min(0), action }).strict().parse(req.body);
    res.json(await rummyTable(req.user!.id, req.user!.displayName ?? "You", input)); }
  catch (e) { next(e); }
});
export default router;
