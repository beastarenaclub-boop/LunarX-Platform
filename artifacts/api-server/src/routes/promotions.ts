import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  getBonusBalance,
  getWageringStatus,
  getPromotionSettings,
  listLedger,
  BONUS_GAMES,
} from "../services/bonusWallet";
import { getReferralSummary } from "../services/promotions";

const router: IRouter = Router();

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const [balance, wagering, referrals, settings] = await Promise.all([
      getBonusBalance(userId),
      getWageringStatus(userId),
      getReferralSummary(userId),
      getPromotionSettings(),
    ]);
    res.json({
      balance: balance.toString(),
      // UI-friendly aliases plus the raw service fields for callers that
      // already use them. Keep both for backward compatibility.
      wagering: {
        totalIssued: wagering.totalIssued,
        requiredWager: wagering.requiredWager,
        wageredSoFar: wagering.wageredSoFar,
        remaining: wagering.remaining,
        complete: wagering.complete,
        requiredPaise: wagering.requiredWager,
        completedPaise: wagering.wageredSoFar,
        remainingPaise: wagering.remaining,
        multiplier: settings.wageringMultiplier,
      },
      referrals,
      eligibleGames: BONUS_GAMES,
      settings: {
        signupBonusPaise: settings.signupBonusPaise,
        depositTiers: settings.depositTiers,
        referrerRewardPaise: settings.referrerRewardPaise,
        referrerMinDepositPaise: settings.referrerMinDepositPaise,
        wageringMultiplier: settings.wageringMultiplier,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/transactions", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
      200,
    );
    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : null;
    const out = await listLedger({ userId: req.user!.id, limit, cursor });
    res.json({
      entries: out.entries.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount.toString(),
        balanceAfter: e.balanceAfter.toString(),
        refType: e.refType,
        refId: e.refId,
        memo: e.memo,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: out.nextCursor,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
