import type { Request } from "express";
import { db, sessionsTable } from "@workspace/db";
import { eq, and, isNull, gt, sql } from "drizzle-orm";
import { clientIp } from "../lib/audit";
import { normalizeIp } from "./accountDevice";
import { createHash } from "node:crypto";
import { logger } from "../lib/logger";

const recent = new Map<string, { signature: string; at: number }>();
export async function recordSessionActivity(req: Request) {
  if (!req.session || !req.user) return;
  const now = Date.now(),
    session = req.session;
  const ip = normalizeIp(clientIp(req));
  const hints: Record<string, string> = {};
  for (const [name, header] of Object.entries({
    userAgent: "user-agent",
    platform: "sec-ch-ua-platform",
    platformVersion: "sec-ch-ua-platform-version",
    model: "sec-ch-ua-model",
    mobile: "sec-ch-ua-mobile",
  })) {
    const value = req.headers[header];
    if (typeof value === "string")
      hints[name] = value.slice(0, name === "userAgent" ? 1024 : 120);
  }
  const signature = createHash("sha256")
    .update(JSON.stringify([ip, hints]))
    .digest("hex");
  const previous = recent.get(session.id);
  if (previous?.signature === signature && now - previous.at < 60_000) return;
  if (recent.size >= 10_000) recent.clear();
  recent.set(session.id, { signature, at: now });
  try {
    await db
      .update(sessionsTable)
      .set({ lastSeenAt: new Date(now), lastIp: ip, clientHints: hints })
      .where(
        and(
          eq(sessionsTable.id, session.id),
          isNull(sessionsTable.revokedAt),
          gt(sessionsTable.expiresAt, new Date(now)),
          sql`(${sessionsTable.lastSeenAt} IS NULL OR ${sessionsTable.lastSeenAt}<=${new Date(now).toISOString()}::timestamptz)`,
        ),
      );
  } catch {
    recent.delete(session.id);
    logger.warn("Session activity could not be recorded");
  }
}
