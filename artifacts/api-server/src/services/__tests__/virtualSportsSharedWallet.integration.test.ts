import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("five sports share the ledger: atomic debit, private receipts, retry, cutoff and recovered payouts", {
  skip: !process.env.SHARED_WALLET_INTEGRATION, timeout: 200000,
}, async () => {
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_shared_wallet_test"));
  const { db, pool, usersTable, walletsTable, walletLedgerTable, virtualSportsRoundsTable: rounds, virtualSportsBetsTable: bets } = await import("@workspace/db");
  const { eq, inArray, sql } = await import("drizzle-orm");
  const { virtualSportsState, placeVirtualSportsBet, tickVirtualSports, startVirtualSportsEngine } = await import("../virtualSports");
  const { postEntry, getBalanceByUser } = await import("../wallet");
  const ids = [randomUUID(), randomUUID()], [alice, bob] = ids;
  let stop: (() => void) | undefined;
  try {
    for (const id of ids) await db.insert(usersTable).values({ id, email: `${id}@example.test`, emailNormalized: `${id}@example.test`, passwordHash: "test", displayName: "Sports wallet test" });
    let state = await virtualSportsState(alice);
    assert.equal(state.mode, "wallet"); assert.equal(state.account.balance, 0, "opening sports cannot grant practice money");
    assert.equal(state.accountId, alice);
    await postEntry({ userId: alice, type: "adjustment", amount: 100000n });
    await postEntry({ userId: bob, type: "adjustment", amount: 1500n });
    const first = state.rounds[0];
    if (first.phase !== "betting" || first.closes - state.serverTime < 10000) {
      await new Promise(r => setTimeout(r, first.next - state.serverTime + 150));
      state = await virtualSportsState(alice);
    }
    assert.equal(state.rounds.length, 5);
    assert.ok(state.matches!.every(r => r.winner === null && r.events.length === 0 && r.score.every(s => s === 0)), "future results are private");
    const cricket = state.matches!.find(r => r.sport === "cricket" && r.fixture!.id === "india-pakistan")!;
    const input = { requestId: randomUUID(), roundId: cricket.id, sport: cricket.sport, choice: 0, stake: 11 };
    const duplicate = await Promise.all([placeVirtualSportsBet(alice, input), placeVirtualSportsBet(alice, input)]);
    assert.ok(duplicate.every(s => s.account.balance === 989));
    await assert.rejects(placeVirtualSportsBet(alice, { ...input, stake: 12 }), /different bet/);
    await assert.rejects(placeVirtualSportsBet(alice, { ...input, requestId: randomUUID(), choice: 3 }));
    await assert.rejects(placeVirtualSportsBet(alice, { ...input, requestId: randomUUID(), stake: 10.5 }));
    await assert.rejects(placeVirtualSportsBet(alice, { ...input, requestId: randomUUID(), roundId: "old-round" }), /closed/);
    // One funded bet in every sport, with a controlled fixture used only by this isolated database.
    const funded = [cricket];
    for (const round of state.rounds.filter(r => r.sport !== "cricket")) {
      await placeVirtualSportsBet(alice, { ...input, requestId: randomUUID(), roundId: round.id, sport: round.sport });
      funded.push(round);
    }
    assert.equal((await getBalanceByUser(alice, "dice")).balance, 94500n);
    assert.equal((await virtualSportsState(bob)).bets.length, 0);
    const contest = await Promise.allSettled([
      placeVirtualSportsBet(bob, { ...input, requestId: randomUUID(), stake: 10 }),
      postEntry({ userId: bob, scope: "dice", type: "bet", amount: -1000n }),
    ]);
    assert.equal(contest.filter(r => r.status === "fulfilled").length, 1, "cross-game wallet spending serializes");
    assert.equal((await getBalanceByUser(bob)).balance, 500n);
    const before = (await virtualSportsState(bob)).bets.length;
    await assert.rejects(placeVirtualSportsBet(bob, { ...input, requestId: randomUUID() }), /Not enough wallet balance/);
    assert.equal((await virtualSportsState(bob)).bets.length, before, "failed debit rolls back the bet");
    for (const round of funded) {
      const [stored] = await db.select().from(rounds).where(eq(rounds.id, round.id));
      await db.update(rounds).set({ data: { ...stored.data, winner: 0 } }).where(eq(rounds.id, round.id));
    }
    const expected = 94500n + BigInt(funded.reduce((total, r) => total + 11 * Math.round(r.odds[0] * 100), 0));
    stop = startVirtualSportsEngine();
    await new Promise(r => setTimeout(r, Math.max(0, cricket.ends - Date.now()) + 100));
    for (let i = 0; i < 80 && (await getBalanceByUser(alice)).balance !== expected; i++) await new Promise(r => setTimeout(r, 100));
    stop(); stop = undefined;
    assert.equal((await getBalanceByUser(alice)).balance, expected, "background engine settles without an open page");
    await Promise.all([tickVirtualSports(), tickVirtualSports()]);
    const retried = await placeVirtualSportsBet(alice, input);
    assert.equal(retried.account.balance, Number(expected) / 100, "retry after settlement never debits again");
    const ledger = await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.userId, alice));
    assert.equal(ledger.filter(e => e.refType === "virtual_sports_bet").length, 5);
    assert.equal(ledger.filter(e => e.refType === "virtual_sports_payout").length, 5);
    assert.equal(new Set(ledger.map(e => e.walletId)).size, 1);
    assert.ok(retried.bets.every(b => b.status === "won" && b.payout === b.stake * Math.round(b.odds * 100) / 100));
    await assert.rejects(placeVirtualSportsBet(alice, { ...input, requestId: randomUUID() }), /closed/);
    // Block on another game's wallet row until the real betting deadline passes.
    let fresh = await virtualSportsState(alice);
    if (fresh.rounds[0].phase !== "betting" || fresh.rounds[0].closes - fresh.serverTime < 1500) {
      await new Promise(r => setTimeout(r, fresh.rounds[0].next - fresh.serverTime + 150));
      fresh = await virtualSportsState(alice);
    }
    const late = fresh.rounds.find(r => r.sport === "tennis")!;
    const wallet = await getBalanceByUser(alice);
    let locked!: () => void;
    const ready = new Promise<void>(r => { locked = r; });
    const holding = db.transaction(async tx => {
      await tx.execute(sql`select id from wallets where id = ${wallet.walletId} for update`);
      locked();
      await tx.execute(sql`select pg_sleep(${Math.max(0, (late.closes - Date.now()) / 1000) + .2})`);
    });
    await ready;
    await assert.rejects(placeVirtualSportsBet(alice, { ...input, requestId: randomUUID(), roundId: late.id, sport: "tennis" }), /closed/);
    await holding;
    assert.equal((await getBalanceByUser(alice)).balance, expected, "late admission rolls back debit and receipt");
  } finally {
    stop?.();
    await db.delete(bets).where(inArray(bets.userId, ids));
    await db.delete(walletLedgerTable).where(inArray(walletLedgerTable.userId, ids));
    await db.delete(walletsTable).where(inArray(walletsTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    await pool.end();
  }
});
