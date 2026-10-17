import type { Request, Response, NextFunction } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  findPartnerByKeyId,
  verifyHmac,
  HMAC_TIMESTAMP_TOLERANCE_MS,
  touchKeyUsage,
  consumeRequestNonce,
  decryptSecret,
} from "../services/partners";
import { unauthorized, forbidden } from "../lib/errors";
import { logPartnerRequest } from "../services/partnerRequestLog";
import { clientIp } from "../lib/audit";

const HEADER_KEY = "x-partner-key";
const HEADER_TS = "x-partner-timestamp";
const HEADER_SIG = "x-partner-signature";

function header(req: Request, name: string): string | null {
  const v = req.headers[name];
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

export async function requirePartnerKey(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const keyId = header(req, HEADER_KEY);
    const ts = header(req, HEADER_TS);
    const sig = header(req, HEADER_SIG);
    if (!keyId || !ts || !sig) {
      throw unauthorized(
        "Partner authentication required (X-Partner-Key, X-Partner-Timestamp, X-Partner-Signature)",
      );
    }
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) throw unauthorized("Invalid timestamp");
    if (Math.abs(Date.now() - tsNum) > HMAC_TIMESTAMP_TOLERANCE_MS) {
      throw unauthorized("Request timestamp out of window");
    }

    const found = await findPartnerByKeyId(keyId);
    if (!found) throw unauthorized("Unknown API key");
    if (found.apiKey.status !== "active") throw forbidden("API key revoked");
    if (found.partner.status !== "active")
      throw forbidden(`Partner is ${found.partner.status}`);

    // Anti-replay: nonce is required and is bound INTO the HMAC payload
    // below so an attacker cannot rotate just the nonce on a captured req.
    const nonce = header(req, "x-partner-nonce");
    if (!nonce) throw unauthorized("X-Partner-Nonce header required");
    if (nonce.length < 8 || nonce.length > 128) {
      throw unauthorized("X-Partner-Nonce must be 8–128 chars");
    }

    // Single signing scheme:
    //   sig = HMAC-SHA256(secret, `${ts}.${nonce}.${rawBody}`)
    // The plaintext partner secret never leaves the partner — server stores
    // it (encrypted at rest by the DB) and computes the same HMAC for compare.
    // Defensive: a key whose stored secret is empty was never migrated to
    // the new scheme (or was wiped). Reject explicitly so partners get a
    // clear "rotate your key" signal rather than a generic bad-signature.
    if (!found.apiKey.secret) {
      throw unauthorized("API key requires rotation (no secret on file)");
    }
    let plaintextSecret: string;
    try {
      plaintextSecret = decryptSecret(found.apiKey.secret);
    } catch {
      throw unauthorized("API key secret is corrupt; rotate the key");
    }
    const body = req.rawBody ?? "";
    if (
      !verifyHmac({
        secret: plaintextSecret,
        timestamp: ts,
        nonce,
        body,
        signature: sig,
      })
    ) {
      throw unauthorized("Bad signature");
    }

    // Persist the nonce only AFTER signature succeeds so failed attempts
    // don't burn nonces (and don't allow blind nonce-flooding by attackers).
    const accepted = await consumeRequestNonce(found.apiKey.id, nonce);
    if (!accepted) throw unauthorized("Replayed nonce");

    req.partner = found.partner;
    req.partnerApiKey = found.apiKey;
    void touchKeyUsage(found.apiKey.id);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Rate-limit partner traffic per API key (falls back to IP for unauthed
 * preflight). Default 120 req/minute per key — enough for normal play.
 */
export const partnerRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: Request, res) => {
    const k = req.partnerApiKey?.id;
    if (k) return `pk:${k}`;
    const headerKey = req.headers["x-partner-key"];
    if (typeof headerKey === "string") return `hk:${headerKey}`;
    return `ip:${ipKeyGenerator(req.ip ?? "anon", res as never)}`;
  },
  validate: { xForwardedForHeader: false, ip: false },
  message: { error: { code: "TOO_MANY_REQUESTS", message: "Slow down." } },
});

/**
 * After-route middleware: persist a request log row. Mounted at the bottom
 * of the /v1 router so it captures every response.
 */
export function logPartnerResponse(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const start = Date.now();
  res.on("finish", () => {
    const partnerId =
      req.partner?.id ??
      (typeof req.headers["x-partner-key"] === "string"
        ? null
        : null);
    void logPartnerRequest({
      partnerId,
      apiKeyId: req.partnerApiKey?.id ?? null,
      requestId:
        (req.headers["x-request-id"] as string | undefined) ?? null,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      latencyMs: Date.now() - start,
      ip: clientIp(req),
      errorCode: null,
    });
  });
  next();
}

