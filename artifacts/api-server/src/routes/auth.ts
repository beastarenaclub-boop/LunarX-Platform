import { Router, type IRouter } from "express";
import {
  db,
  usersTable,
  passwordResetsTable,
  agentsTable,
  betsTable,
  sessionsTable,
  networkNodesTable,
} from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  SignupBody,
  LoginBody,
  RequestPasswordResetBody,
  ConfirmPasswordResetBody,
} from "@workspace/api-zod";
import {
  normalizeEmail,
  findUserByEmail,
  createSession,
  revokeSession,
  getActiveSession,
  findUserById,
} from "../services/auth";
import { ensureWallet } from "../services/wallet";
import { bus } from "../realtime/eventBus";
import { hashPassword, verifyPassword } from "../lib/password";
import { DEMO_EMAIL_DOMAIN, isDemoUser } from "../lib/serialize";
import { conflict, unauthorized, badRequest } from "../lib/errors";
import { recordAudit, clientIp } from "../lib/audit";
import { writeAppLog } from "../services/appLog";
import { applySignupBonusAndReferral } from "../services/promotions";
import { publicUser } from "../lib/serialize";
import { SESSION_COOKIE, requireAuth } from "../middlewares/auth";
import {
  authRateLimiter,
  passwordResetRateLimiter,
} from "../middlewares/rateLimit";
import { logger } from "../lib/logger";
import { requestSite, requestOperatorPanel, sessionCookie, customMaster } from "../middlewares/siteChannel";
import { assertNetworkActive, userBelongsToMaster } from "../services/network";
import { forbidden } from "../lib/errors";

const router: IRouter = Router();

const secureCookies = process.env.COOKIE_SECURE !== "false";

const COOKIE_OPTS = (expires: Date) => ({
  httpOnly: true,
  // The app is viewed inside Replit's HTTPS preview iframe, which is a
  // cross-site context: SameSite=Lax cookies are NOT sent there, forcing a
  // fresh login on every visit. SameSite=None fixes that, but browsers only
  // accept it together with Secure. The preview/production traffic is always
  // HTTPS at the browser, so Secure is safe even in development.
  secure: secureCookies,
  sameSite: secureCookies ? ("none" as const) : ("lax" as const),
  path: "/",
  expires,
});

router.post("/signup", authRateLimiter, async (req, res, next) => {
  try {
    if (requestSite(req) !== "b2c") throw forbidden("Player accounts can only be created by your account manager");
    const input = SignupBody.parse(req.body);
    const normalized = normalizeEmail(input.email);
    // Reserve the demo email namespace. Demo status is identified purely by the
    // email pattern (isDemoUser), and demo accounts receive starting credits and
    // are auto-purged by the cleanup job. Letting a normal signup pick a
    // *@demo.lunar.local address would let it self-classify as demo and claim
    // demo credits outside /demo-login (and its abuse caps). Reserving the
    // dedicated demo domain is sufficient — isDemoUser also requires it — so we
    // don't block legitimate addresses that merely start with "demo_".
    if (normalized.endsWith(DEMO_EMAIL_DOMAIN)) {
      throw badRequest("This email address is not allowed.");
    }
    const existing = await findUserByEmail(normalized);
    if (existing) throw conflict("Email already registered");

    // Public signups always belong directly to the company B2C channel.
    const validReferral: string | null = null;

    // Detect a current demo session so we can carry over the demo's
    // bet history onto the new real account.
    let demoSourceId: string | null = null;
    const sid = req.cookies?.[sessionCookie(req)];
    if (typeof sid === "string" && sid.length > 0) {
      const existingSession = await getActiveSession(sid);
      if (existingSession) {
        const existingUser = await findUserById(existingSession.userId);
        if (
          existingUser &&
          existingUser.status === "active" &&
          existingUser.migratedToUserId === null &&
          isDemoUser(existingUser)
        ) {
          demoSourceId = existingUser.id;
        }
      }
    }

    const passwordHash = await hashPassword(input.password);
    const [user] = await db
      .insert(usersTable)
      .values({
        email: input.email.trim(),
        emailNormalized: normalized,
        passwordHash,
        role: "player",
        status: "active",
        displayName: input.displayName ?? null,
        referredBy: validReferral,
      })
      .returning();

    await ensureWallet(user!.id);

    // If this signup attached to an agent's referral, push a live
    // `player_added` event to the agent so their dashboard's player count
    // updates without waiting for the long polling fallback.
    if (validReferral) {
      try {
        const refUser = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.referralCode, validReferral))
          .limit(1);
        const refUserId = refUser[0]?.id;
        if (refUserId) {
          bus.publish({
            topic: `agent:${refUserId}`,
            type: "player_added",
            playerId: user!.id,
            ts: Date.now(),
          });
        }
      } catch {
        // best-effort: never break signup on a publish failure
      }
    }

    if (demoSourceId) {
      await db.transaction(async (tx) => {
        await tx
          .update(betsTable)
          .set({ userId: user!.id })
          .where(eq(betsTable.userId, demoSourceId!));
        await tx
          .update(usersTable)
          .set({
            status: "suspended",
            migratedToUserId: user!.id,
            updatedAt: new Date(),
          })
          .where(eq(usersTable.id, demoSourceId!));
        await tx
          .update(sessionsTable)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(sessionsTable.userId, demoSourceId!),
              isNull(sessionsTable.revokedAt),
            ),
          );
      });
      await recordAudit({
        actorId: user!.id,
        actorRole: user!.role,
        action: "auth.demo_migrated",
        targetType: "user",
        targetId: demoSourceId,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
        after: { newUserId: user!.id },
      });
      void writeAppLog({
        kind: "auth",
        message: `Demo migrated to real signup: ${demoSourceId} -> ${user!.id}`,
        actorId: user!.id,
        ip: clientIp(req),
      });
    }

    const session = await createSession(
      user!.id,
      clientIp(req),
      req.headers["user-agent"] ?? null,
    );
    res.cookie(sessionCookie(req), session.id, COOKIE_OPTS(session.expiresAt));

    await recordAudit({
      actorId: user!.id,
      actorRole: user!.role,
      action: "auth.signup",
      targetType: "user",
      targetId: user!.id,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? null,
    });
    void writeAppLog({
      kind: "auth",
      message: `New signup: ${input.email.trim()}`,
      actorId: user!.id,
      ip: clientIp(req),
    });

    // Signup bonus + referral linkage. Best-effort — failures must not
    // break the signup response. The function is idempotent per userId.
    let bonusInfo: {
      granted: boolean;
      blockedReason: string | null;
      message: string | null;
    } = { granted: false, blockedReason: null, message: null };
    try {
      const result = await applySignupBonusAndReferral({
        userId: user!.id,
        email: user!.email,
        emailNormalized: normalized,
        ip: clientIp(req),
        referredBy: validReferral,
      });
      const messageFor = (reason: string | null, granted: boolean) => {
        if (granted) return "Signup bonus credited to your bonus wallet.";
        if (reason === "duplicate_ip")
          return "Signup bonus already claimed from this device/network.";
        if (reason === "duplicate_email")
          return "Signup bonus already claimed for this email.";
        if (reason === "duplicate_concurrent")
          return "Signup bonus already claimed for this account.";
        if (reason === "promotions_disabled" || reason === "amount_zero")
          return null;
        return null;
      };
      bonusInfo = {
        granted: result.granted,
        blockedReason: result.blockedReason,
        message: messageFor(result.blockedReason, result.granted),
      };
    } catch (err) {
      logger.warn({ err }, "applySignupBonusAndReferral failed");
    }

    res.json({ user: publicUser(user!), signupBonus: bonusInfo });
  } catch (err) {
    next(err);
  }
});

router.post("/login", authRateLimiter, async (req, res, next) => {
  try {
    const input = LoginBody.parse(req.body);
    const user = await findUserByEmail(input.email);
    if (!user) throw unauthorized("Invalid email or password");
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) throw unauthorized("Invalid email or password");
    if (user.status !== "active") {
      throw unauthorized(`Account is ${user.status}`);
    }
    if (user.role === "player" && user.channel !== requestSite(req)) {
      throw unauthorized("Use the website where your account was created");
    }
    if(customMaster(req) && !(await userBelongsToMaster(user,customMaster(req)!)))throw unauthorized('Use the website provided by your account manager');
    if (user.role === "agent") throw unauthorized("Use the master or agent panel to sign in");
    await assertNetworkActive(user);

    const session = await createSession(
      user.id,
      clientIp(req),
      req.headers["user-agent"] ?? null,
      undefined, undefined, user.passwordHash,
    );
    res.cookie(sessionCookie(req), session.id, COOKIE_OPTS(session.expiresAt));

    await recordAudit({
      actorId: user.id,
      actorRole: user.role,
      action: "auth.login",
      targetType: "user",
      targetId: user.id,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? null,
    });
    void writeAppLog({
      kind: "auth",
      message: `Login: ${user.email}`,
      actorId: user.id,
      ip: clientIp(req),
    });

    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/agent-login", authRateLimiter, async (req, res, next) => {
  try {
    if (requestSite(req) !== "operator") throw forbidden("Use the master / agent panel website");
    const input = LoginBody.parse(req.body);
    const user = await findUserByEmail(input.email);
    if (!user) throw unauthorized("Invalid email or password");
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) throw unauthorized("Invalid email or password");
    if (user.status !== "active") {
      throw unauthorized(`Account is ${user.status}`);
    }
    if (user.role !== "agent") {
      throw unauthorized("This account does not have agent access");
    }

    const agentRow = await db
      .select({ id: agentsTable.id, status: agentsTable.status })
      .from(agentsTable)
      .where(eq(agentsTable.userId, user.id))
      .limit(1);
    const [networkNode] = await db.select().from(networkNodesTable).where(eq(networkNodesTable.userId,user.id));
    if (!networkNode) {
      throw unauthorized("Ask your admin or master for a branch panel account");
    }
    const panel = requestOperatorPanel(req);
    if (panel && networkNode.kind !== panel) {
      throw forbidden(`This is a ${networkNode.kind} account. Sign in at /${networkNode.kind}/ instead.`);
    }
    await assertNetworkActive(user);

    const session = await createSession(
      user.id,
      clientIp(req),
      req.headers["user-agent"] ?? null,
      undefined, undefined, user.passwordHash,
    );
    res.cookie(sessionCookie(req), session.id, COOKIE_OPTS(session.expiresAt));

    await recordAudit({
      actorId: user.id,
      actorRole: user.role,
      action: "auth.agent_login",
      targetType: "user",
      targetId: user.id,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? null,
    });

    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const sid = req.cookies?.[sessionCookie(req)];
    if (typeof sid === "string" && sid.length > 0) {
      await revokeSession(sid);
    }
    res.clearCookie(sessionCookie(req), {
      path: "/",
      httpOnly: true,
      secure: secureCookies,
      sameSite: secureCookies ? "none" : "lax",
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json(publicUser(req.user!));
});

router.get("/site", (req,res) => res.json({channel:requestSite(req),signupEnabled:requestSite(req)==="b2c"}));

router.post(
  "/password-reset/request",
  passwordResetRateLimiter,
  async (req, res, next) => {
    try {
      const input = RequestPasswordResetBody.parse(req.body);
      const user = await findUserByEmail(input.email);
      let token: string | undefined;
      if (user) {
        const [row] = await db
          .insert(passwordResetsTable)
          .values({
            userId: user.id,
            expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          })
          .returning();
        token = row!.id;
        logger.info(
          { userId: user.id, resetId: row!.id.slice(0, 6), issuedAt: new Date().toISOString() },
          "Password reset token issued",
        );
      }
      // Avoid revealing whether the email exists; only expose token in non-prod
      // for testability.
      const body: { ok: true; token?: string } = { ok: true };
      if (process.env.NODE_ENV !== "production" && token) body.token = token;
      res.json(body);
    } catch (err) {
      next(err);
    }
  },
);

router.post("/password-reset/confirm", async (req, res, next) => {
  try {
    const input = ConfirmPasswordResetBody.parse(req.body);
    const rows = await db
      .select()
      .from(passwordResetsTable)
      .where(
        and(
          eq(passwordResetsTable.id, input.token),
          isNull(passwordResetsTable.usedAt),
          gt(passwordResetsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const reset = rows[0];
    if (!reset) throw badRequest("Invalid or expired token");

    const passwordHash = await hashPassword(input.password);
    await db.transaction(async (tx) => {
      // Serialize with administrator resets, then recheck the one-use token.
      await tx.select({id: usersTable.id}).from(usersTable).where(eq(usersTable.id, reset.userId)).for("update");
      const [currentReset] = await tx.select().from(passwordResetsTable).where(and(eq(passwordResetsTable.id, reset.id), isNull(passwordResetsTable.usedAt), gt(passwordResetsTable.expiresAt, new Date())));
      if (!currentReset) throw badRequest("Invalid or expired token");
      await tx
        .update(usersTable)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(usersTable.id, reset.userId));
      await tx
        .update(passwordResetsTable)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetsTable.userId, reset.userId), isNull(passwordResetsTable.usedAt)));
      await tx.update(sessionsTable).set({revokedAt: new Date()}).where(and(eq(sessionsTable.userId, reset.userId), isNull(sessionsTable.revokedAt)));
    });
    const { disconnectAccountSessions } = await import("../realtime/gateway");
    disconnectAccountSessions(reset.userId);

    await recordAudit({
      actorId: reset.userId,
      action: "auth.password_reset",
      targetType: "user",
      targetId: reset.userId,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? null,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
