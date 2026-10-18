import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import {
  db,
  usersTable,
  sessionsTable,
  passwordResetsTable,
  auditLogTable,
} from "@workspace/db";
import { and, eq, isNull, inArray, asc, sql, type SQL } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";
import { requireStepUp } from "../middlewares/stepUp";
import { hashPassword } from "../lib/password";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { clientIp } from "../lib/audit";
import { disconnectAccountSessions } from "../realtime/gateway";
import { publicUser } from "../lib/serialize";
import { createHash } from "node:crypto";
import { deviceDetails, normalizeIp } from "../services/accountDevice";
import { approximateLocation } from "../services/accountGeo";
import { createNotification } from "../services/notifications";

const router: IRouter = Router();
router.use(
  ["/access-history", "/users/:userId/password", "/users/:userId/support-view"],
  requireRole("admin", "super_admin"),
  (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  },
);
const confirmationLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: (req) => req.user!.id,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
const reasonInput = z.object({ reason: z.string().trim().min(5).max(300) });
const passwordInput = reasonInput.extend({
  newPassword: z
    .string()
    .min(12)
    .max(72)
    .refine(
      (s) => Buffer.byteLength(s, "utf8") <= 72,
      "Password must fit in 72 UTF-8 bytes",
    ),
});
const canManage = (
  actor: { id: string; role: string },
  target: { id: string; role: string },
) =>
  actor.role === "super_admin" ||
  actor.id === target.id ||
  !["admin", "super_admin"].includes(target.role);

router.post(
  "/users/:userId/password",
  confirmationLimiter,
  requireStepUp,
  async (req, res, next) => {
    try {
      const input = passwordInput.parse(req.body),
        targetId = String(req.params.userId),
        actor = req.user!;
      const passwordHash = await hashPassword(input.newPassword);
      const result = await db.transaction(async (tx) => {
        const locked = await tx
          .select()
          .from(usersTable)
          .where(inArray(usersTable.id, [...new Set([actor.id, targetId])]))
          .orderBy(asc(usersTable.id))
          .for("update");
        const currentActor = locked.find((u) => u.id === actor.id),
          target = locked.find((u) => u.id === targetId);
        if (!target) throw notFound("Account not found");
        const [session] = await tx
          .select()
          .from(sessionsTable)
          .where(eq(sessionsTable.id, req.session!.id));
        if (
          !currentActor ||
          currentActor.passwordHash !== actor.passwordHash ||
          currentActor.status !== "active" ||
          !["admin", "super_admin"].includes(currentActor.role) ||
          !session ||
          session.revokedAt ||
          session.expiresAt <= new Date()
        )
          throw forbidden("Sign in again before changing passwords");
        if (!canManage(currentActor, target))
          throw forbidden(
            "Only a super admin can reset another administrator's password",
          );
        await tx
          .update(usersTable)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(usersTable.id, targetId));
        const revoked = await tx
          .update(sessionsTable)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(sessionsTable.userId, targetId),
              isNull(sessionsTable.revokedAt),
            ),
          )
          .returning({ id: sessionsTable.id });
        await tx
          .update(passwordResetsTable)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(passwordResetsTable.userId, targetId),
              isNull(passwordResetsTable.usedAt),
            ),
          );
        await tx.insert(auditLogTable).values({
          actorId: actor.id,
          actorRole: currentActor.role,
          action: "account.password_reset",
          targetType: "user",
          targetId,
          ip: clientIp(req),
          userAgent: req.headers["user-agent"]?.slice(0, 1024),
          after: { reason: input.reason, revokedSessions: revoked.length },
        });
        return { revokedSessions: revoked.length, self: targetId === actor.id };
      });
      disconnectAccountSessions(targetId);
      void createNotification({
        userId: targetId,
        type: "custom",
        title: "Password changed by an administrator",
        message:
          "Your password was reset and existing sessions were signed out. Contact support if you did not expect this change.",
        linkUrl: "/profile",
      }).catch(() => {});
      res.json({ ok: true, ...result });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  "/users/:userId/support-view",
  confirmationLimiter,
  requireStepUp,
  async (req, res, next) => {
    try {
      const input = reasonInput.parse(req.body),
        targetId = String(req.params.userId);
      const result = await db.transaction(async (tx) => {
        const locked = await tx
          .select()
          .from(usersTable)
          .where(inArray(usersTable.id, [...new Set([req.user!.id, targetId])]))
          .orderBy(asc(usersTable.id))
          .for("update");
        const target = locked.find((u) => u.id === targetId),
          actor = locked.find((u) => u.id === req.user!.id);
        if (!target) throw notFound("Account not found");
        const [session] = await tx
          .select()
          .from(sessionsTable)
          .where(eq(sessionsTable.id, req.session!.id));
        if (
          !actor ||
          actor.status !== "active" ||
          actor.passwordHash !== req.user!.passwordHash ||
          !["admin", "super_admin"].includes(actor.role) ||
          !session ||
          session.revokedAt ||
          session.expiresAt <= new Date()
        )
          throw forbidden("Sign in again before previewing accounts");
        if (!canManage(actor, target))
          throw forbidden(
            "Only a super admin can preview another administrator",
          );
        const snapshot = await tx.execute(sql`SELECT
        (SELECT COALESCE(sum(l.amount),0)::text FROM wallet_ledger l JOIN wallets w ON w.id=l.wallet_id WHERE l.user_id=${targetId} AND w.currency='INR') AS balance,
        (SELECT jsonb_build_object('name',n.name,'kind',n.kind) FROM network_nodes n WHERE n.user_id=${targetId} OR n.id=${target.b2bAgentId} LIMIT 1) AS branch,
        COALESCE((SELECT jsonb_agg(e ORDER BY e.created_at DESC) FROM (SELECT l.type,l.amount::text,l.created_at FROM wallet_ledger l JOIN wallets w ON w.id=l.wallet_id WHERE l.user_id=${targetId} AND w.currency='INR' ORDER BY l.created_at DESC,l.id DESC LIMIT 10) e),'[]'::jsonb) AS entries`);
        await tx.insert(auditLogTable).values({
          actorId: req.user!.id,
          actorRole: req.user!.role,
          action: "account.support_view",
          targetType: "user",
          targetId,
          ip: clientIp(req),
          userAgent: req.headers["user-agent"]?.slice(0, 1024),
          after: { reason: input.reason, mode: "read_only" },
        });
        return {
          user: publicUser(target),
          ...snapshot.rows[0],
          mode: "read_only",
          viewedAt: new Date().toISOString(),
        };
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  },
);

const query = z.object({
  q: z.string().trim().max(100).default(""),
  userId: z.string().max(100).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  status: z
    .enum(["all", "active", "revoked", "expired", "recent"])
    .default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
router.get("/access-history", async (req, res, next) => {
  try {
    const f = query.parse(req.query);
    if (f.from && f.to && f.from > f.to)
      throw badRequest("Start date must precede end date");
    const clauses: SQL[] = [
      sql`COALESCE(s.last_seen_at,s.created_at)>now()-interval '90 days'`,
    ];
    if (f.userId) clauses.push(sql`s.user_id=${f.userId}`);
    if (f.from)
      clauses.push(
        sql`COALESCE(s.last_seen_at,s.created_at)>=(${f.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      );
    if (f.to)
      clauses.push(
        sql`COALESCE(s.last_seen_at,s.created_at)<((${f.to}::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      );
    if (f.q) {
      const pattern = "%" + f.q.replace(/[\\%_]/g, "\\$&") + "%";
      clauses.push(
        sql`(u.email ILIKE ${pattern} OR COALESCE(s.last_ip,s.ip,'') ILIKE ${pattern} OR COALESCE(s.user_agent,'') ILIKE ${pattern} OR COALESCE(s.client_hints::text,'') ILIKE ${pattern})`,
      );
    }
    if (f.status === "revoked") clauses.push(sql`s.revoked_at IS NOT NULL`);
    if (f.status === "expired")
      clauses.push(sql`s.revoked_at IS NULL AND s.expires_at<=now()`);
    if (["active", "recent"].includes(f.status))
      clauses.push(sql`s.revoked_at IS NULL AND s.expires_at>now()`);
    if (f.status === "recent")
      clauses.push(sql`s.last_seen_at>now()-interval '5 minutes'`);
    const result = await db.execute(sql`WITH filtered AS MATERIALIZED (
      SELECT s.id,s.user_id,u.email,u.role,u.channel,s.ip,s.last_ip,s.user_agent,s.client_hints,s.created_at,s.last_seen_at,s.revoked_at,s.expires_at,
      CASE WHEN s.revoked_at IS NOT NULL THEN 'revoked' WHEN s.expires_at<=now() THEN 'expired' ELSE 'active' END AS status
      FROM sessions s JOIN users u ON u.id=s.user_id WHERE ${sql.join(clauses, sql` AND `)}
    ) SELECT (SELECT count(*)::int FROM filtered) AS total,COALESCE((SELECT jsonb_agg(r) FROM (SELECT * FROM filtered ORDER BY COALESCE(last_seen_at,created_at) DESC,id DESC LIMIT ${f.limit} OFFSET ${f.offset}) r),'[]'::jsonb) AS items`);
    const rows = result.rows[0]!.items as Array<Record<string, any>>;
    const items = await Promise.all(
      rows.map(async (r) => ({
        id: createHash("sha256").update(r.id).digest("hex"),
        userId: r.user_id,
        email: r.email,
        role: r.role,
        channel: r.channel,
        loginAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        status: r.status,
        loginIp: normalizeIp(r.ip),
        ip: normalizeIp(r.last_ip ?? r.ip),
        ipSource: r.last_seen_at ? "trusted_proxy" : "legacy_login",
        device: deviceDetails(r.user_agent, r.client_hints ?? {}),
        location: await approximateLocation(r.last_ip ?? r.ip),
      })),
    );
    res.json({
      total: result.rows[0]!.total,
      items,
      windowDays: 90,
      timezone: "Asia/Kolkata",
    });
  } catch (e) {
    next(e);
  }
});
export default router;
