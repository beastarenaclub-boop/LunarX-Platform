import { Router, type IRouter } from "express";
import { db, networkNodesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { networkIdentity } from "../services/network";
import { forbidden } from "../lib/errors";
import { MASTER_RTP_GAMES, updateMasterRtp } from "../services/masterRtp";

const router: IRouter = Router();
router.get("/", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    if (actor.role === "agent") throw forbidden("Master RTP access required");
    const masters = await db.select({ id: networkNodesTable.id, name: networkNodesTable.name,
      playerRtpBps: networkNodesTable.playerRtpBps, revision: networkNodesTable.rtpRevision })
      .from(networkNodesTable).where(actor.role === "admin" ? eq(networkNodesTable.kind, "master") : eq(networkNodesTable.id, actor.node.id));
    res.set("Cache-Control", "private, no-store").json({ masters, games: MASTER_RTP_GAMES });
  } catch (e) { next(e); }
});
router.put("/:masterId", async (req, res, next) => {
  try {
    const master = await updateMasterRtp(req.user!, String(req.params.masterId), req.body);
    res.set("Cache-Control", "no-store").json({ id: master.id, name: master.name,
      playerRtpBps: master.playerRtpBps, revision: master.rtpRevision });
  } catch (e) { next(e); }
});
export default router;
