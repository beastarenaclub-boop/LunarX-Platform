import assert from "node:assert/strict";
import { test } from "node:test";

test("Mines and Plinko: wallet settlement, long-history recovery and seed verification", { skip: !process.env.INSTANT_GAMES_INTEGRATION }, async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/instant_games_test_/);
  const { db, pool, usersTable, gameConfigTable, betsTable, minesRoundsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const mines = await import("../mines");
  const plinko = await import("../plinko");
  const { getBalanceByUser, postEntry } = await import("../wallet");
  const { deriveMinesOutcome, derivePlinkoOutcome, sha256Hex } = await import("../rtp");
  const userId = `instant-${Date.now()}`;
  try {
    await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test`, emailNormalized: `${userId}@example.test`, passwordHash: "test-only" });
    await db.insert(gameConfigTable).values(["mines", "plinko"].map(gameCode => ({ gameCode, houseEdge: .05, enabled: true }))).onConflictDoNothing();
    await postEntry({ userId, type: "deposit", amount: 1000000n });
    // This reproduces the old /active bug: an active game after 50 past rounds.
    for (let i = 0; i < 55; i++) {
      const [bet] = await db.insert(betsTable).values({ userId, gameCode: "mines", stakeAmount: 10000n, status: "lost" }).returning();
      await db.insert(minesRoundsTable).values({ userId, betId: bet.id, status: "busted", gridSize: 25, mineCount: 3, mineIndexes: [0, 1, 2],
        serverSeed: "historical", serverSeedHash: sha256Hex("historical"), clientSeed: "test", nonce: i, houseEdge: .05, maxMultiplier: 1000,
        createdAt: new Date(Date.now() - (60 - i) * 1000) });
    }
    const round = await mines.createRound({ userId, mineCount: 3, stakeAmount: 10000n });
    assert.equal((await getBalanceByUser(userId)).balance, 990000n);
    assert.equal((await mines.getActiveRound({ userId }))?.id, round.id);
    assert.equal(round.mineIndexes, null); assert.equal(round.serverSeed, null);
    await assert.rejects(mines.createRound({ userId, mineCount: 3, stakeAmount: 10000n }), /ACTIVE_ROUND_EXISTS/);
    const [raw] = await db.select().from(minesRoundsTable).where(eq(minesRoundsTable.id, round.id));
    const mineIndexes = raw.mineIndexes as number[];
    const safe = Array.from({ length: 25 }, (_, i) => i).find(i => !mineIndexes.includes(i))!;
    const revealed = await mines.reveal({ userId, roundId: round.id, cellIndex: safe });
    assert.equal(revealed.revealedIndexes.length, 1);
    const cash = await mines.cashout({ userId, roundId: round.id });
    assert.equal(cash.status, "cashed_out"); assert.equal(sha256Hex(cash.serverSeed!), cash.serverSeedHash);
    const replay = deriveMinesOutcome(cash.serverSeed!, cash.clientSeed, cash.nonce, { houseEdge: raw.houseEdge, maxMultiplier: raw.maxMultiplier }, { gridSize: 25, mineCount: 3 });
    assert.deepEqual(replay.mineIndexes, cash.mineIndexes);
    const afterCash = 990000n + BigInt(cash.payoutAmount!);
    assert.equal((await getBalanceByUser(userId)).balance, afterCash);
    await assert.rejects(mines.cashout({ userId, roundId: round.id }), /ROUND_NOT_ACTIVE/);
    assert.equal((await getBalanceByUser(userId)).balance, afterCash);
    const loss = await mines.createRound({ userId, mineCount: 24, stakeAmount: 10000n });
    const [rawLoss] = await db.select().from(minesRoundsTable).where(eq(minesRoundsTable.id, loss.id));
    const busted = await mines.reveal({ userId, roundId: loss.id, cellIndex: (rawLoss.mineIndexes as number[])[0] });
    assert.equal(busted.status, "busted"); assert.equal(busted.payoutAmount, "0");
    assert.equal(await mines.getActiveRound({ userId }), null);
    // Finding every gem must settle automatically, including a 24-mine board.
    const clear = await mines.createRound({ userId, mineCount: 24, stakeAmount: 10000n });
    const [rawClear] = await db.select().from(minesRoundsTable).where(eq(minesRoundsTable.id, clear.id));
    const lastSafe = Array.from({ length: 25 }, (_, i) => i).find(i => !(rawClear.mineIndexes as number[]).includes(i))!;
    assert.equal((await mines.reveal({ userId, roundId: clear.id, cellIndex: lastSafe })).status, "cashed_out");
    for (const rows of [8, 12, 16]) {
      const before = (await getBalanceByUser(userId)).balance;
      const committed = await plinko.getActiveSeed(userId);
      const drop = await plinko.dropBall({ userId, rows, risk: "high", stakeAmount: 10000n });
      assert.equal(drop.serverSeedHash, committed.serverSeedHash);
      assert.equal(drop.nonce, committed.nextNonce);
      assert.equal(drop.bucket, drop.path.filter(p => p === "R").length);
      assert.equal(drop.path.length, rows); assert.equal(drop.serverSeed, null);
      assert.equal((await getBalanceByUser(userId)).balance, before - 10000n + BigInt(drop.payoutAmount));
      assert.equal((await plinko.getRoundForVerify({ userId, roundId: drop.id })).serverSeed, null);
      await plinko.rotateActiveSeed(userId);
      const verify = await plinko.getRoundForVerify({ userId, roundId: drop.id });
      assert.equal(sha256Hex(verify.serverSeed!), drop.serverSeedHash);
      const outcome = derivePlinkoOutcome(verify.serverSeed!, drop.clientSeed, drop.nonce, { houseEdge: drop.houseEdge, maxMultiplier: drop.maxMultiplier }, { rows, risk: drop.risk });
      assert.equal(outcome.bucket, drop.bucket); assert.equal(outcome.multiplier, drop.multiplier);
    }
  } finally { await pool.end(); }
});
