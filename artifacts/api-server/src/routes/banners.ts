import { Router, type IRouter } from "express";
import {
  db,
  bannersTable,
  bannerDismissalsTable,
} from "@workspace/db";
import { and, desc, eq, lte, gte, or, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middlewares/auth";
import { recordAuditFromReq } from "../lib/audit";
import { notFound } from "../lib/errors";
import { bus } from "../realtime/eventBus";

const router: IRouter = Router();

const BANNER_TYPES = ["info", "warning", "promo"] as const;

function serializeBanner(b: typeof bannersTable.$inferSelect) {
  return {
    id: b.id,
    type: b.type,
    title: b.title,
    message: b.message,
    linkUrl: b.linkUrl,
    sticky: b.sticky,
    active: b.active,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt ? b.endsAt.toISOString() : null,
    createdBy: b.createdBy,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

router.get("/active", async (req, res, next) => {
  try {
    const now = new Date();
    const conds = [
      eq(bannersTable.active, true),
      lte(bannersTable.startsAt, now),
      or(isNull(bannersTable.endsAt), gte(bannersTable.endsAt, now)),
    ];

    let banners = await db
      .select()
      .from(bannersTable)
      .where(and(...conds))
      .orderBy(desc(bannersTable.createdAt));

    if (req.user) {
      const dismissed = await db
        .select({ bannerId: bannerDismissalsTable.bannerId })
        .from(bannerDismissalsTable)
        .where(eq(bannerDismissalsTable.userId, req.user.id));
      const dismissedIds = new Set(dismissed.map((d) => d.bannerId));
      banners = banners.filter((b) => b.sticky || !dismissedIds.has(b.id));
    }

    res.json(banners.map(serializeBanner));
  } catch (err) {
    next(err);
  }
});

router.post("/dismiss/:id", requireAuth, async (req, res, next) => {
  try {
    const bannerId = String(req.params.id);
    const rows = await db
      .select()
      .from(bannersTable)
      .where(eq(bannersTable.id, bannerId))
      .limit(1);
    if (!rows[0]) throw notFound("Banner not found");

    const existing = await db
      .select()
      .from(bannerDismissalsTable)
      .where(
        and(
          eq(bannerDismissalsTable.bannerId, bannerId),
          eq(bannerDismissalsTable.userId, req.user!.id),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      await db.insert(bannerDismissalsTable).values({
        bannerId,
        userId: req.user!.id,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const adminOnly = requireRole("admin", "super_admin");

const CreateBannerBody = z.object({
  type: z.enum(BANNER_TYPES),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  linkUrl: z.string().max(500).optional(),
  sticky: z.boolean().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

const UpdateBannerBody = z.object({
  type: z.enum(BANNER_TYPES).optional(),
  title: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(2000).optional(),
  linkUrl: z.string().max(500).nullable().optional(),
  sticky: z.boolean().optional(),
  active: z.boolean().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().nullable().optional(),
});

router.get("/admin/list", adminOnly, async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(bannersTable)
      .orderBy(desc(bannersTable.createdAt));
    res.json(rows.map(serializeBanner));
  } catch (err) {
    next(err);
  }
});

router.post("/admin/create", adminOnly, async (req, res, next) => {
  try {
    const input = CreateBannerBody.parse(req.body);
    const [banner] = await db
      .insert(bannersTable)
      .values({
        type: input.type,
        title: input.title,
        message: input.message,
        linkUrl: input.linkUrl ?? null,
        sticky: input.sticky ?? false,
        startsAt: input.startsAt ? new Date(input.startsAt) : new Date(),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        createdBy: req.user!.id,
      })
      .returning();

    await recordAuditFromReq(req, {
      action: "banner.publish",
      targetType: "banner",
      targetId: banner!.id,
      after: { title: input.title, type: input.type },
    });

    bus.publish({ topic: "banners:active", type: "changed", ts: Date.now() });
    res.status(201).json(serializeBanner(banner!));
  } catch (err) {
    next(err);
  }
});

router.put("/admin/:id", adminOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = UpdateBannerBody.parse(req.body);

    const rows = await db
      .select()
      .from(bannersTable)
      .where(eq(bannersTable.id, id))
      .limit(1);
    const existing = rows[0];
    if (!existing) throw notFound("Banner not found");

    const setFields: Record<string, unknown> = { updatedAt: new Date() };
    if (input.type !== undefined) setFields.type = input.type;
    if (input.title !== undefined) setFields.title = input.title;
    if (input.message !== undefined) setFields.message = input.message;
    if (input.linkUrl !== undefined) setFields.linkUrl = input.linkUrl;
    if (input.sticky !== undefined) setFields.sticky = input.sticky;
    if (input.active !== undefined) setFields.active = input.active;
    if (input.startsAt !== undefined) setFields.startsAt = new Date(input.startsAt);
    if (input.endsAt !== undefined)
      setFields.endsAt = input.endsAt ? new Date(input.endsAt) : null;

    const [updated] = await db
      .update(bannersTable)
      .set(setFields)
      .where(eq(bannersTable.id, id))
      .returning();

    await recordAuditFromReq(req, {
      action: "banner.update",
      targetType: "banner",
      targetId: id,
      before: { title: existing.title, active: existing.active },
      after: setFields,
    });

    bus.publish({ topic: "banners:active", type: "changed", ts: Date.now() });
    res.json(serializeBanner(updated!));
  } catch (err) {
    next(err);
  }
});

router.delete("/admin/:id", adminOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const rows = await db
      .select()
      .from(bannersTable)
      .where(eq(bannersTable.id, id))
      .limit(1);
    if (!rows[0]) throw notFound("Banner not found");

    await db.delete(bannersTable).where(eq(bannersTable.id, id));

    await recordAuditFromReq(req, {
      action: "banner.delete",
      targetType: "banner",
      targetId: id,
      before: { title: rows[0].title },
    });

    bus.publish({ topic: "banners:active", type: "changed", ts: Date.now() });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
