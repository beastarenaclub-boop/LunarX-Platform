import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";

test("Chicken Road timer: fixed deadlines, offline settlement, retries, races and legacy recovery", { skip: !process.env.CHICKEN_ROAD_INTEGRATION }, async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /chicken_road_test$/);
  const { db, pool, usersTable, gameConfigTable, betsTable, walletsTable, walletLedgerTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const { startChicken, moveChicken, chickenState, getChickenRound, chickenConfig, sweepChickenTimeouts } = await import("../chickenRoad");
  const { CHICKEN_ROUND_DURATION_MS } = await import("@workspace/api-zod/chicken-road-game");
  const { getBalanceByUser, postEntry } = await import("../wallet");
  const userId = randomUUID();
  const input = () => ({ requestId: randomUUID(), difficulty: "easy" as const, stakeAmount: "10000", clientSeed: "timer-test-client" });
  async function updateMetadata(id: string, changes: Record<string, unknown>) {
    const [bet] = await db.select().from(betsTable).where(eq(betsTable.id, id));
    await db.update(betsTable).set({ metadata: { ...bet.metadata as object, ...changes } }).where(eq(betsTable.id, id));
  }
  const expire = (id: string) => updateMetadata(id, { expiresAt: new Date(Date.now() - 1).toISOString() });
  async function credits(id: string) {
    return (await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.refId, id))).filter(e => e.type === "win");
  }
  try {
    await db.insert(gameConfigTable).values({ gameCode: "chicken-road", enabled: true, minStakePaise: 100n, maxStakePaise: 1000000n }).onConflictDoNothing();
    await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test`, emailNormalized: `${userId}@example.test`, passwordHash: "test" });
    await postEntry({ userId, type: "adjustment", amount: 100000n });
    assert.equal((await chickenConfig()).roundDurationMs, 60000);

    const firstInput = input();
    const started = await startChicken(userId, firstInput);
    const initialRemaining = Date.parse(started.expiresAt!) - started.serverTime!;
    assert(initialRemaining <= CHICKEN_ROUND_DURATION_MS && initialRemaining > CHICKEN_ROUND_DURATION_MS - 3000);
    assert.equal(started.serverSeed, null);
    const retry = await startChicken(userId, firstInput);
    assert.equal(retry.expiresAt, started.expiresAt);
    assert.equal((await chickenState(userId)).round?.expiresAt, started.expiresAt);
    await sweepChickenTimeouts();
    assert.equal((await getChickenRound(userId, started.id)).status, "active");
    await assert.rejects(moveChicken(userId, started.id, "cashout", 0), /Cross one lane/);

    // Expiry before a first move returns the exact stake, including concurrent late requests.
    await expire(started.id);
    const results = await Promise.all([
      moveChicken(userId, started.id, "step", 0),
      moveChicken(userId, started.id, "cashout", 0),
      getChickenRound(userId, started.id),
      getChickenRound(userId, started.id),
    ]);
    for (const result of results) {
      assert.equal(result.status, "cashed_out");
      assert.equal(result.endReason, "timeout");
      assert.equal(result.step, 0);
      assert.equal(result.attemptedStep, 0);
      assert.equal(result.payoutAmount, "10000");
      assert(result.serverSeed);
    }
    assert.equal((await credits(started.id)).length, 1);
    assert.equal((await getBalanceByUser(userId)).balance, 100000n);
    assert.equal((await startChicken(userId, firstInput)).endReason, "timeout");

    // A guaranteed historical round gives a deterministic safe lane without changing current odds.
    const played = await startChicken(userId, input());
    await updateMetadata(played.id, { version: 2 });
    const safe = await moveChicken(userId, played.id, "step", 0);
    assert.equal(safe.expiresAt, played.expiresAt, "Go must not restart the timer");
    await expire(played.id);
    // No client poll: the worker alone must pay the current lane, once.
    await Promise.all([sweepChickenTimeouts(), sweepChickenTimeouts()]);
    const [settled] = await db.select().from(betsTable).where(eq(betsTable.id, played.id));
    assert.equal(settled.status, "cashed_out");
    assert.equal(settled.payoutAmount, 10100n);
    assert.equal((await credits(played.id)).length, 1);
    assert.equal((await getBalanceByUser(userId)).balance, 100100n);
    const late = await moveChicken(userId, played.id, "step", 0);
    assert.equal(late.step, 1, "stale/late Go cannot advance or credit twice");

    const recovered = await startChicken(userId, input());
    await expire(recovered.id);
    assert.equal((await chickenState(userId)).round, null, "state recovery settles overdue rounds");
    assert.equal((await getBalanceByUser(userId)).balance, 100100n);
    const abandoned = await startChicken(userId, input());
    await expire(abandoned.id);
    const next = await startChicken(userId, input());
    assert.notEqual(next.id, abandoned.id, "an expired round must not block a new bet");
    assert.equal((await credits(abandoned.id)).length, 1);

    // Old records get one full grace window; recovery cannot continually extend it.
    await updateMetadata(next.id, { expiresAt: null });
    const beforeGrace = Date.now();
    await sweepChickenTimeouts();
    const grace = await getChickenRound(userId, next.id);
    assert.equal(grace.status, "active");
    assert(Date.parse(grace.expiresAt!) >= beforeGrace + CHICKEN_ROUND_DURATION_MS);
    assert.equal((await getChickenRound(userId, next.id)).expiresAt, grace.expiresAt);
    await expire(next.id);
    await sweepChickenTimeouts();
    assert.equal((await getBalanceByUser(userId)).balance, 100100n);
    assert.equal((await chickenState(userId)).round, null);
  } finally {
    await db.delete(walletLedgerTable).where(eq(walletLedgerTable.userId, userId));
    await db.delete(betsTable).where(eq(betsTable.userId, userId));
    await db.delete(walletsTable).where(eq(walletsTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
  }
});
