import rateLimit from "express-rate-limit";
import type { Request } from "express";

// Tests can bypass the demo-login rate limiters by sending
// `x-test-bypass: ${TEST_RATE_LIMIT_BYPASS}` when that env var is set. The env
// var is only populated on dev/Replit (see scripts/post-merge.sh and the
// `responsive` validation step) — never in production — so the limits remain
// enforced for real traffic.
const TEST_RATE_LIMIT_BYPASS = process.env.TEST_RATE_LIMIT_BYPASS ?? "";
function skipIfTestBypass(req: Request): boolean {
  if (!TEST_RATE_LIMIT_BYPASS) return false;
  return req.headers["x-test-bypass"] === TEST_RATE_LIMIT_BYPASS;
}

export function deviceFingerprint(req: Request): string {
  const raw = req.headers["x-device-id"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return `dev:${raw.trim().slice(0, 128)}`;
  }
  // Fall back to a UA-derived hint so devices without an explicit fingerprint
  // header still get partially distinguished. Not cryptographic; just keying.
  const ua = req.headers["user-agent"];
  return `ua:${typeof ua === "string" ? ua.slice(0, 256) : "none"}`;
}

// Per-device hourly limit. Keyed on device fingerprint only so changing IPs
// (e.g. flipping a VPN on/off) does not reset the bucket for the same device.
export const demoLoginRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => deviceFingerprint(req),
  validate: { xForwardedForHeader: false, ip: false },
  skip: skipIfTestBypass,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message:
        "Demo limit reached for now. Please sign up for a full account or try again later.",
    },
  },
});

// Per-IP hourly limit. Uses Express's req.ip (which respects the configured
// `trust proxy` chain) so a client cannot evade by spoofing X-Forwarded-For.
export const demoLoginIpRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipIfTestBypass,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message:
        "Too many demo accounts from this network. Please sign up for a full account.",
    },
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipIfTestBypass,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts, try again later.",
    },
  },
});

export const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipIfTestBypass,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many password reset requests, try again later.",
    },
  },
});

export const bettingRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? "anon",
  validate: { xForwardedForHeader: false, ip: false },
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many bets, slow down.",
    },
  },
});

export const bettingIpRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests from this IP.",
    },
  },
});
