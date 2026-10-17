/**
 * One-off backfill: pay out bets that were cashed_out but never credited
 * because they were stored without a round_id (client bug — pari-mutuel
 * settlement only pays per-round). Pays stake × multiplier into the bet's
 * game wallet scope via the normal ledger path, and stamps payout_amount
 * on the bet so it is never double-paid on a re-run (idempotent).
 *
 * Run: npx tsx scripts/backfill-unpaid-cashouts.ts
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { postEntry, toWalletScope } from "../src/services/wallet";

async function main() {
  const res = await db.execute(sql`
    SELECT id, user_id, game_code, stake_amount, multiplier
    FROM bets
    WHERE status = 'cashed_out' AND payout_amount = 0 AND round_id IS NULL
      AND multiplier IS NOT NULL
  `);
  const rows = res.rows as Array<{
    id: string;
    user_id: string;
    game_code: string;
    stake_amount: string;
    multiplier: string;
  }>;
  console.log(`Found ${rows.length} unpaid cashed-out bets`);
  for (const b of rows) {
    const payout = BigInt(
      Math.round(Number(b.stake_amount) * Number(b.multiplier)),
    );
    if (payout <= 0n) {
      console.log(`skip ${b.id}: payout ${payout}`);
      continue;
    }
    await db.transaction(async (tx) => {
      // Idempotency guard: re-check inside the tx and stamp payout first.
      const upd = await tx.execute(sql`
        UPDATE bets SET payout_amount = ${payout.toString()}
        WHERE id = ${b.id} AND payout_amount = 0 AND status = 'cashed_out'
        RETURNING id
      `);
      if (upd.rows.length === 0) return;
      await postEntry(
        {
          userId: b.user_id,
          type: "win",
          amount: payout,
          refType: "bet",
          refId: b.id,
          memo: `Backfill: unpaid cashout (missing round_id) ${b.game_code}`,
          scope: toWalletScope(b.game_code),
        },
        tx,
      );
    });
    console.log(
      `paid ${b.id} user=${b.user_id} game=${b.game_code} payout=${payout} paise`,
    );
  }
  console.log("done");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
