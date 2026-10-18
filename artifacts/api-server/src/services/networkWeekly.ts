import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { forbidden } from "../lib/errors";

export async function weeklyStatus(masterId: string) {
  const result = await db.execute(sql`SELECT n.weekly_started_at AS "startedAt",
    (date_trunc('week',clock_timestamp() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS "weekStart",
    (date_trunc('week',clock_timestamp() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')+interval '8 days' AS "nextDeadline",
    network_weekly_due(n.id,clock_timestamp(),false)::text AS "duePaise",
    network_weekly_due(n.id)::text AS "overduePaise"
    FROM network_nodes n WHERE n.id=${masterId} AND n.kind='master'`);
  const row = result.rows[0];
  return row ? { ...row, locked: BigInt(String(row.overduePaise)) > 0n } : null;
}

export async function assertBranchOperations(userId: string) {
  const result =
    await db.execute(sql`SELECT network_weekly_due(COALESCE(n.parent_id,n.id))::text AS due
    FROM network_nodes n WHERE n.user_id=${userId}`);
  if (result.rows.some((row) => BigInt(String(row.due)) > 0n))
    throw forbidden(
      "Branch locked for overdue weekly payment. Open Weekly account to submit payment details.",
    );
}
