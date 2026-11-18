import { Router, type IRouter } from "express";
import { requireRole } from "../middlewares/roles";
import { getLobbyLayout, saveLobbyLayout } from "../services/lobbyLayout";
import { saveLobbyLayoutSchema } from "@workspace/api-zod/lobby-layout";
import { clientIp } from "../lib/audit";

const router: IRouter = Router();
router.get("/lobby/layout", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store").json(await getLobbyLayout());
  } catch (error) {
    next(error);
  }
});
router.get(
  "/admin/lobby-layout",
  requireRole("admin", "super_admin"),
  async (_req, res, next) => {
    try {
      res.set("Cache-Control", "no-store").json(await getLobbyLayout());
    } catch (error) {
      next(error);
    }
  },
);
router.put(
  "/admin/lobby-layout",
  requireRole("admin", "super_admin"),
  async (req, res, next) => {
    try {
      const input = saveLobbyLayoutSchema.parse(req.body);
      res.set("Cache-Control", "no-store").json(
        await saveLobbyLayout(input.revision, input.layout, {
          action: "lobby_layout.update",
          actorId: req.user!.id,
          actorRole: req.user!.role,
          ip: clientIp(req),
          userAgent: req.get("user-agent") ?? null,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);
export default router;
