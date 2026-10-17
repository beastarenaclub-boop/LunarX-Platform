import { db, auditLogTable, type UserRole } from "@workspace/db";
import type { Request } from "express";
import { logger } from "./logger";

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: UserRole | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      before: entry.before === undefined ? null : (entry.before as object),
      after: entry.after === undefined ? null : (entry.after as object),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    });
  } catch (err) {
    logger.error({ err, entry }, "Failed to write audit log");
  }
}

export async function recordAuditFromReq(
  req: Request,
  partial: Omit<AuditEntry, "actorId" | "actorRole" | "ip" | "userAgent">,
): Promise<void> {
  const user = req.user;
  await recordAudit({
    actorId: user?.id ?? null,
    actorRole: user?.role ?? null,
    ip: clientIp(req),
    userAgent: req.headers["user-agent"] ?? null,
    ...partial,
  });
}

export function clientIp(req: Request): string | null {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]!.trim();
  }
  return req.ip ?? null;
}
