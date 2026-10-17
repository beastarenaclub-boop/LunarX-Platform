import { Pool } from "@workspace/db";

// Admission locks must not occupy the wallet pool: simultaneous players could
// otherwise hold every connection while waiting for their own debit to run.
const admissionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  allowExitOnIdle: true,
});

export async function withRouletteAdmission<T>(userId: string, action: () => Promise<T>): Promise<T> {
  const client = await admissionPool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked", [`roulette-bets:${userId}`]);
    if (!result.rows[0]?.locked) throw new Error("ROULETTE_BET_IN_PROGRESS");
    return await action();
  } finally {
    try { await client.query("ROLLBACK"); } catch { broken = true; }
    client.release(broken);
  }
}
