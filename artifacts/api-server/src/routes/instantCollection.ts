import { getTableRoundSnapshot } from "../services/tableRounds";
import { coinLiveHistory, placeCoinLive } from "../services/coinFlipLive";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { collectionGame, SEVEN_SPOTS, type CollectionCode } from "@workspace/api-zod/instant-collection";
import { requireAuth } from "../middlewares/auth";
import { bettingIpRateLimiter, bettingRateLimiter } from "../middlewares/rateLimit";
import { badRequest, notFound } from "../lib/errors";
import { instantConfig, instantState, placeInstant, moveInstant } from "../services/instantCollection";
const router: IRouter = Router();
router.use(requireAuth);
router.use((req, _res, next) => req.session?.partnerId ? next(badRequest("Instant games use the shared lobby wallet.")) : next());
router.param("code", (_req, _res, next, code) => collectionGame(code) ? next() : next(notFound("Unknown instant game.")));
const Place = z.object({ requestId: z.string().uuid(), stakeAmount: z.string().regex(/^\d{1,15}$/), clientSeed: z.string().min(8).max(64).regex(/^[a-zA-Z0-9_-]+$/), options: z.object({ difficulty: z.enum(["easy", "medium", "hard"]), mines: z.number().int().min(1).max(10), choice: z.enum(["heads", "tails", "up", "down", "seven", "cast"]), bets: z.array(z.object({ spot: z.enum(SEVEN_SPOTS), amount: z.string().regex(/^[1-9]\d{0,14}$/) }).strict()).min(1).max(13).optional() }).strict() }).strict();
const CoinBet = z.object({ roundId: z.string().min(1).max(100), side: z.enum(["heads", "tails"]), stakeAmount: z.string().regex(/^[1-9]\d{0,14}$/) }).strict();
router.get("/coin-flip/live/round", async (req, res, next) => { try { res.setHeader("Cache-Control", "no-store"); res.json(await getTableRoundSnapshot("coin-flip", req.user!.id)); } catch (e) { next(e); } });
router.get("/coin-flip/live/state", async (req, res, next) => { try { res.setHeader("Cache-Control", "no-store"); res.json({ round: null, history: await coinLiveHistory(req.user!.id) }); } catch (e) { next(e); } });
router.post("/coin-flip/live/bet", bettingIpRateLimiter, bettingRateLimiter, async (req, res, next) => { try { res.json(await placeCoinLive(req.user!.id, CoinBet.parse(req.body))); } catch (e) { next(e); } });
const Move = z.object({ action: z.enum(["reveal", "cashout"]), expectedStep: z.number().int().min(0).max(24), cell: z.number().int().min(0).max(24), actionId: z.string().uuid() }).strict();
router.get("/:code/config", async (req, res, next) => { try { res.json(await instantConfig(req.params.code as CollectionCode)); } catch (e) { next(e); } });
router.get("/:code/state", async (req, res, next) => { try { res.json(await instantState(req.user!.id, req.params.code as CollectionCode)); } catch (e) { next(e); } });
router.post("/:code/place", bettingIpRateLimiter, bettingRateLimiter, async (req, res, next) => {
  try {
    const code = req.params.code as CollectionCode, input = Place.parse(req.body), game = collectionGame(code)!;
    const choices = game.kind === "dice" ? ["up", "down", "seven"] : game.kind === "fishing" ? ["cast"] : ["heads", "tails"];
    if (!choices.includes(input.options.choice)) throw badRequest("Choose a valid outcome.");
    if (input.options.bets && game.kind !== "dice") throw badRequest("Chip bets are only available on 7 Up 7 Down.");
    res.json(await placeInstant(req.user!.id, code, input));
  } catch (e) { next(e); }
});
router.post("/:code/:id/move", bettingIpRateLimiter, bettingRateLimiter, async (req, res, next) => { try { res.json(await moveInstant(req.user!.id, req.params.code as CollectionCode, String(req.params.id), Move.parse(req.body))); } catch (e) { next(e); } });
export default router;
