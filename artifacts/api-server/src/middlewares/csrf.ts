import type { NextFunction, Request, Response } from "express";
import { sessionCookie } from "./siteChannel";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const corsAllowlist = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function originAllowed(req: Request, origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  // Same-host requests (via the shared preview proxy or the app's own domain).
  if (host === req.headers.host) return true;
  // Explicitly configured cross-origin frontends.
  if (corsAllowlist.includes(origin)) return true;
  // Replit-provided dev/prod domains for this app.
  const replitDomains = [
    process.env.REPLIT_DEV_DOMAIN,
    ...(process.env.REPLIT_DOMAINS ?? "").split(","),
  ]
    .map((d) => (d ?? "").trim())
    .filter(Boolean);
  return replitDomains.includes(host);
}

/**
 * CSRF protection for cookie-authenticated requests.
 *
 * The session cookie is SameSite=None (required so the app works inside the
 * Replit preview iframe), which means browsers attach it to cross-site
 * requests too. To prevent CSRF, every state-changing request that was
 * authenticated via the session cookie must carry an Origin (or Referer)
 * from an allowed origin: same host, the CORS_ORIGINS allowlist, or the
 * Replit domains for this app.
 *
 * Requests without a session cookie (e.g. partner HMAC/bearer auth, login
 * itself before a session exists, webhooks) are unaffected.
 */
export function csrfProtect(req: Request, res: Response, next: NextFunction) {
  if (!UNSAFE_METHODS.has(req.method)) return next();
  // Only cookie-authenticated requests are CSRF-able.
  if (!req.cookies?.[sessionCookie(req)]) return next();

  const origin =
    (req.headers.origin as string | undefined) ??
    (req.headers.referer as string | undefined);
  // Non-browser clients (curl, server-to-server) send neither header; they
  // are not CSRF vectors because an attacker cannot make a victim's browser
  // omit Origin on a cross-site request.
  if (!origin) return next();

  if (originAllowed(req, origin)) return next();

  res.status(403).json({ error: "Cross-site request rejected" });
}
