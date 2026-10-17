import { strict as assert } from "node:assert";
import { test } from "node:test";

test("one wallet: cross-game concurrency, Dragon Tiger settlement, authoritative Rummy and retry safety", { skip: !process.env.SHARED_WALLET_INTEGRATION }, async () => {
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_shared_wallet_test"));
  const { db, pool, usersTable, walletsTable, walletLedgerTable, dragonTigerRoundsTable: rounds,
    dragonTigerBetsTable: bets, dragonTigerPlayersTable: players, rummySessionsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
    const { getBalanceByUser, getAllScopeBalances, postEntry, ensureDemoAllScopesFunded } = await import("../wallet");
  const { dragonTigerTable, startDragonTigerEngine } = await import("../dragonTiger");
  const { rummyTable, startRummyEngine } = await import("../rummy");
  const stopEngines: (() => void)[] = [];
  const waitFor = async (predicate: () => Promise<boolean>) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail("Background engine did not advance the table");
  };
  const id = `shared-test-${Date.now()}`;
  try {
    await db.insert(usersTable).values({ id, email: `${id}@example.test`, emailNormalized: `${id}@example.test`, passwordHash: "test", displayName: "Shared test" });
    await Promise.all([ensureDemoAllScopesFunded(id), ensureDemoAllScopesFunded(id)]);
    assert.equal((await getBalanceByUser(id)).balance, 1000000n);
    const ids = await Promise.all(["lunar", "mines", "dice", "roulette", "lucky-7", "dragon-tiger", "rummy", "horse-racing"].map(async scope =>
      (await getBalanceByUser(id, scope as "lunar")).walletId));
    assert.equal(new Set(ids).size, 1);
    assert.equal((await db.select().from(walletsTable).where(eq(walletsTable.userId, id))).length, 1);
    const spent = await Promise.allSettled(["dice", "mines"].map(scope => postEntry({ userId: id, scope: scope as "dice", type: "bet", amount: -700000n })));
    assert.equal(spent.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(spent.filter(r => r.status === "rejected").length, 1);
    assert.equal((await getBalanceByUser(id, "dragon-tiger")).balance, 300000n);
    await postEntry({ userId: id, scope: "roulette", type: "refund", amount: 700000n });
    assert.ok(Object.values(await getAllScopeBalances(id)).every(v => v === "1000000"));
    let dt = await dragonTigerTable(id);
    const bet = { roundId: dt.round.id, spots: { dragon: 100, tiger: 0, tie: 0 } };
    await Promise.all([dragonTigerTable(id, bet), dragonTigerTable(id, bet)]);
    assert.equal((await getBalanceByUser(id, "dice")).balance, 990000n);
    await db.update(rounds).set({ dragon: 12, tiger: 0, closesAt: new Date(Date.now() - 2000), revealsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 10000) }).where(eq(rounds.id, dt.round.id));
    stopEngines.push(startDragonTigerEngine());
    await waitFor(async () => (await getBalanceByUser(id)).balance === 1009800n);
    dt = await dragonTigerTable(id);
    assert.equal(dt.player.balance, 10098);
    await dragonTigerTable(id);
    assert.equal((await getBalanceByUser(id, "lucky-7")).balance, 1009800n);

    const ready = await rummyTable(id, "Shared test");
    const started = await rummyTable(id, "Shared test", { version: ready.version, action: { type: "start", stake: 100 } });
    assert.equal(started.table.balance, 9998);
    assert.equal((await dragonTigerTable(id)).player.balance, 9998);
    assert.ok(started.table.stock.every(card => card.rank === 0));
    assert.ok(started.table.players.slice(1).every(player => player.hand.every(card => card.rank === 0)));
    await assert.rejects(rummyTable(id, "Shared test", { version: ready.version, action: { type: "start", stake: 100 } }), /Table updated/);
    assert.equal((await getBalanceByUser(id)).balance, 999800n);
    await db.update(rummySessionsTable).set({ deadline: Date.now() - 1 }).where(eq(rummySessionsTable.userId, id));
    stopEngines.push(startRummyEngine());
    await waitFor(async () => {
      const [saved] = await db.select().from(rummySessionsTable).where(eq(rummySessionsTable.userId, id));
      return (saved.state as import("@workspace/api-zod/rummy-session").RummySession).table.phase === "playing";
    });
    const [row] = await db.select().from(rummySessionsTable).where(eq(rummySessionsTable.userId, id));
    const state = row.state as import("@workspace/api-zod/rummy-session").RummySession;
    state.table.phase = "playing"; state.table.current = 0; state.table.step = "discard"; state.table.wild = 13;
    state.table.players[0].hand = "H3 H4 H5 S7 S8 S9 D11 C11 H11 C1 C2 C3 C4 D9".split(" ").map(token => ({
      id: `0-${token[0]}-${token.slice(1)}`, suit: token[0] as "H", rank: Number(token.slice(1)),
    }));
    await db.update(rummySessionsTable).set({ state, deadline: Date.now() + 20000 }).where(eq(rummySessionsTable.userId, id));
    const won = await rummyTable(id, "Shared test", { version: row.version, action: { type: "discard", id: "0-D-9", declare: true } });
    assert.equal(won.table.result?.winner, 0);
    assert.equal(won.table.result?.payout, 400);
    assert.equal((await getBalanceByUser(id, "mines")).balance, 1039800n);
    await rummyTable(id, "Shared test");
    assert.equal((await getBalanceByUser(id)).balance, 1039800n);
  } finally {
    stopEngines.forEach(stop => stop());
    await db.delete(rummySessionsTable).where(eq(rummySessionsTable.userId, id));
    await db.delete(bets).where(eq(bets.userId, id));
    await db.delete(players).where(eq(players.userId, id));
    await db.delete(walletLedgerTable).where(eq(walletLedgerTable.userId, id));
    await db.delete(walletsTable).where(eq(walletsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
    await pool.end();
  }
});
