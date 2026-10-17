import { Router, type IRouter } from "express";
import {
  db,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, count, gte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middlewares/auth";
import { recordAuditFromReq } from "../lib/audit";
import { notFound, badRequest } from "../lib/errors";

const router: IRouter = Router();

function serializeNotification(n: typeof notificationsTable.$inferSelect) {
  return {
    id: n.id,
    userId: n.userId,
    type: n.type,
    title: n.title,
    message: n.message,
    read: n.read,
    linkUrl: n.linkUrl,
    createdAt: n.createdAt.toISOString(),
  };
}

router.get("/my", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "30"), 10) || 30, 1), 100);
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, req.user!.id))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit);
    res.json(rows.map(serializeNotification));
  } catch (err) {
    next(err);
  }
});

router.get("/unread-count", requireAuth, async (req, res, next) => {
  try {
    const [row] = await db
      .select({ c: count() })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, req.user!.id),
          eq(notificationsTable.read, false),
        ),
      );
    res.json({ count: Number(row?.c ?? 0) });
  } catch (err) {
    next(err);
  }
});

router.post("/mark-read", requireAuth, async (req, res, next) => {
  try {
    const { ids } = z
      .object({ ids: z.array(z.string()).min(1).max(100) })
      .parse(req.body);

    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(
        and(
          eq(notificationsTable.userId, req.user!.id),
          sql`${notificationsTable.id} = ANY(${ids})`,
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/mark-all-read", requireAuth, async (req, res, next) => {
  try {
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(
        and(
          eq(notificationsTable.userId, req.user!.id),
          eq(notificationsTable.read, false),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const adminOnly = requireRole("admin", "super_admin");

const SendNotificationBody = z.object({
  target: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("user"),
      userId: z.string().min(1),
    }),
    z.object({
      kind: z.literal("segment"),
      segment: z.enum(["all_active", "new_last_7_days", "new_last_30_days"]),
    }),
  ]),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  linkUrl: z.string().max(500).optional(),
});

router.post("/send", adminOnly, async (req, res, next): Promise<void> => {
  try {
    const input = SendNotificationBody.parse(req.body);

    let userIds: string[] = [];
    if (input.target.kind === "user") {
      const exists = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, input.target.userId))
        .limit(1);
      if (!exists[0]) throw notFound("User not found");
      userIds = [input.target.userId];
    } else {
      const conds = [eq(usersTable.status, "active" as never)];
      if (input.target.segment === "new_last_7_days") {
        conds.push(gte(usersTable.createdAt, new Date(Date.now() - 7 * 86400_000)));
      } else if (input.target.segment === "new_last_30_days") {
        conds.push(gte(usersTable.createdAt, new Date(Date.now() - 30 * 86400_000)));
      }
      const rows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(...conds))
        .limit(10_000);
      userIds = rows.map((r) => r.id);
    }

    if (userIds.length === 0) {
      res.json({ sent: 0 });
      return;
    }

    const values = userIds.map((uid) => ({
      userId: uid,
      type: "custom" as const,
      title: input.title,
      message: input.message,
      linkUrl: input.linkUrl ?? null,
    }));

    const BATCH = 500;
    let sent = 0;
    for (let i = 0; i < values.length; i += BATCH) {
      const batch = values.slice(i, i + BATCH);
      await db.insert(notificationsTable).values(batch);
      sent += batch.length;
    }

    await recordAuditFromReq(req, {
      action: "notification.send",
      targetType: "notification",
      after: {
        title: input.title,
        target: input.target,
        sent,
      },
    });

    res.json({ sent });
  } catch (err) {
    next(err);
  }
});

export default router;
