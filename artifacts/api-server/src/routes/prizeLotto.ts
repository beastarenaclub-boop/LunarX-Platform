import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  bettingIpRateLimiter,
  bettingRateLimiter,
} from "../middlewares/rateLimit";
import { requireStepUp } from "../middlewares/stepUp";
import {
  prizeState,
  buyPrizeTicket,
  cancelPrizeTicket,
  claimPrize,
  fulfillPrize,
  prizeAdminState,
  updatePrizeSettings,
} from "../services/prizeLotto";
const router: IRouter = Router();
const page = (value: unknown) =>
  z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .parse(value ?? 1);
router.use(requireAuth);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.get("/state", async (req, res, next) => {
  try {
    res.json(await prizeState(req.user!.id, page(req.query.page)));
  } catch (e) {
    next(e);
  }
});
router.post(
  "/tickets",
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      res.json(
        await buyPrizeTicket(
          req.user!.id,
          req.body,
          req.get("Idempotency-Key"),
        ),
      );
    } catch (e) {
      next(e);
    }
  },
);
router.post(
  "/tickets/:id/cancel",
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      res.json(await cancelPrizeTicket(req.user!.id, String(req.params.id)));
    } catch (e) {
      next(e);
    }
  },
);
router.post(
  "/tickets/:id/claim",
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      res.json(await claimPrize(req.user!.id, String(req.params.id)));
    } catch (e) {
      next(e);
    }
  },
);
router.get(
  "/admin",
  requireRole("admin", "super_admin", "support"),
  async (req, res, next) => {
    try {
      res.json(
        await prizeAdminState(
          page(req.query.page),
          req.query.claims === "true",
        ),
      );
    } catch (e) {
      next(e);
    }
  },
);
router.put(
  "/admin/settings",
  requireRole("admin", "super_admin"),
  requireStepUp,
  async (req, res, next) => {
    try {
      res.json(await updatePrizeSettings(req.user!.id, req.body));
    } catch (e) {
      next(e);
    }
  },
);
router.post(
  "/admin/tickets/:id/fulfill",
  requireRole("admin", "super_admin"),
  requireStepUp,
  async (req, res, next) => {
    try {
      res.json(
        await fulfillPrize(req.user!.id, String(req.params.id), req.body),
      );
    } catch (e) {
      next(e);
    }
  },
);
export default router;
