import crypto from "node:crypto";
import { logger } from "./logger";

/**
 * Symmetric envelope for partner API key secrets so the database column
 * never holds plaintext. We use HMAC-SHA256 for partner request
 * verification, which means the server MUST be able to recover the original
 * secret — a one-way password hash (bcrypt etc.) is therefore not viable.
 *
 * Strategy: AES-256-GCM with a 32-byte master key sourced from the
 * `PARTNER_SECRET_KEY` env var (hex or base64). Each ciphertext carries
 * its own random 12-byte IV and 16-byte auth tag, so the same plaintext
 * never produces the same column value twice.
 *
 * Storage format (single string column):
 *   "enc:v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>"
 *
 * Backward compatibility: anything that does NOT start with "enc:v1:" is
 * treated as a legacy plaintext value and returned as-is. This lets the
 * env var be rotated and lets keys created before this change keep
 * working until they are next rotated.
 */

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.PARTNER_SECRET_KEY ?? "";
  if (raw) {
    let buf: Buffer | null = null;
    if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
      buf = Buffer.from(raw, "hex");
    } else {
      try {
        buf = Buffer.from(raw, "base64");
      } catch {
        buf = null;
      }
    }
    if (buf && buf.length === 32) {
      cachedKey = buf;
      return cachedKey;
    }
    logger.warn(
      "PARTNER_SECRET_KEY is set but is not 32 bytes (hex or base64); falling back to derived dev key",
    );
  } else {
    if (process.env.NODE_ENV === "production") {
      // Fail fast in production: a deterministic dev fallback key would
      // make the encrypted-at-rest column trivially decryptable by anyone
      // who reads our source.
      throw new Error(
        "PARTNER_SECRET_KEY must be set in production (32-byte hex or base64).",
      );
    }
    logger.warn(
      "PARTNER_SECRET_KEY not set — using derived development key. " +
        "Configure a real 32-byte key before going to production.",
    );
  }
  // Deterministic dev fallback so restarts don't invalidate keys created
  // earlier in the same dev DB. NOT secure — operators MUST set
  // PARTNER_SECRET_KEY before any real partner traffic.
  cachedKey = crypto
    .createHash("sha256")
    .update("lunar-partner-secret-dev-key-do-not-use-in-prod")
    .digest();
  return cachedKey;
}

const PREFIX = "enc:v1:";

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX.slice(0, -1),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(":");
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    // Legacy / not-yet-encrypted value — return verbatim so verification
    // still works during a rolling migration.
    return stored;
  }
  const parts = stored.split(":");
  // ["enc","v1",iv,tag,ct]
  if (parts.length !== 5) {
    throw new Error("CORRUPT_PARTNER_SECRET");
  }
  const [, , ivB64, tagB64, ctB64] = parts;
  const key = loadKey();
  const iv = Buffer.from(ivB64!, "base64url");
  const tag = Buffer.from(tagB64!, "base64url");
  const ct = Buffer.from(ctB64!, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
