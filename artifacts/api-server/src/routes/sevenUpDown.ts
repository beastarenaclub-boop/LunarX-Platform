import { Router, type IRouter } from "express";
import { z } from "zod";
import { SEVEN_SPOTS } from "@workspace/api-zod/instant-collection";
import { requireAuth } from "../middlewares/auth";
import { bettingIpRateLimiter, bettingRateLimiter } from "../middlewares/rateLimit";
import { getTableRoundSnapshot } from "../services/tableRounds";
import { instantConfig } from "../services/instantCollection";
import { placeSevenLive, sevenLiveHistory, SEVEN_CODE } from "../services/sevenUpDownLive";
import { badRequest } from "../lib/errors";

const router: IRouter = Router();
router.use(requireAuth);
router.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); return req.session?.partnerId ? next(badRequest("This table uses the shared lobby wallet.")) : next(); });
const Bet = z.object({ roundId: z.string().min(1).max(100), bets: z.array(z.object({ spot: z.enum(SEVEN_SPOTS), amount: z.string().regex(/^[1-9]\d{0,14}$/) }).strict()).min(1).max(13) }).strict();
router.get("/config", async (_req, res, next) => { try { res.json(await instantConfig(SEVEN_CODE)); } catch (e) { next(e); } });
router.get("/round", async (req, res, next) => { try { res.json(await getTableRoundSnapshot(SEVEN_CODE, req.user!.id)); } catch (e) { next(e); } });
router.get("/state", async (req, res, next) => { try { res.json({ round: null, history: await sevenLiveHistory(req.user!.id) }); } catch (e) { next(e); } });
router.post("/bet", bettingIpRateLimiter, bettingRateLimiter, async (req, res, next) => { try { const input = Bet.parse(req.body); res.json(await placeSevenLive(req.user!.id, input.roundId, input.bets)); } catch (e) { next(e); } });
export default router;
