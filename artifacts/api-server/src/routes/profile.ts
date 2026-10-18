import { Router, type IRouter, type Request } from "express";
import {
  db,
  usersTable,
  sessionsTable,
  passwordResetsTable,
} from "@workspace/db";
import { and, eq, gt, isNull, ne, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { publicUser, isDemoUser } from "../lib/serialize";
import { hashPassword, verifyPassword } from "../lib/password";
import { badRequest, forbidden, unauthorized } from "../lib/errors";
import { recordAuditFromReq } from "../lib/audit";
import { authRateLimiter } from "../middlewares/rateLimit";
import { sessionCookie } from "../middlewares/siteChannel";
import { disconnectAccountSessions } from "../realtime/gateway";

const router: IRouter = Router();

router.get("/", requireAuth, (req, res) => {
  res.json(publicUser(req.user!));
});

router.use(requireAuth, (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (isDemoUser(req.user!))
    return next(
      forbidden("Use a registered account to manage security settings."),
    );
  next();
});

const passwordBody = z.object({ currentPassword: z.string().min(1).max(200) });
const changeBody = passwordBody
  .extend({
    newPassword: z.string().min(8, "Use at least 8 characters.").max(72),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "New passwords do not match.",
    path: ["confirmPassword"],
  });

// Serialize security mutations with session creation and recheck the session
// inside the lock: an already revoked request cannot change credentials.
async function withPassword<T>(
  req: Request,
  password: string,
  change: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.id))
      .for("update");
    const [session] = await tx
      .select()
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, req.session!.id),
          isNull(sessionsTable.revokedAt),
          gt(sessionsTable.expiresAt, new Date()),
        ),
      );
    if (!user || !session)
      throw unauthorized("Session ended. Please sign in again.");
    if (!(await verifyPassword(password, user.passwordHash)))
      throw badRequest("Current password is incorrect.");
    return change(tx);
  });
}

router.get("/security", async (req, res, next) => {
  try {
    const sessions = await db
      .select({
        id: sessionsTable.id,
        createdAt: sessionsTable.createdAt,
        expiresAt: sessionsTable.expiresAt,
        ip: sessionsTable.ip,
        device: sessionsTable.userAgent,
      })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.userId, req.user!.id),
          isNull(sessionsTable.revokedAt),
          gt(sessionsTable.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessionsTable.createdAt));
    // Session IDs are bearer credentials and must never be included in JSON.
    res.json({
      sessions: sessions.map(({ id, ...session }) => ({
        ...session,
        current: id === req.session!.id,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/security/verify", authRateLimiter, async (req, res, next) => {
  try {
    const input = passwordBody.parse(req.body);
    await withPassword(req, input.currentPassword, async () => undefined);
    await recordAuditFromReq(req, {
      action: "security.password_verified",
      targetType: "user",
      targetId: req.user!.id,
    });
    res.json({ verified: true, verifiedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/security/revoke-others",
  authRateLimiter,
  async (req, res, next) => {
    try {
      const input = passwordBody.parse(req.body);
      await withPassword(req, input.currentPassword, async (tx) => {
        await tx
          .update(sessionsTable)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(sessionsTable.userId, req.user!.id),
              ne(sessionsTable.id, req.session!.id),
              isNull(sessionsTable.revokedAt),
            ),
          );
      });
      disconnectAccountSessions(req.user!.id, req.session!.id);
      await recordAuditFromReq(req, {
        action: "security.other_sessions_revoked",
        targetType: "user",
        targetId: req.user!.id,
      });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

router.post("/password", authRateLimiter, async (req, res, next) => {
  try {
    const input = changeBody.parse(req.body);
    if (Buffer.byteLength(input.newPassword, "utf8") > 72)
      throw badRequest("New password must be at most 72 UTF-8 bytes.");
    if (input.currentPassword === input.newPassword)
      throw badRequest("Choose a different new password.");
    const passwordHash = await hashPassword(input.newPassword);
    await withPassword(req, input.currentPassword, async (tx) => {
      const now = new Date();
      await tx
        .update(usersTable)
        .set({ passwordHash, updatedAt: now })
        .where(eq(usersTable.id, req.user!.id));
      await tx
        .update(sessionsTable)
        .set({ revokedAt: now })
        .where(
          and(
            eq(sessionsTable.userId, req.user!.id),
            isNull(sessionsTable.revokedAt),
          ),
        );
      await tx
        .update(passwordResetsTable)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResetsTable.userId, req.user!.id),
            isNull(passwordResetsTable.usedAt),
          ),
        );
    });
    disconnectAccountSessions(req.user!.id);
    await recordAuditFromReq(req, {
      action: "security.password_changed",
      targetType: "user",
      targetId: req.user!.id,
    });
    const secure = process.env.COOKIE_SECURE !== "false";
    res.clearCookie(sessionCookie(req), {
      httpOnly: true,
      secure,
      sameSite: secure ? "none" : "lax",
      path: "/",
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
