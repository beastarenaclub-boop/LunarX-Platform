import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, networkNodesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { networkIdentity } from "../services/network";
import { networkReportRange } from "../services/networkReportRange";
import { badRequest, forbidden, notFound } from "../lib/errors";

const router: IRouter = Router();
router.get("/", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    const input = z.object({
      agentId: z.string().min(1).max(100).optional(),
      week: z.string().date().optional(),
      method: z.enum(["all", "manual", "auto"]).default("all"),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const agentId = actor.role === "agent" ? actor.node.id : input.agentId;
    if (actor.role === "agent" && input.agentId && input.agentId !== agentId) throw forbidden();
    if (!agentId) throw badRequest("Choose an agent for the collection report");
    const [agent] = await db.select().from(networkNodesTable).where(and(eq(networkNodesTable.id, agentId), eq(networkNodesTable.kind, "agent")));
    if (!agent) throw notFound();
    if (actor.role === "master" && agent.parentId !== actor.node.id) throw forbidden();
    const from = input.week ?? networkReportRange({ period: "weekly", channel: "b2b" }).from;
    if (new Date(`${from}T00:00:00Z`).getUTCDay() !== 1) throw badRequest("Choose a Monday as the week start");
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
    const method = input.method === "all" ? sql`true` : sql`p.method=${input.method}`;
    const scope = actor.role === "master" ? sql`(p.collection_master_id IS NULL OR p.collection_master_id=${actor.node.id})` : sql`true`;
    // Approval time determines the collection week. New requests retain their
    // funding agent even if the customer's membership is subsequently changed.
    const result = await db.execute(sql`WITH matched AS MATERIALIZED (
      SELECT p.*, u.email FROM payment_requests p JOIN users u ON u.id=p.user_id
      WHERE p.kind='deposit' AND p.status='approved' AND p.currency='INR'
        AND COALESCE(p.funding_agent_id,u.b2b_agent_id)=${agentId}
        AND p.processed_at >= ${from + "T00:00:00+05:30"}::timestamptz
        AND p.processed_at < ${to + "T00:00:00+05:30"}::timestamptz
        AND ${method} AND ${scope}
    ) SELECT (SELECT count(*)::int FROM matched) AS total,
      (SELECT jsonb_build_object('total',COALESCE(sum(amount),0)::text,
        'manual',COALESCE(sum(amount) FILTER (WHERE method='manual'),0)::text,
        'auto',COALESCE(sum(amount) FILTER (WHERE method='auto'),0)::text) FROM matched) AS totals,
      COALESCE((SELECT jsonb_agg(row ORDER BY processed_at DESC,id DESC) FROM (
        SELECT processed_at,id,jsonb_build_object('id',id,'customer',email,'amount',amount::text,
          'method',method,'reference',COALESCE(upi_ref,gateway_order_id),'upiId',upi_id,
          'approvedAt',processed_at,'legacyAttribution',funding_agent_id IS NULL) AS row
        FROM matched ORDER BY processed_at DESC,id DESC LIMIT ${input.limit} OFFSET ${input.offset}
      ) page),'[]'::jsonb) AS items`);
    res.set("Cache-Control", "no-store").json({ ...result.rows[0], agent: { id: agent.id, name: agent.name }, range: { from, to, timezone: "Asia/Kolkata", endExclusive: true } });
  } catch (e) { next(e); }
});
export default router;
