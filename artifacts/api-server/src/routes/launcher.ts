import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  consumeLaunchToken,
  findLaunchToken,
  markWrapperVerified,
} from "../services/launcherSession";
import { ensurePartnerShadowUser, getPartner } from "../services/partners";
import { createSession } from "../services/auth";
import { SESSION_COOKIE } from "../middlewares/auth";
import { clientIp } from "../lib/audit";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/errors";
import { wrapperNonceCookieName } from "./launchHtml";

const router: IRouter = Router();

const ExchangeBody = z.object({
  token: z.string().min(8).max(128),
});

// Short auth-session TTL for launcher sessions: a player should not stay
// logged in to the iframe app for the full 30-day default. Refresh by
// re-launching from the partner.
const LAUNCHER_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4h

/**
 * Exchange a single-use launch token for an HTTP-only session cookie. The
 * token was minted by the partner via POST /v1/sessions; consuming it here
 * binds the resulting browser session to the partner+playerRef so any bets
 * placed while inside the iframe get tagged + routed to the partner's
 * remote wallet (or local credits).
 */
router.post("/exchange", async (req, res, next) => {
  try {
    const input = ExchangeBody.parse(req.body);
    const ps = await consumeLaunchToken(input.token);
    if (!ps) throw unauthorized("Invalid or expired launch token");

    const partner = await getPartner(ps.partnerId);
    if (!partner) throw unauthorized("Partner no longer exists");
    if (partner.status !== "active") {
      throw forbidden(`Partner is ${partner.status}`);
    }

    const shadow = await ensurePartnerShadowUser(ps.partnerId, ps.playerRef);
    const session = await createSession(
      shadow.id,
      clientIp(req),
      req.headers["user-agent"] ?? null,
      { partnerId: ps.partnerId, partnerPlayerRef: ps.playerRef },
      LAUNCHER_SESSION_TTL_MS,
    );
    res.cookie(SESSION_COOKIE, session.id, {
      httpOnly: true,
      // Same rationale as the wrapper-nonce cookie: SameSite=None mandates
      // Secure on modern browsers, so we set it unconditionally to avoid
      // silent drops behind TLS-terminating proxies in non-prod envs.
      secure: true,
      sameSite: "none",
      expires: session.expiresAt,
      path: "/",
    });
    res.json({
      ok: true,
      gameCode: ps.gameCode,
      playerRef: ps.playerRef,
      currency: ps.currency,
      partnerId: ps.partnerId,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (err) {
    if ((err as { name?: string }).name === "ZodError") {
      return next(badRequest("Invalid body"));
    }
    next(err);
  }
});

/**
 * Wrapper attestation: called by the JS embedded in GET /launch once the
 * page has actually rendered (which only happens when partner CSP
 * frame-ancestors permitted it). Verifies the HttpOnly nonce cookie set
 * by /launch matches the row's stored nonce, then flips wrapperVerifiedAt
 * so /exchange will accept the token.
 */
router.post("/wrapper-attest", async (req, res, next) => {
  try {
    const { token } = z
      .object({ token: z.string().min(8).max(128) })
      .parse(req.body ?? {});
    const ps = await findLaunchToken(token);
    if (!ps) throw notFound("Unknown launch token");
    if (ps.expiresAt.getTime() < Date.now()) {
      throw forbidden("Launch token expired");
    }
    if (ps.consumedAt) throw forbidden("Token already consumed");
    const expected = ps.wrapperNonce;
    const provided =
      (req.cookies as Record<string, string> | undefined)?.[
        wrapperNonceCookieName(token)
      ] ?? "";
    if (!expected || !provided) {
      throw forbidden("Missing wrapper attestation cookie");
    }
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw forbidden("Wrapper attestation mismatch");
    }
    await markWrapperVerified(token);
    res.json({ ok: true });
  } catch (err) {
    if ((err as { name?: string }).name === "ZodError") {
      return next(badRequest("Invalid body"));
    }
    next(err);
  }
});

export default router;
