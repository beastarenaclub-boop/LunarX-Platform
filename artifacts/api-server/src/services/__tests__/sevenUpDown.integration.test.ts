import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { sevenPayout, type CollectionOptions } from "@workspace/api-zod/instant-collection";

test("7 Up 7 Down: atomic multi-spot payout, concurrent replay, changed-slip rejection and insufficient funds", { skip: !process.env.SEVEN_UP_DOWN_INTEGRATION }, async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/seven_up_down_test_/);
  const { db, pool, usersTable, gameConfigTable, betsTable, walletLedgerTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const { placeInstant, instantState } = await import("../instantCollection");
  const { postEntry, getBalanceByUser } = await import("../wallet");
  const userId = `seven-${randomUUID()}`;
  try {
    await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test`, emailNormalized: `${userId}@example.test`, passwordHash: "test-only" });
    await db.insert(gameConfigTable).values({ gameCode: "7up7down", enabled: true, houseEdge: .03, minStakePaise: 100n, maxStakePaise: 1000000n, maxMultiplier: 1000 }).onConflictDoUpdate({ target: gameConfigTable.gameCode, set: { enabled: true, houseEdge: .03, minStakePaise: 100n, maxStakePaise: 1000000n, maxMultiplier: 1000 } });
    await postEntry({ userId, type: "deposit", amount: 100000n });
    const options: CollectionOptions = { difficulty: "easy", mines: 3, choice: "up", bets: [{ spot: "up", amount: "101" }, { spot: "8", amount: "101" }, { spot: "down", amount: "101" }, { spot: "seven", amount: "101" }] };
    const input = { requestId: randomUUID(), stakeAmount: "404", clientSeed: "seven-integration-client", options };
    const [first, replay] = await Promise.all([placeInstant(userId, "7up7down", input), placeInstant(userId, "7up7down", input)]);
    assert.equal(first.id, replay.id);
    const expected = sevenPayout(options.bets!, first.outcome, .97);
    assert.equal(first.payoutAmount, String(expected));
    assert.equal(first.cashoutAmount, String(expected));
    const after = 100000n - 404n + expected;
    assert.equal((await getBalanceByUser(userId)).balance, after);
    const reordered = { ...input, options: { ...options, bets: [...options.bets!].reverse() } };
    assert.equal((await placeInstant(userId, "7up7down", reordered)).id, first.id);
    await assert.rejects(placeInstant(userId, "7up7down", { ...input, options: { ...options, bets: [{ spot: "up", amount: "404" }] } }), /another bet/);
    await assert.rejects(placeInstant(userId, "7up7down", { ...input, requestId: randomUUID(), stakeAmount: "403" }), /total/);
    await assert.rejects(placeInstant(userId, "7up7down", { ...input, requestId: randomUUID(), stakeAmount: "200000", options: { ...options, bets: [{ spot: "up", amount: "200000" }] } }), /Insufficient/);
    assert.equal((await getBalanceByUser(userId)).balance, after);
    const saved = await db.select().from(betsTable).where(eq(betsTable.userId, userId));
    assert.equal(saved.length, 1);
    const ledger = await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.userId, userId));
    assert.equal(ledger.filter(row => row.type === "bet").length, 1);
    assert.equal(ledger.filter(row => row.type === "win").length, expected > 0n ? 1 : 0);
    const state = await instantState(userId, "7up7down");
    assert.equal(state.round, null);
    assert.equal(state.history[0].id, first.id);
    assert.equal(state.history[0].options.bets!.length, 4);
    // Older single-choice clients keep their original contract.
    const legacy = await placeInstant(userId, "7up7down", { ...input, requestId: randomUUID(), stakeAmount: "100", options: { difficulty: "easy", mines: 3, choice: "seven" } });
    assert.equal(legacy.outcome.length, 2);
    assert.equal(legacy.options.bets, undefined);
  } finally { await pool.end(); }
});
