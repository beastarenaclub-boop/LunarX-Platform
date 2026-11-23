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
  findUserByLogin,
  createSession,
  revokeSession,
  getActiveSession,
  findUserById,
  generateUsername,
  isUniqueViolation,
} from "../services/auth";
import {
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
} from "../services/loginThrottle";
import { ensureWallet } from "../services/wallet";
import { bus } from "../realtime/eventBus";
import { hashPassword, verifyPassword, burnPasswordCheck } from "../lib/password";
import { assertPasswordAllowed } from "../lib/passwordPolicy";
import { isDemoUser } from "../lib/serialize";
import { unauthorized, badRequest, HttpError } from "../lib/errors";
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
    assertPasswordAllowed(input.password);
    const displayName = input.displayName?.replace(/[\u0000-\u001f\u007f]/g, "").trim() || null;

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
    // Players get a random "cry" + 4-digit username. The email column is
    // required, so it mirrors the username (no real email is collected).
    let user: typeof usersTable.$inferSelect | undefined;
    for (let attempt = 0; attempt < 5 && !user; attempt++) {
      const username = await generateUsername();
      try {
        [user] = await db
          .insert(usersTable)
          .values({
            email: username,
            emailNormalized: username,
            username,
            passwordHash,
            role: "player",
            status: "active",
            displayName,
            referredBy: validReferral,
          })
          .returning();
      } catch (err) {
        // Another signup took the same name at the same moment: pick again.
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!user) {
      throw new HttpError(503, "SIGNUP_BUSY", "Could not create the account. Please try again.");
    }
    const normalized = user.emailNormalized;

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
      message: `New signup: ${user.username}`,
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

    res.json({
      user: publicUser(user!),
      username: user.username,
      signupBonus: bonusInfo,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Shared credential check for player and operator logins. Counts failures per
 * login identifier (on top of the per-IP limiter) and spends equal bcrypt time
 * for unknown accounts so timing does not reveal which usernames exist.
 */
async function checkCredentials(input: {
  username?: string;
  email?: string;
  password: string;
}) {
  const identifier = (input.username ?? input.email ?? "").trim();
  if (!identifier) throw badRequest("Enter your username and password.");
  assertLoginAllowed(identifier);
  const user = await findUserByLogin(identifier);
  const ok = user
    ? await verifyPassword(input.password, user.passwordHash)
    : await burnPasswordCheck(input.password);
  if (!user || !ok) {
    recordLoginFailure(identifier);
    throw unauthorized("Invalid username or password");
  }
  recordLoginSuccess(identifier);
  return user;
}

router.post("/login", authRateLimiter, async (req, res, next) => {
  try {
    const input = LoginBody.parse(req.body);
    const user = await checkCredentials(input);
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
      message: `Login: ${user.username ?? user.email}`,
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
    const user = await checkCredentials(input);
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
      const identifier = (input.username ?? input.email ?? "").trim();
      if (!identifier) throw badRequest("Enter your username.");
      const user = await findUserByLogin(identifier);
      let token: string | undefined;
      if (user && user.status === "active") {
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
      // Avoid revealing whether the account exists. There is no email/SMS
      // delivery, so the token is only returned on explicit development/test
      // runs — an unset NODE_ENV (a misconfigured server) must never hand out
      // reset tokens, or anyone could take over any account by username.
      const body: { ok: true; token?: string } = { ok: true };
      const exposeToken = ["development", "test"].includes(process.env.NODE_ENV ?? "");
      if (exposeToken && token) body.token = token;
      res.json(body);
    } catch (err) {
      next(err);
    }
  },
);

router.post("/password-reset/confirm", authRateLimiter, async (req, res, next) => {
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
    const target = await findUserById(reset.userId);
    assertPasswordAllowed(input.password, { username: target?.username });

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
