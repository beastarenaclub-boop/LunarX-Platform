import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("Win Go shares funds, serializes cross-game spending, and settles retries exactly once", {
  skip: !process.env.SHARED_WALLET_INTEGRATION,
}, async () => {
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_shared_wallet_test"));
  const { db, pool, usersTable, walletsTable, walletLedgerTable, wingoRoundsTable: rounds, wingoBetsTable: bets } = await import("@workspace/db");
  const { eq, inArray } = await import("drizzle-orm");
  const { WALLET_SCOPES, getBalanceByUser, getAllScopeBalances, postEntry } = await import("../wallet");
  const { wingoState, placeWingoBet, tickWingo, startWingoEngine } = await import("../wingo");
  const { commitmentFor } = await import("../../../../3d-game/wingo-server/rules.mjs");
  const ids = [randomUUID(), randomUUID()];
  const [alice, bob] = ids;
  let stop: (() => void) | undefined;
  try {
    for (const id of ids) await db.insert(usersTable).values({ id, email: `${id}@example.test`,
      emailNormalized: `${id}@example.test`, passwordHash: "test", displayName: "Wallet integration" });
    assert.equal((await wingoState(alice)).player.balance, 0, "opening Win Go does not create free funds");
    await postEntry({ userId: alice, type: "adjustment", amount: 1_000_000n });
    await postEntry({ userId: bob, type: "adjustment", amount: 1_000n });
    const walletIds = await Promise.all(WALLET_SCOPES.map(async game => (await getBalanceByUser(alice, game)).walletId));
    assert.equal(new Set(walletIds).size, 1);
    assert.equal((await db.select().from(walletsTable).where(eq(walletsTable.userId, alice))).length, 1);
    // Keep test rounds open independent of where the wall clock is in its cycle.
    const main = await wingoState(alice, 300);
    const other = await wingoState(alice, 180);
    for (const round of [main.round, other.round]) {
      await db.update(rounds).set({ ends: Date.now() + 60_000, number: 5, secret: "test-secret",
        commitment: commitmentFor(round.period, 5, "test-secret") }).where(eq(rounds.period, round.period));
    }
    const slip = { duration: 300, period: main.round.period, pick: "5", stake: 1000, request: randomUUID() };
    const placed = await Promise.all([placeWingoBet(alice, slip), placeWingoBet(alice, slip)]);
    assert.ok(placed.every(state => state.player.balance === 999000));
    assert.equal(placed[0].bets[0].number, null);
    assert.ok(!("number" in placed[0].round) && !("secret" in placed[0].round));
    await assert.rejects(placeWingoBet(alice, { ...slip, pick: "4" }), /already used/);
    await assert.rejects(async () => placeWingoBet(alice, { ...slip, stake: 101 }), /100/);
    await placeWingoBet(alice, { ...slip, pick: "4", request: randomUUID() });
    await placeWingoBet(alice, { duration: 180, period: other.round.period, pick: "violet", stake: 100, request: randomUUID() });
    assert.ok(Object.values(await getAllScopeBalances(alice)).every(value => value === "997900"));
    assert.equal((await wingoState(bob)).player.balance, 1000, "accounts never share another player's balance");

    const contest = await Promise.allSettled([
      placeWingoBet(bob, { ...slip, stake: 800, request: randomUUID() }),
      postEntry({ userId: bob, scope: "dice", type: "bet", amount: -800n }),
    ]);
    assert.equal(contest.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await getBalanceByUser(bob, "wingo")).balance, 200n);
    await assert.rejects(placeWingoBet(bob, { ...slip, request: randomUUID() }), /enough wallet balance/);
    assert.equal((await db.select().from(bets).where(eq(bets.userId, bob))).length,
      contest[0].status === "fulfilled" ? 1 : 0, "failed debit rolls back its bet");

    for (const round of [main.round, other.round])
      await db.update(rounds).set({ ends: Date.now() - 1 }).where(eq(rounds.period, round.period));
    // Start the scheduler with persisted pending bets, without requesting player state.
    stop = startWingoEngine();
    for (let attempt = 0; attempt < 60; attempt++) {
      if ((await getBalanceByUser(alice)).balance === 1007350n) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal((await getBalanceByUser(alice, "lucky-7")).balance, 1007350n);
    stop(); stop = undefined;
    await Promise.all([tickWingo(), tickWingo()]);
    const retried = await placeWingoBet(alice, slip);
    assert.equal(retried.player.balance, 1007350);
    assert.equal(retried.pending, 0);
    assert.deepEqual(retried.summary, { played: 3, won: 2, profit: 7350 });
    const revealed = retried.history.find(round => round.period === slip.period)!;
    assert.equal(revealed.commitment, commitmentFor(revealed.period, revealed.number, revealed.secret));
    const ledger = await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.userId, alice));
    assert.equal(ledger.filter(entry => entry.refType === "wingo_bet").length, 3);
    assert.equal(ledger.filter(entry => entry.refType === "wingo_payout").length, 2);
    assert.ok(ledger.every(entry => entry.walletId === walletIds[0]));
    assert.ok(Object.values(await getAllScopeBalances(alice)).every(value => value === "1007350"));
    await assert.rejects(placeWingoBet(alice, { ...slip, request: randomUUID() }), /locked/);
  } finally {
    stop?.();
    await db.delete(bets).where(inArray(bets.userId, ids));
    await db.delete(walletLedgerTable).where(inArray(walletLedgerTable.userId, ids));
    await db.delete(walletsTable).where(inArray(walletsTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    await pool.end();
  }
});
