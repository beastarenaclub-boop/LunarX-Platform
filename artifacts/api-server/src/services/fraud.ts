import {
  db,
  fraudFlagsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, isNull, sql, desc, gte } from "drizzle-orm";
import { logger } from "../lib/logger";
import { DEMO_RUNTIME } from "../demo/runtime";

export async function createFraudFlag(input: {
  userId: string;
  rule: string;
  severity: "low" | "medium" | "high" | "critical";
  description?: string | null;
  metadata?: unknown;
}): Promise<void> {
  try {
    await db.insert(fraudFlagsTable).values({
      userId: input.userId,
      rule: input.rule,
      severity: input.severity,
      description: input.description ?? null,
      metadata: input.metadata === undefined ? null : (input.metadata as object),
    });
  } catch (err) {
    logger.error({ err, input }, "Failed to create fraud flag");
  }
}

export async function detectMultiAccounts(): Promise<number> {
  let flagged = 0;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const ipClusters = await db.execute<{
    ip: string;
    user_ids: string[];
    cnt: number;
  }>(sql`
    SELECT s.ip, array_agg(DISTINCT s.user_id) AS user_ids, COUNT(DISTINCT s.user_id)::int AS cnt
    FROM ${sessionsTable} s
    WHERE s.ip IS NOT NULL
      AND s.created_at >= ${since}
    GROUP BY s.ip
    HAVING COUNT(DISTINCT s.user_id) >= 3
    ORDER BY cnt DESC
    LIMIT 100
  `);

  for (const cluster of ipClusters.rows) {
    for (const userId of cluster.user_ids) {
      const existing = await db
        .select({ id: fraudFlagsTable.id })
        .from(fraudFlagsTable)
        .where(
          and(
            eq(fraudFlagsTable.userId, userId),
            eq(fraudFlagsTable.rule, "multi_account_ip"),
            eq(fraudFlagsTable.resolved, false),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      await createFraudFlag({
        userId,
        rule: "multi_account_ip",
        severity: cluster.cnt >= 5 ? "high" : "medium",
        description: `${cluster.cnt} accounts share IP ${cluster.ip}`,
        metadata: {
          ip: cluster.ip,
          accountCount: cluster.cnt,
          relatedUserIds: cluster.user_ids.filter((id: string) => id !== userId),
        },
      });
      flagged++;
    }
  }

  const uaClusters = await db.execute<{
    user_agent: string;
    user_ids: string[];
    cnt: number;
  }>(sql`
    SELECT s.user_agent, array_agg(DISTINCT s.user_id) AS user_ids, COUNT(DISTINCT s.user_id)::int AS cnt
    FROM ${sessionsTable} s
    WHERE s.user_agent IS NOT NULL
      AND s.created_at >= ${since}
      AND s.user_agent LIKE '%HeadlessChrome%'
    GROUP BY s.user_agent
    HAVING COUNT(DISTINCT s.user_id) >= 2
    ORDER BY cnt DESC
    LIMIT 50
  `);

  for (const cluster of uaClusters.rows) {
    for (const userId of cluster.user_ids) {
      const existing = await db
        .select({ id: fraudFlagsTable.id })
        .from(fraudFlagsTable)
        .where(
          and(
            eq(fraudFlagsTable.userId, userId),
            eq(fraudFlagsTable.rule, "headless_browser"),
            eq(fraudFlagsTable.resolved, false),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      await createFraudFlag({
        userId,
        rule: "headless_browser",
        severity: "high",
        description: `Headless browser detected for ${cluster.cnt} accounts`,
        metadata: {
          userAgent: cluster.user_agent,
          accountCount: cluster.cnt,
          relatedUserIds: cluster.user_ids.filter((id: string) => id !== userId),
        },
      });
      flagged++;
    }
  }

  return flagged;
}

const betTimestamps = new Map<string, number[]>();

export function recordBetTiming(userId: string): {
  flagged: boolean;
  reason?: string;
} {
  if (DEMO_RUNTIME) return { flagged: false };
  const now = Date.now();
  const times = betTimestamps.get(userId) ?? [];
  times.push(now);
  const recent = times.filter((t) => now - t < 60_000).slice(-20);
  betTimestamps.set(userId, recent);

  if (recent.length >= 3) {
    const intervals: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      intervals.push(recent[i]! - recent[i - 1]!);
    }
    const subSecond = intervals.filter((d) => d < 1000);
    if (subSecond.length >= 3) {
      return { flagged: true, reason: "Sub-second bet cadence detected" };
    }
    if (intervals.length >= 5) {
      const avg =
        intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance =
        intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) /
        intervals.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev < 50 && avg < 2000) {
        return {
          flagged: true,
          reason: `Identical timing pattern (avg=${Math.round(avg)}ms, stdDev=${Math.round(stdDev)}ms)`,
        };
      }
    }
  }

  return { flagged: false };
}

export function cleanupTimings() {
  const now = Date.now();
  for (const [userId, times] of betTimestamps) {
    const recent = times.filter((t) => now - t < 120_000);
    if (recent.length === 0) {
      betTimestamps.delete(userId);
    } else {
      betTimestamps.set(userId, recent);
    }
  }
}

// unref so this background sweep never keeps the process alive on its own
// (the HTTP server's listening socket is what should hold the event loop open).
setInterval(cleanupTimings, 60_000).unref();
