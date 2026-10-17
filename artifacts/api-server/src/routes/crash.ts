import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { currentCrashRound } from "../services/crashRounds";
const router = Router();
router.get("/:gameCode", requireAuth, async (req, res, next) => {
  try {
    res.json(
      await currentCrashRound(
        req.user!.id,
        String(req.params.gameCode),
        typeof req.query.roundId === "string" ? req.query.roundId : undefined,
        typeof req.query.clientSeed === "string"
          ? req.query.clientSeed
          : undefined,
        req.query.turbo === "true",
      ),
    );
  } catch (error) {
    next(error);
  }
});
export default router;
