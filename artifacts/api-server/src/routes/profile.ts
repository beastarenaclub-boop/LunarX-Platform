import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { publicUser } from "../lib/serialize";

const router: IRouter = Router();

router.get("/", requireAuth, (req, res) => {
  res.json(publicUser(req.user!));
});

export default router;
