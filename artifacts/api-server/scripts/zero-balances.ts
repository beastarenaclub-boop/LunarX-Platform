import { db, walletsTable } from "@workspace/db";
import {
  getBalance,
  postEntry,
  toWalletScope,
} from "../src/services/wallet";

/**
 * One-time migration for the per-game wallet split.
 *
 * Players now hold a fully independent balance per game (lunar / mines /
 * plinko / dice). The product decision is a clean slate: every existing wallet
 * is brought back to zero by posting a balancing `adjustment` ledger entry.
 * History is preserved (we never delete ledger rows) but the spendable balance
 * of every wallet becomes 0.
 *
 * Idempotent: wallets already at 0 are skipped, so re-running is safe.
 */
async function main() {
  const wallets = await db
    .select({
      id: walletsTable.id,
      userId: walletsTable.userId,
      currency: walletsTable.currency,
      scope: walletsTable.scope,
    })
    .from(walletsTable);

  let zeroed = 0;
  let skipped = 0;

  for (const wallet of wallets) {
    const balance = await getBalance(wallet.id);
    if (balance === 0n) {
      skipped += 1;
      continue;
    }
    await postEntry({
      userId: wallet.userId,
      scope: toWalletScope(wallet.scope),
      currency: wallet.currency,
      type: "adjustment",
      amount: -balance,
      memo: "Per-game wallet migration: reset balance to zero",
      refType: "migration_zero_balance",
    });
    zeroed += 1;
    console.log(
      `Zeroed wallet ${wallet.id} (user=${wallet.userId} scope=${wallet.scope}) ` +
        `was ${balance.toString()} paise`,
    );
  }

  console.log(
    `Done. Wallets zeroed: ${zeroed}, already zero: ${skipped}, total: ${wallets.length}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
