import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import {
  findLaunchToken,
  setWrapperNonce,
} from "../services/launcherSession";
import { getPartner } from "../services/partners";
import { badRequest, forbidden, notFound } from "../lib/errors";

export function wrapperNonceCookieName(token: string): string {
  // Per-token cookie name keeps multiple concurrent launches isolated.
  return `lunar_wn_${token.slice(0, 16)}`;
}

const router: IRouter = Router();

/**
 * Resolve the URL of the player-facing 3d-game artifact. In Replit dev
 * the artifacts share an origin via the proxy at REPLIT_DEV_DOMAIN; in
 * prod the operator can override via GAME_BASE_URL.
 */
function gameBaseUrl(req: import("express").Request): string {
  if (process.env.GAME_BASE_URL) return process.env.GAME_BASE_URL;
  // Same-origin assumption: 3d-game is served at /3d-game in dev.
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers.host;
  return `${proto}://${host}/3d-game`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    return (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
    );
  });
}

/**
 * Public iframe entry point partners embed:
 *
 *   <iframe src="https://api.lunar.example/launch?token=...&gameCode=lunar"></iframe>
 *
 * Validates the token, applies a per-partner CSP frame-ancestors header
 * (browsers refuse to display the page when embedded in a non-allowlisted
 * origin), and renders a thin HTML wrapper that loads the actual game
 * artifact and forwards the token via window.name (so it doesn't leak to
 * the URL bar / referrer).
 */
router.get("/launch", async (req, res, next) => {
  try {
    const token =
      typeof req.query.token === "string" ? req.query.token : null;
    const gameCode =
      typeof req.query.gameCode === "string" ? req.query.gameCode : null;
    if (!token || !gameCode) {
      throw badRequest("token and gameCode query params required");
    }
    // Reject top-level navigations: the launcher is iframe-only by
    // design, and `Sec-Fetch-Dest` is the only signal the server has
    // about the load context. `iframe` (Chromium/Firefox) covers the
    // expected case; we also accept `frame` and `document` only when
    // `Sec-Fetch-Site` indicates a cross-site embed (defense in depth
    // against older browsers that don't send `Dest`). Anything else —
    // direct address-bar visits, top-level redirects, fetch() probes —
    // is refused so a stolen token can't be wrapper-verified outside
    // an iframe context. Combined with the per-partner CSP frame-
    // ancestors directive set below, this keeps the launcher pinned
    // to the partner's allowlisted origins.
    const dest = String(req.headers["sec-fetch-dest"] ?? "").toLowerCase();
    const site = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
    const isIframeLoad =
      dest === "iframe" ||
      dest === "frame" ||
      (dest === "" && site === "cross-site");
    if (!isIframeLoad) {
      throw forbidden("Launcher must be embedded in an iframe");
    }
    // Look up but do NOT consume — exchange happens once the inner game
    // calls /api/launcher/exchange so a refresh in the iframe still works.
    const ps = await findLaunchToken(token);
    if (!ps) throw notFound("Unknown launch token");
    if (ps.expiresAt.getTime() < Date.now()) {
      throw forbidden("Launch token expired");
    }
    if (ps.gameCode !== gameCode) {
      throw badRequest("gameCode does not match token");
    }
    const partner = await getPartner(ps.partnerId);
    if (!partner) throw notFound("Partner not found");
    if (partner.status !== "active") {
      throw forbidden(`Partner is ${partner.status}`);
    }

    // CSP frame-ancestors enforces that only the partner's allowlisted
    // origins can iframe us. Empty list = block all (defense-in-depth).
    const ancestors =
      partner.allowedOrigins.length > 0
        ? partner.allowedOrigins.join(" ")
        : "'none'";
    res.setHeader(
      "Content-Security-Policy",
      `frame-ancestors ${ancestors}; default-src 'self' 'unsafe-inline' data: blob:; connect-src *; img-src * data: blob:; script-src 'self' 'unsafe-inline'`,
    );
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Legacy framing fallback for ancient browsers that don't honour CSP
    // frame-ancestors. XFO doesn't support multi-origin allowlists, so we
    // can only express the binary case: deny everything when no allowlist
    // was configured. Modern browsers ignore XFO when CSP is also set.
    if (partner.allowedOrigins.length === 0) {
      res.setHeader("X-Frame-Options", "DENY");
    }

    // Mint a wrapper nonce, persist it on the token row, and round-trip
    // it via an HttpOnly cookie. POST /api/launcher/wrapper-attest only
    // accepts the attestation if the cookie matches the stored nonce —
    // this binds attestation to the same browser context that actually
    // rendered /launch. Combined with: (a) the iframe-only Sec-Fetch-
    // Dest gate above, (b) per-partner CSP frame-ancestors blocking
    // render in disallowed parents, and (c) JS-driven attestation that
    // only fires after the page renders, an attacker holding a stolen
    // token cannot complete the exchange from outside an allowlisted
    // origin.
    const nonce = randomBytes(32).toString("base64url");
    await setWrapperNonce(token, nonce);
    res.cookie(wrapperNonceCookieName(token), nonce, {
      httpOnly: true,
      // SameSite=None requires Secure in modern browsers; force it on
      // unconditionally so proxied dev/staging deployments don't silently
      // drop the cookie when NODE_ENV !== production. Pure-HTTP local
      // launches must use the Sec-Fetch-Dest gate above as their only
      // protection — they're not a supported partner deployment shape.
      secure: true,
      sameSite: "none",
      path: "/api/launcher",
      maxAge: 5 * 60 * 1000,
    });

    const inner = gameBaseUrl(req);
    const safeGame = encodeURIComponent(gameCode);
    // Token is delivered to the inner frame via window.name (set on the
    // iframe element before navigation). Keeping it out of the URL means
    // it never lands in browser history, the address bar, or HTTP
    // Referer / server access logs.
    const innerUrl = `${inner}/launcher?game=${safeGame}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Cache control: tokens are single-use, so don't let any proxy cache
    // the wrapper page (the inner game artifact handles its own caching).
    res.setHeader("Cache-Control", "no-store");
    const tokenJson = JSON.stringify(token);
    const innerUrlJson = JSON.stringify(innerUrl);
    const titleJson = JSON.stringify(gameCode);
    res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(partner.displayName)} — ${escapeHtml(gameCode)}</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
  iframe { width: 100%; height: 100%; border: 0; display: block; }
  .err { color: #f99; font-family: system-ui; padding: 24px; text-align: center; }
</style>
</head>
<body>
  <script>
    // Wrapper attestation: prove that this page actually rendered and
    // executed JS — which only happens when the partner's CSP frame-
    // ancestors check passed. The server-side wrapperVerifiedAt flag
    // only flips after this POST succeeds, so a curl GET of /launch
    // can never unlock the token for /api/launcher/exchange.
    (async function () {
      try {
        const r = await fetch("/api/launcher/wrapper-attest", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: ${tokenJson} }),
        });
        if (!r.ok) throw new Error("attest " + r.status);
        const f = document.createElement("iframe");
        f.title = ${titleJson};
        // Set window.name BEFORE assigning src so the inner page can read
        // it on first load. window.name is per-window and not exposed in
        // URLs, history, or referrer headers.
        f.name = ${tokenJson};
        f.src = ${innerUrlJson};
        f.setAttribute("allow", "autoplay; fullscreen; clipboard-write");
        f.setAttribute("allowfullscreen", "true");
        document.body.appendChild(f);
        // Forward postMessage events from the inner game artifact up to
        // the partner page (window.parent).
        window.addEventListener("message", function (e) {
          try {
            if (e.source !== f.contentWindow) return;
            if (window.parent && window.parent !== window) {
              window.parent.postMessage(e.data, "*");
            }
          } catch (_) {}
        }, false);
      } catch (e) {
        document.body.innerHTML =
          '<div class="err">Launch failed: ' + (e && e.message || e) + '</div>';
      }
    })();
  </script>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

export default router;
