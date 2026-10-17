import { db, appLogsTable, type AppLogLevel } from "@workspace/db";
import { logger } from "../lib/logger";

export interface AppLogEntry {
  level?: AppLogLevel;
  kind: string;
  message: string;
  actorId?: string | null;
  ip?: string | null;
  metadata?: unknown;
}

export async function writeAppLog(entry: AppLogEntry): Promise<void> {
  try {
    await db.insert(appLogsTable).values({
      level: entry.level ?? "info",
      kind: entry.kind,
      message: entry.message,
      actorId: entry.actorId ?? null,
      ip: entry.ip ?? null,
      metadata: entry.metadata === undefined ? null : (entry.metadata as object),
    });
  } catch (err) {
    logger.error({ err, entry }, "Failed to write app log");
  }
}
