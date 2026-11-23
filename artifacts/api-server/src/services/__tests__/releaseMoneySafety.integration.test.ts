import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test("release money guards: frozen debits, concurrent UTRs and atomic exactly-once refunds", { skip: !process.env.NETWORK_INTEGRATION }, async () => {
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_network_test"));
  const { db, pool, usersTable, betsTable, walletStatusTable, walletLedgerTable, bonusLedgerTable, bonusWageringTable } = await import("@workspace/db");
  const { eq, and } = await import("drizzle-orm");
  const { postEntry, getBalanceByUser } = await import("../wallet");
  const { refundStake } = await import("../bets");
  const { getBonusBalance } = await import("../bonusWallet");
  const { createPaymentRequest } = await import("../payments");
  const id = randomUUID(), email = `${id}@release.test`;
  try {
    await db.insert(usersTable).values({ id, email, emailNormalized: email, passwordHash: "unused", role: "player" });
    await postEntry({ userId: id, type: "adjustment", amount: 10000n });
    await db.insert(walletStatusTable).values({ userId: id, status: "frozen" });
    await assert.rejects(postEntry({ userId: id, type: "bet", amount: -100n }), /WALLET_FROZEN/);
    await assert.rejects(postEntry({ userId: id, type: "withdraw", amount: -100n }), /WALLET_FROZEN/);
    await postEntry({ userId: id, type: "win", amount: 150n });
    assert.equal((await getBalanceByUser(id)).balance, 10150n);
    await db.delete(walletStatusTable).where(eq(walletStatusTable.userId, id));

    const [cashBet] = await db.insert(betsTable).values({ userId: id, gameCode: "release-refund-test", stakeAmount: 100n, status: "placed" }).returning();
    await postEntry({ userId: id, type: "bet", amount: -100n, refId: cashBet!.id, refType: "bet" });
    await Promise.all(Array.from({ length: 5 }, () => refundStake(cashBet!.id, id, 100n)));
    assert.equal((await getBalanceByUser(id)).balance, 10150n);
    const credits = await db.select().from(walletLedgerTable).where(and(eq(walletLedgerTable.refId, cashBet!.id), eq(walletLedgerTable.type, "refund")));
    assert.equal(credits.length, 1);

    await db.insert(bonusLedgerTable).values({ userId: id, type: "adjust", amount: 900n, balanceAfter: 900n });
    await db.insert(bonusWageringTable).values({ userId: id, totalIssued: 1000n, requiredWager: 1000n, wageredSoFar: 100n });
    const [bonusBet] = await db.insert(betsTable).values({ userId: id, gameCode: "release-refund-test", stakeAmount: 100n, status: "placed", metadata: { useBonus: true } }).returning();
    // A credit rejected by PostgreSQL must roll back the bet claim too.
    await assert.rejects(refundStake(bonusBet!.id, id, 10n ** 30n));
    assert.equal((await db.select().from(betsTable).where(eq(betsTable.id, bonusBet!.id)))[0]!.status, "placed");
    assert.equal(await getBonusBalance(id), 900n);
    await Promise.all(Array.from({ length: 5 }, () => refundStake(bonusBet!.id, id, 100n)));
    assert.equal(await getBonusBalance(id), 1000n);
    assert.equal((await db.select().from(bonusWageringTable).where(eq(bonusWageringTable.userId, id)))[0]!.wageredSoFar, 0n);
    const bonusCredits = await db.select().from(bonusLedgerTable).where(eq(bonusLedgerTable.refId, bonusBet!.id));
    assert.equal(bonusCredits.length, 1);

    const utr = `release-${id}`;
    const attempts = await Promise.allSettled([utr, utr.toUpperCase()].map(upiRef => createPaymentRequest({ userId: id, kind: "deposit", amount: 100n, upiRef })));
    assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(attempts.filter(r => r.status === "rejected").length, 1);
  } finally {
    // The network ledger is intentionally append-only. Keep this unique
    // fixture in the dedicated test database, as the network suite does.
    await pool.end();
  }
});
