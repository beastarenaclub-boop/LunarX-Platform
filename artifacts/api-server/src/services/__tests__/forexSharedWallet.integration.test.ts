import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("Forex atomically debits shared funds, recovers payouts once, and refunds equal asset pools", {
  skip: !process.env.SHARED_WALLET_INTEGRATION,
}, async () => {
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_shared_wallet_test"));
  const { db, pool, usersTable, walletsTable, walletLedgerTable, forexMarketTable: markets, forexTradesTable: trades } = await import("@workspace/db");
  const { eq, inArray, sql } = await import("drizzle-orm");
  const { forexState, placeForexTrade, tickForex, startForexEngine } = await import("../forex");
  const { postEntry, getBalanceByUser, getAllScopeBalances, WALLET_SCOPES } = await import("../wallet");
  const { MARKETS } = await import("../../../../../lib/forex/market.mjs");
  const ids = [randomUUID(), randomUUID()];
  const [alice, bob] = ids;
  let stop: (() => void) | undefined;
  const resetRound = async (offset: number) => {
    const [row] = await db.select().from(markets);
    const data = { ...row.data, start: Date.now() - 1000, roundId: Math.floor(Date.now() / 60000) - offset };
    await db.update(markets).set({ data }).where(eq(markets.id, 1));
    return data;
  };
  const expire = async () => {
    const [row] = await db.select().from(markets);
    await db.update(markets).set({ data: { ...row.data, start: Date.now() - 60001 } }).where(eq(markets.id, 1));
  };
  try {
    for (const id of ids) await db.insert(usersTable).values({ id, email: `${id}@example.test`, emailNormalized: `${id}@example.test`, passwordHash: "test", displayName: "Forex wallet test" });
    const empty = await forexState(alice);
    assert.equal(empty.mode, "wallet");
    assert.equal(empty.account!.balance, 0, "no free practice funds on opening a game");
    await postEntry({ userId: alice, type: "adjustment", amount: 1_000_000n });
    await postEntry({ userId: bob, type: "adjustment", amount: 1_500n });
    const walletIds = await Promise.all(WALLET_SCOPES.map(async scope => (await getBalanceByUser(alice, scope)).walletId));
    assert.equal(new Set(walletIds).size, 1);
    const round = await resetRound(10);
    const input = { asset: "gold", side: "sell", amount: 100, roundId: round.roundId, requestId: randomUUID() };
    const placed = await Promise.all([placeForexTrade(alice, input), placeForexTrade(alice, input)]);
    assert.ok(placed.every(s => s.account!.balance === 9900));
    assert.equal(placed[0].pool.total, 100);
    await assert.rejects(async () => placeForexTrade(alice, { ...input, amount: 110 }), /already used/);
    await assert.rejects(async () => placeForexTrade(alice, { ...input, requestId: randomUUID(), amount: 11 }));
    await placeForexTrade(alice, { ...input, side: "buy", amount: 50, requestId: randomUUID() });
    const silver = await placeForexTrade(alice, { ...input, asset: "silver", side: "buy", amount: 10, requestId: randomUUID() });
    assert.equal(silver.assets.find(m => m.id === "gold")!.direction, "down");
    assert.equal(silver.assets.find(m => m.id === "silver")!.direction, "up");
    assert.equal(silver.account!.balance, 9840);
    assert.equal((await forexState(bob)).trades.length, 0, "private trade history");
    assert.ok(Object.values(await getAllScopeBalances(alice)).every(v => v === "984000"));

    const contest = await Promise.allSettled([
      placeForexTrade(bob, { ...input, amount: 10, requestId: randomUUID() }),
      postEntry({ userId: bob, scope: "dice", type: "bet", amount: -1000n }),
    ]);
    assert.equal(contest.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await getBalanceByUser(bob)).balance, 500n);
    const beforeFailure = (await forexState(bob)).pool.total;
    await assert.rejects(placeForexTrade(bob, { ...input, requestId: randomUUID() }), /Not enough wallet balance/);
    assert.equal((await forexState(bob)).pool.total, beforeFailure, "failed debit never changes pools");
    assert.equal((await db.select().from(trades).where(eq(trades.userId, bob))).length, contest[0].status === "fulfilled" ? 1 : 0);

    await expire();
    stop = startForexEngine();
    for (let attempt = 0; attempt < 80; attempt++) {
      if ((await getBalanceByUser(alice)).balance === 1004900n) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    stop(); stop = undefined;
    assert.equal((await getBalanceByUser(alice)).balance, 1004900n, "background payouts include stake and use exact paise");
    await Promise.all([tickForex(), tickForex()]);
    const retried = await placeForexTrade(alice, input);
    assert.equal(retried.account!.balance, 10049);
    assert.equal(retried.account!.profit, 49);
    assert.equal(retried.account!.wins, 2);
    const ledger = await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.userId, alice));
    assert.equal(ledger.filter(e => e.refType === "forex_bet").length, 3);
    assert.equal(ledger.filter(e => e.refType === "forex_payout").length, 2);
    assert.ok(ledger.every(e => e.walletId === walletIds[0]));
    await assert.rejects(placeForexTrade(alice, { ...input, requestId: randomUUID() }), /locked/);

    const equal = await resetRound(9);
    for (const market of MARKETS) await placeForexTrade(alice, { ...input, roundId: equal.roundId, asset: market.id, amount: 10, requestId: randomUUID() });
    const flat = await forexState(alice);
    assert.ok(flat.assets.every(m => m.direction === "flat"));
    await expire();
    await Promise.all([tickForex(), tickForex()]);
    assert.equal((await getBalanceByUser(alice)).balance, 1004900n, "all equal pool stakes refunded once");
    const refunded = (await forexState(alice)).trades.filter(t => t.roundId === equal.roundId);
    assert.equal(refunded.length, 12);
    assert.ok(refunded.every(t => t.status === "refund" && t.payout === 10));

    // Another game's wallet lock delays this request past the betting cutoff.
    const late = await resetRound(8);
    await db.update(markets).set({ data: { ...late, start: Date.now() - 44000 } }).where(eq(markets.id, 1));
    let locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const holding = db.transaction(async tx => {
      await tx.execute(sql`select id from wallets where id = ${walletIds[0]} for update`);
      locked();
      await tx.execute(sql`select pg_sleep(1.5)`);
    });
    await ready;
    await assert.rejects(placeForexTrade(alice, { ...input, roundId: late.roundId, requestId: randomUUID() }), /locked/);
    await holding;
    assert.equal((await getBalanceByUser(alice)).balance, 1004900n, "late bet and debit rolled back together");
  } finally {
    stop?.();
    await db.delete(trades).where(inArray(trades.userId, ids));
    await db.delete(walletLedgerTable).where(inArray(walletLedgerTable.userId, ids));
    await db.delete(walletsTable).where(inArray(walletsTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    await pool.end();
  }
});
