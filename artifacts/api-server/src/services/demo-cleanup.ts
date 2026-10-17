import { and, eq, lt, like, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  betsTable,
  walletLedgerTable,
  wingoBetsTable,
  virtualSportsBetsTable,
} from "@workspace/db";
import { DEMO_EMAIL_DOMAIN, DEMO_EMAIL_PREFIX } from "../lib/serialize";
import { logger } from "../lib/logger";

export const DEFAULT_DEMO_IDLE_HOURS = 24;

function thresholdDate(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export async function findIdleDemoUserIds(thresholdHours: number): Promise<string[]> {
  const cutoff = thresholdDate(thresholdHours);
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "player"),
        like(usersTable.emailNormalized, `${DEMO_EMAIL_PREFIX}%${DEMO_EMAIL_DOMAIN}`),
        lt(usersTable.updatedAt, cutoff),
        lt(usersTable.createdAt, cutoff),
      ),
    );
  return rows.map((r) => r.id);
}

export async function cleanupIdleDemoAccounts(
  thresholdHours: number = DEFAULT_DEMO_IDLE_HOURS,
): Promise<{ deleted: number; userIds: string[] }> {
  const ids = await findIdleDemoUserIds(thresholdHours);
  if (ids.length === 0) return { deleted: 0, userIds: [] };

  const BATCH = 50;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    await db.transaction(async (tx) => {
      // Delete restricted child rows first; remaining FKs cascade on user delete.
      await tx.delete(betsTable).where(inArray(betsTable.userId, batch));
      await tx.delete(wingoBetsTable).where(inArray(wingoBetsTable.userId, batch));
      await tx.delete(virtualSportsBetsTable).where(inArray(virtualSportsBetsTable.userId, batch));
      await tx
        .delete(walletLedgerTable)
        .where(inArray(walletLedgerTable.userId, batch));
      const result = await tx
        .delete(usersTable)
        .where(inArray(usersTable.id, batch))
        .returning({ id: usersTable.id });
      deleted += result.length;
    });
  }

  logger.info({ deleted, thresholdHours }, "Demo account cleanup completed");
  return { deleted, userIds: ids };
}
