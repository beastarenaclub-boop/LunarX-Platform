import { Router, type IRouter } from "express";
import { db, demoNudgeEventsTable } from "@workspace/db";
import { gte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

type TriggerKey = "rounds" | "bigwin" | "lowbalance";
const TRIGGERS: TriggerKey[] = ["rounds", "bigwin", "lowbalance"];

const RecordEventBody = z.object({
  kind: z.enum(["impression", "click", "conversion"]),
  trigger: z.enum(["rounds", "bigwin", "lowbalance"]),
  language: z.string().min(2).max(8).optional(),
  sessionRef: z.string().min(1).max(64).optional(),
});

router.post("/event", requireAuth, async (req, res, next) => {
  try {
    const input = RecordEventBody.parse(req.body);
    // Default sessionRef to the current user id so impressions/clicks
    // emitted under a demo session can later be matched to a conversion
    // event posted under the new real account.
    const sessionRef = input.sessionRef ?? req.user!.id;

    await db.insert(demoNudgeEventsTable).values({
      userId: req.user!.id,
      kind: input.kind,
      trigger: input.trigger,
      language: input.language ?? null,
      sessionRef,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const adminOnly = requireRole("admin", "super_admin");

type AttributedConversion = {
  trigger: TriggerKey | null;
  c: number;
  [key: string]: unknown;
};

router.get("/admin/stats", adminOnly, async (req, res, next) => {
  try {
    const days = Math.min(
      Math.max(parseInt(String(req.query.days ?? "30"), 10) || 30, 1),
      365,
    );
    const since = new Date(Date.now() - days * 86_400_000);

    // Raw impressions and clicks per trigger.
    const eventRows = await db
      .select({
        trigger: demoNudgeEventsTable.trigger,
        kind: demoNudgeEventsTable.kind,
        c: sql<number>`COUNT(*)::int`,
      })
      .from(demoNudgeEventsTable)
      .where(gte(demoNudgeEventsTable.createdAt, since))
      .groupBy(demoNudgeEventsTable.trigger, demoNudgeEventsTable.kind);

    // Conversions are credited to the most recent click sharing the same
    // sessionRef before the conversion event. Done in SQL so admins get
    // one tidy row per trigger.
    const result = await db.execute<AttributedConversion>(sql`
      WITH conversions AS (
        SELECT id, session_ref, created_at
        FROM demo_nudge_events
        WHERE kind = 'conversion'
          AND created_at >= ${since}
          AND session_ref IS NOT NULL
      ),
      attributed AS (
        SELECT (
          SELECT trigger
          FROM demo_nudge_events click
          WHERE click.session_ref = conv.session_ref
            AND click.kind = 'click'
            AND click.created_at <= conv.created_at
          ORDER BY click.created_at DESC
          LIMIT 1
        ) AS trigger
        FROM conversions conv
      )
      SELECT trigger, COUNT(*)::int AS c
      FROM attributed
      WHERE trigger IS NOT NULL
      GROUP BY trigger
    `);

    // node-postgres returns `{ rows: [...] }`; some drivers return the
    // array directly. Normalize both shapes.
    const conversionRows: AttributedConversion[] = Array.isArray(result)
      ? (result as AttributedConversion[])
      : ((result as { rows?: AttributedConversion[] }).rows ?? []);

    const stats: Record<
      TriggerKey,
      { impressions: number; clicks: number; conversions: number }
    > = {
      rounds: { impressions: 0, clicks: 0, conversions: 0 },
      bigwin: { impressions: 0, clicks: 0, conversions: 0 },
      lowbalance: { impressions: 0, clicks: 0, conversions: 0 },
    };

    for (const row of eventRows) {
      const t = row.trigger as TriggerKey;
      if (!stats[t]) continue;
      if (row.kind === "impression") stats[t].impressions = Number(row.c);
      else if (row.kind === "click") stats[t].clicks = Number(row.c);
    }
    for (const row of conversionRows) {
      const t = row.trigger as TriggerKey | null;
      if (t && stats[t]) stats[t].conversions = Number(row.c);
    }

    res.json({
      sinceDays: days,
      triggers: TRIGGERS.map((t) => ({
        trigger: t,
        impressions: stats[t].impressions,
        clicks: stats[t].clicks,
        conversions: stats[t].conversions,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
