import { test } from "node:test";
import assert from "node:assert/strict";

test(
  "One Day wallet integration: two windows, replay protection, rejected bets, restart settlement",
  { skip: !process.env.ONE_DAY_TEST_DATABASE_URL },
  async () => {
    const url = process.env.ONE_DAY_TEST_DATABASE_URL!;
    if (!new URL(url).pathname.endsWith("_one_day_test"))
      throw new Error("Use a dedicated database ending in _one_day_test.");
    process.env.DATABASE_URL = url;
    const {
      db,
      pool,
      usersTable,
      dragonTigerOneDayRounds: rounds,
      dragonTigerOneDayBets: bets,
      walletsTable,
      walletLedgerTable,
    } = await import("@workspace/db");
    const { eq, and } = await import("drizzle-orm");
    const { oneDayTable, startOneDayDragonTigerEngine } =
      await import("../dragonTigerOneDay");
    const { postEntry, getBalanceByUser } = await import("../wallet");
    const { commitment } = await import("../dragonTigerOneDayMath");
    const id = `od-${Date.now()}`,
      poor = `${id}-poor`;
    try {
      await db.insert(usersTable).values(
        [id, poor].map((userId) => ({
          id: userId,
          email: `${userId}@test.invalid`,
          emailNormalized: `${userId}@test.invalid`,
          passwordHash: "test-only",
        })),
      );
      await postEntry({
        userId: id,
        type: "adjustment",
        amount: 1_000_000n,
        refType: "od_test_funding",
        refId: id,
      });
      let state = await oneDayTable(id);
      const nonce = "test-secret",
        dragon = 0,
        tiger = 13;
      await db
        .update(rounds)
        .set({
          dragon,
          tiger,
          nonce,
          commitment: commitment(dragon, tiger, nonce),
          // This test controls phases explicitly, independent of machine load.
          firstClosesAt: new Date(Date.now() + 120000),
          secondOpensAt: new Date(Date.now() + 123000),
          secondClosesAt: new Date(Date.now() + 138000),
          revealsAt: new Date(Date.now() + 141000),
          endsAt: new Date(Date.now() + 148000),
        })
        .where(eq(rounds.id, state.round.id));
      state = await oneDayTable(id);
      assert.ok(!("dragon" in state.round));
      assert.ok(!("tiger" in state.round));
      assert.ok(!("nonce" in state.round));
      assert.equal(state.quotes.length, 4);
      assert.ok(state.quotes.every((q) => q.side === "match"));
      const first = {
        roundId: state.round.id,
        stage: "first" as const,
        quoteId: state.quoteId,
        selections: [{ market: "tie", amountPaise: "10000" }],
      };
      await assert.rejects(
        oneDayTable(id, {
          ...first,
          selections: [{ market: "tiger-red", amountPaise: "10000" }],
        }),
      );
      // Concurrent duplicate requests debit once, and keep one accepted slip.
      const replies = await Promise.all([
        oneDayTable(id, first),
        oneDayTable(id, first),
        oneDayTable(id, first),
      ]);
      assert.equal(replies[2].balancePaise, "990000");
      assert.equal(replies[2].slips.length, 1);
      await assert.rejects(
        oneDayTable(id, {
          ...first,
          selections: [{ market: "tiger-black", amountPaise: "10000" }],
        }),
      );
      await assert.rejects(oneDayTable(poor, first));
      assert.equal((await getBalanceByUser(poor)).balance, 0n);
      const now = Date.now();
      await db
        .update(rounds)
        .set({
          firstClosesAt: new Date(now - 4000),
          secondOpensAt: new Date(now - 1000),
          secondClosesAt: new Date(now + 120000),
          revealsAt: new Date(now + 123000),
          endsAt: new Date(now + 130000),
        })
        .where(eq(rounds.id, state.round.id));
      state = await oneDayTable(id);
      assert.equal(state.round.phase, "second");
      assert.equal(state.round.dragon, 0);
      assert.ok(!("tiger" in state.round));
      assert.ok(!("nonce" in state.round));
      const second = {
        ...first,
        stage: "second" as const,
        quoteId: state.quoteId,
        selections: [{ market: "tiger-red", amountPaise: "10000" }],
      };
      // Even a funded player cannot skip the first accepted chance.
      await postEntry({
        userId: poor,
        type: "adjustment",
        amount: 100_000n,
        refType: "od_test_funding",
        refId: poor,
      });
      assert.deepEqual((await oneDayTable(poor)).quotes, []);
      await assert.rejects(oneDayTable(poor, second), /first-chance/);
      assert.equal((await getBalanceByUser(poor)).balance, 100000n);
      await assert.rejects(
        oneDayTable(id, { ...second, quoteId: first.quoteId }),
      );
      await assert.rejects(
        oneDayTable(id, {
          ...second,
          selections: [{ market: "dragon-red", amountPaise: "10000" }],
        }),
      );
      await assert.rejects(
        oneDayTable(id, {
          ...second,
          selections: [{ market: "tiger-red", amountPaise: "500000" }],
        }),
      );
      assert.equal((await getBalanceByUser(id)).balance, 990000n);
      const secondReplies = await Promise.all([
        oneDayTable(id, second),
        oneDayTable(id, second),
        oneDayTable(id, second),
      ]);
      state = secondReplies[2];
      assert.equal(state.balancePaise, "980000");
      assert.deepEqual(
        state.slips.map((s) => s.selections[0].oddsHundredths),
        [1271, 189],
      );
      const [{ count: walletCount }] = await db
        .select({ count: walletsTable.id })
        .from(walletsTable)
        .where(eq(walletsTable.userId, id));
      assert.ok(walletCount);
      assert.equal(
        (
          await db
            .select()
            .from(walletsTable)
            .where(eq(walletsTable.userId, id))
        ).length,
        1,
      );
      const resultTime = Date.now();
      await db
        .update(rounds)
        .set({
          secondClosesAt: new Date(resultTime - 4000),
          revealsAt: new Date(resultTime - 1000),
          endsAt: new Date(resultTime + 10000),
        })
        .where(eq(rounds.id, state.round.id));
      // No table polling: the background engine must pay players who left.
      let stop = startOneDayDragonTigerEngine();
      const settlementDeadline = Date.now() + 20000;
      while (
        (await getBalanceByUser(id)).balance !== 1126000n &&
        Date.now() < settlementDeadline
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      stop();
      assert.equal((await getBalanceByUser(id)).balance, 1126000n);
      stop = startOneDayDragonTigerEngine();
      await new Promise((resolve) => setTimeout(resolve, 800));
      stop();
      assert.equal((await getBalanceByUser(id)).balance, 1126000n);
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(
          and(
            eq(walletLedgerTable.userId, id),
            eq(walletLedgerTable.refType, "dt_one_day_win"),
          ),
        );
      assert.equal(ledger.length, 2);
      state = await oneDayTable(id);
      assert.equal(state.round.tiger, 13);
      assert.equal(state.round.nonce, nonce);
      assert.deepEqual(
        state.slips.map((s) => s.payoutPaise),
        ["127100", "18900"],
      );
      await db
        .update(rounds)
        .set({ endsAt: new Date(Date.now() - 1) })
        .where(eq(rounds.id, state.round.id));
      await oneDayTable(id, first); // delayed acknowledgement retry after round rollover
      assert.equal((await getBalanceByUser(id)).balance, 1126000n);
      const debits = await db
        .select()
        .from(walletLedgerTable)
        .where(
          and(
            eq(walletLedgerTable.userId, id),
            eq(walletLedgerTable.refType, "dt_one_day_bet"),
          ),
        );
      assert.equal(debits.length, 2);
      assert.equal(
        debits.reduce((sum, row) => sum + row.amount, 0n),
        -20000n,
      );
      assert.equal(
        (await db.select().from(bets).where(eq(bets.userId, id))).length,
        2,
      );
      await assert.rejects(oneDayTable(poor, second)); // truly late new bet
    } finally {
      await pool.end();
    }
  },
);
