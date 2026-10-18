import gameplayRouter from "./gameplay";
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import profileRouter from "./profile";
import kycRouter from "./kyc";
import paymentsRouter from "./payments";
import adminRouter from "./admin";
import ticketsRouter from "./tickets";
import notificationsRouter from "./notifications";
import bannersRouter from "./banners";
import agentRouter from "./agent";
import networkRouter from "./network";
import webhooksRouter from "./webhooks";
import demoNudgeRouter from "./demoNudge";
import partnersAdminRouter from "./partnersAdmin";
import launcherRouter from "./launcher";
import promotionsRouter from "./promotions";
import freeBetsRouter from "./freeBets";
import { forbidden } from "../lib/errors";

const router: IRouter = Router();

// Business wallet float cannot be wagered by operator accounts.
router.use((req, _res, next) => {
  if (req.user?.role === "agent" && !/^\/(auth|network|agent|wallet|notifications|tickets)(\/|$)/.test(req.path)) {
    return next(forbidden("Operator accounts manage downlines; use a player account to play"));
  }
  next();
});

router.use(gameplayRouter);
router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/profile", profileRouter);
router.use("/kyc", kycRouter);
router.use("/payments", paymentsRouter);
router.use("/admin", adminRouter);
router.use("/admin", partnersAdminRouter);
router.use("/tickets", ticketsRouter);
router.use("/notifications", notificationsRouter);
router.use("/banners", bannersRouter);
router.use("/agent", (_req, res) => {
  res.status(410).json({error:{code:"LEGACY_REFERRALS_RETIRED",message:"Use the branch panel and /api/network. Legacy referral reports remain with admin."}});
});
router.use("/network", networkRouter);
router.use("/webhooks", webhooksRouter);
router.use("/demo-nudge", demoNudgeRouter);
router.use("/launcher", launcherRouter);
router.use("/promotions", promotionsRouter);
router.use(freeBetsRouter);

export default router;
