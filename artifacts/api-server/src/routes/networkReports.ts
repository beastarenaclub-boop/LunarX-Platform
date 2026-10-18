import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { badRequest, forbidden } from "../lib/errors";
import { networkIdentity } from "../services/network";
import {
  networkReportRange,
  reportFilter,
} from "../services/networkReportRange";

const router = Router();
router.get("/", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    const filter = reportFilter.parse(req.query);
    const range = networkReportRange(filter);
    if (actor.role !== "admin" && filter.channel !== "b2b") throw forbidden();
    if (filter.channel === "b2c" && (filter.masterId || filter.agentId))
      throw badRequest(
        "Master and agent filters apply only to branch accounts",
      );
    const scope =
      actor.role === "admin"
        ? sql`true`
        : actor.role === "master"
          ? sql`(id=${actor.node.id} OR parent_id=${actor.node.id})`
          : sql`id=${actor.node.id}`;
    const choices = await db.execute(
      sql`SELECT id,name,kind,parent_id AS "parentId" FROM network_nodes WHERE ${scope} ORDER BY lower(name),id`,
    );
    const master = filter.masterId
      ? choices.rows.find(
          (n) => n.id === filter.masterId && n.kind === "master",
        )
      : null;
    const agent = filter.agentId
      ? choices.rows.find((n) => n.id === filter.agentId && n.kind === "agent")
      : null;
    if ((filter.masterId && !master) || (filter.agentId && !agent))
      throw forbidden("This account is outside your reporting access");
    if (master && agent && agent.parentId !== master.id)
      throw badRequest("Choose an agent under the selected master");
    const parts = [
      sql`l.channel=${filter.channel}`,
      sql`l.created_at >= (${range.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      sql`l.created_at < ((${range.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
    ];
    if (actor.role === "master")
      parts.push(
        sql`l.master_id=${actor.node.id} AND (l.account_id=${actor.node.id} OR l.account_kind='agent')`,
      );
    if (actor.role === "agent") parts.push(sql`l.account_id=${actor.node.id}`);
    if (master) parts.push(sql`l.master_id=${master.id}`);
    if (agent) parts.push(sql`l.agent_id=${agent.id}`);
    const canonical = actor.role === "admin" ? "company" : actor.role;
    // Every settlement has one allocation row per account. Count stake/returns
    // from exactly one account kind, including signed correction deltas.
    const metrics = sql`jsonb_build_object(
      'stake',COALESCE(sum(gross_stake) FILTER(WHERE account_kind=${canonical}),0)::text,
      'payout',COALESCE(sum(gross_payout) FILTER(WHERE account_kind=${canonical}),0)::text,
      'net',COALESCE(sum(gross_stake-gross_payout) FILTER(WHERE account_kind=${canonical}),0)::text,
      'wagers',count(DISTINCT (source,source_id)) FILTER(WHERE account_kind=${canonical})::int,
      'players',count(DISTINCT user_id) FILTER(WHERE account_kind=${canonical})::int,
      'company',${actor.role === "admin" ? sql`COALESCE(sum(amount) FILTER(WHERE account_kind='company'),0)::text` : sql`NULL::text`},
      'master',${actor.role !== "agent" && filter.channel === "b2b" ? sql`COALESCE(sum(amount) FILTER(WHERE account_kind='master'),0)::text` : sql`NULL::text`},
      'agent',${filter.channel === "b2b" ? sql`COALESCE(sum(amount) FILTER(WHERE account_kind='agent'),0)::text` : sql`NULL::text`})`;
    // A single statement gives every card and breakdown the same DB snapshot.
    const report = await db.execute(sql`WITH scoped AS MATERIALIZED (
      SELECT l.*,m.name AS master_name,a.name AS agent_name,
        to_char(l.created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS day
      FROM network_ledger l LEFT JOIN network_nodes m ON m.id=l.master_id LEFT JOIN network_nodes a ON a.id=l.agent_id
      WHERE ${sql.join(parts, sql` AND `)}
    ) SELECT
      (SELECT ${metrics} FROM scoped) AS totals,
      COALESCE((SELECT jsonb_agg(row ORDER BY row->>'day') FROM (
        SELECT ${metrics} || jsonb_build_object('day',day) AS row FROM scoped GROUP BY day
      ) days),'[]'::jsonb) AS days,
      COALESCE((SELECT jsonb_agg(row ORDER BY row->>'name',row->>'id') FROM (
        SELECT ${metrics} || jsonb_build_object('id',agent_id,'name',agent_name,'masterId',master_id,'masterName',${actor.role === "admin" ? sql`master_name` : sql`NULL::text`}) AS row
        FROM scoped WHERE agent_id IS NOT NULL GROUP BY agent_id,agent_name,master_id,master_name
      ) agents),'[]'::jsonb) AS agents,
      ${
        actor.role === "admin"
          ? sql`COALESCE((SELECT jsonb_agg(row ORDER BY row->>'name',row->>'id') FROM (
        SELECT ${metrics} || jsonb_build_object('id',master_id,'name',master_name) AS row
        FROM scoped WHERE master_id IS NOT NULL GROUP BY master_id,master_name
      ) masters),'[]'::jsonb)`
          : sql`'[]'::jsonb`
      } AS masters`);
    const data = report.rows[0]!;
    // Include zero-activity branches so a new agent can still be selected/reviewed.
    const zero = {
      stake: "0",
      payout: "0",
      net: "0",
      wagers: 0,
      players: 0,
      company: actor.role === "admin" ? "0" : null,
      master: actor.role !== "agent" ? "0" : null,
      agent: "0",
    };
    const rows = (key: "masters" | "agents", kind: string) => {
      const actual = data[key] as Record<string, unknown>[];
      return filter.channel === "b2c"
        ? []
        : choices.rows
            .filter(
              (n) =>
                n.kind === kind &&
                (!master || n.id === master.id || n.parentId === master.id) &&
                (!agent || n.id === agent.id || n.id === agent.parentId),
            )
            .map(
              (n) =>
                actual.find((row) => row.id === n.id) ?? {
                  ...zero,
                  id: n.id,
                  name: n.name,
                  ...(kind === "agent"
                    ? {
                        masterId: n.parentId,
                        masterName:
                          actor.role === "admin"
                            ? (choices.rows.find((p) => p.id === n.parentId)
                                ?.name ?? null)
                            : null,
                      }
                    : {}),
                },
            );
    };
    res.set("Cache-Control", "no-store").json({
      role: actor.role,
      range,
      channel: filter.channel,
      selection: {
        masterId: filter.masterId ?? null,
        agentId: filter.agentId ?? null,
      },
      options: {
        masters:
          actor.role === "admin"
            ? choices.rows.filter((n) => n.kind === "master")
            : [],
        agents: choices.rows.filter((n) => n.kind === "agent"),
      },
      totals: data.totals,
      days: data.days,
      masters: actor.role === "admin" ? rows("masters", "master") : [],
      agents: rows("agents", "agent"),
    });
  } catch (error) {
    next(error);
  }
});
export default router;
