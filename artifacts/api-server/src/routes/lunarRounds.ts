import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { settleRoundPariMutuel } from "../services/roundSettlement";
import { badRequest } from "../lib/errors";
import { z } from "zod";

const router: IRouter = Router();

const SettleParams = z.object({
  roundId: z.string().min(1).max(128),
});

/**
 * Settlement trigger. The endpoint is auth-required and the underlying
 * service performs all authoritative checks itself (round exists, every
 * bet is terminal, game is configured for pari_mutuel) — gameCode is
 * derived from the bet rows themselves so the caller can NOT manipulate
 * which game's settlement engine runs. Settlement is idempotent on
 * (round_id, game_code), so multiple players triggering at the end of a
 * round all converge to the same single result.
 */
router.post("/round/:roundId/settle", requireAuth, async (req, res, next) => {
  try {
    const params = SettleParams.parse(req.params);
    const result = await settleRoundPariMutuel(params.roundId);
    if (!result) {
      res.json({ status: "already_settled_or_disabled" });
      return;
    }
    res.json({
      status: "settled",
      settlementId: result.settlementId,
      gameCode: result.gameCode,
      totalPool: result.totalPool.toString(),
      playerPool: result.playerPool.toString(),
      companyProfit: result.companyProfit.toString(),
      winnerCount: result.winnerCount,
      loserCount: result.loserCount,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(badRequest(err.issues[0]?.message ?? "Invalid input"));
      return;
    }
    next(err);
  }
});

export default router;
