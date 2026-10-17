import { strict as assert } from "node:assert";
import { test } from "node:test";

test(
  "Dragon Tiger: shared rounds, concurrent requests, settlement, leaderboard and recovery",
  {
    skip: !process.env.DRAGON_TIGER_INTEGRATION,
  },
  async () => {
    // This test changes the round clock. It must only run against its isolated database.
    assert.ok(
      new URL(process.env.DATABASE_URL!).pathname.endsWith(
        "_dragon_tiger_test",
      ),
    );
    const {
      db,
      pool,
      usersTable,
      walletLedgerTable, walletsTable,
      dragonTigerRoundsTable: rounds,
      dragonTigerBetsTable: bets,
      dragonTigerPlayersTable: players,
    } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { postEntry, getBalanceByUser } = await import("../wallet");
    const { dragonTigerTable } = await import("../dragonTiger");
    const ids = ["dt-integration-a", "dt-integration-b"];
    try {
      await db.insert(usersTable).values(
        ids.map((id, i) => ({
          id,
          email: `${id}@example.test`,
          emailNormalized: `${id}@example.test`,
          passwordHash: "test-only",
          displayName: i ? "Tiger player" : "Dragon player",
        })),
      );
      for (const userId of ids) await postEntry({ userId, type: "deposit", amount: 1000000n });
      const a = await dragonTigerTable(ids[0]);
      const b = await dragonTigerTable(ids[1]);
      assert.equal(a.round.id, b.round.id);
      assert.equal(a.player.balance, 10000);
      assert.equal(a.round.mainProfitPaisePerRupee, 98);
      assert.equal(a.round.tieProfitPaisePerRupee, 1200);
      assert.equal(a.round.dragon, undefined);
      assert.equal(a.round.winner, undefined);
      assert.equal(a.leaderboard.length, 0);
      const slip = {
        roundId: a.round.id,
        spots: { dragon: 110, tiger: 0, tie: 0 },
      };
      const [one, two] = await Promise.all([
        dragonTigerTable(ids[0], slip),
        dragonTigerTable(ids[0], slip),
      ]);
      assert.equal(one.player.balance, 9890);
      assert.equal(two.player.balance, 9890);
      assert.equal(one.leaderboard.length, 0);
      await assert.rejects(
        dragonTigerTable(ids[0], {
          ...slip,
          spots: { dragon: 200, tiger: 0, tie: 0 },
        }),
        /already confirmed/,
      );
      await assert.rejects(
        dragonTigerTable(ids[1], { ...slip, roundId: a.round.id + 1 }),
        /round changed/,
      );
      await assert.rejects(
        dragonTigerTable(ids[1], {
          ...slip,
          spots: { dragon: 5010, tiger: 0, tie: 0 },
        }),
        /5,000/,
      );
      await dragonTigerTable(ids[1], {
        ...slip,
        spots: { dragon: 0, tiger: 200, tie: 0 },
      });
      // Close betting without revealing anything.
      await db
        .update(rounds)
        .set({
          closesAt: new Date(Date.now() - 2000),
          revealsAt: new Date(Date.now() + 10000),
        })
        .where(eq(rounds.id, a.round.id));
      const dealing = await dragonTigerTable(ids[0]);
      assert.equal(dealing.round.phase, "dealing");
      assert.equal(dealing.round.dragon, undefined);
      // A Dragon win: settle concurrently, then request repeatedly to prove idempotence.
      await db
        .update(rounds)
        .set({
          dragon: 12,
          tiger: 0,
          revealsAt: new Date(Date.now() - 1000),
          endsAt: new Date(Date.now() + 10000),
        })
        .where(eq(rounds.id, a.round.id));
      const [won, lost] = await Promise.all([
        dragonTigerTable(ids[0]),
        dragonTigerTable(ids[1]),
      ]);
      assert.equal(won.round.winner, "dragon");
      assert.equal(won.player.balance, 10107.8);
      assert.equal(won.myBet?.payout, 217.8);
      assert.equal((await getBalanceByUser(ids[0])).balance, 1010780n);
      assert.equal(lost.player.balance, 9800);
      assert.equal(won.player.net, 107.8);
      assert.equal(won.leaderboard[0].net, 107.8);
      assert.equal(won.leaderboard[0].userId, ids[0]);
      assert.equal(won.player.rank, 1);
      assert.equal(lost.player.rank, 2);
      assert.equal((await dragonTigerTable(ids[0])).player.balance, 10107.8);
      assert.equal((await dragonTigerTable(ids[0])).player.played, 1);
      // Expiry creates a fresh shared round, retaining balance, ranking and last result.
      await db
        .update(rounds)
        .set({ endsAt: new Date(Date.now() - 1) })
        .where(eq(rounds.id, a.round.id));
      const next = await dragonTigerTable(ids[0]);
      assert.ok(next.round.id > a.round.id);
      assert.equal(next.myBet, null);
      assert.equal(next.lastResult?.payout, 217.8);
      const tieSlip = {
        roundId: next.round.id,
        spots: { dragon: 100, tiger: 50, tie: 10 },
      };
      await dragonTigerTable(ids[0], tieSlip);
      // Simulate restart after the entire round passed, with an unsettled bet persisted.
      await db
        .update(rounds)
        .set({
          dragon: 0,
          tiger: 13,
          closesAt: new Date(Date.now() - 3000),
          revealsAt: new Date(Date.now() - 2000),
          endsAt: new Date(Date.now() - 1000),
        })
        .where(eq(rounds.id, next.round.id));
      const recovered = await dragonTigerTable(ids[0]);
      assert.equal(recovered.player.balance, 10152.8);
      assert.equal(recovered.lastResult?.payout, 205);
      assert.equal(recovered.player.net, 152.8);
      assert.equal(recovered.player.played, 2);
      assert.equal(recovered.history[0].winner, "tie");
      assert.equal((await dragonTigerTable(ids[0])).player.balance, 10152.8);
      // Late bets cannot enter a closed round; insufficient chips cannot be spent.
      await db
        .update(rounds)
        .set({ closesAt: new Date(Date.now() - 1) })
        .where(eq(rounds.id, recovered.round.id));
      await assert.rejects(
        dragonTigerTable(ids[1], { ...slip, roundId: recovered.round.id }),
        /Betting is closed/,
      );
      await db
        .update(rounds)
        .set({ closesAt: new Date(Date.now() + 10000) })
        .where(eq(rounds.id, recovered.round.id));
      await postEntry({ userId: ids[1], type: "adjustment", amount: -980000n });
      await assert.rejects(
        dragonTigerTable(ids[1], { ...slip, roundId: recovered.round.id }),
        /enough wallet balance/,
      );
      // A second account overtakes; both clients see the same new leader.
      await postEntry({ userId: ids[1], type: "deposit", amount: 1000000n });
      await dragonTigerTable(ids[1], {
        roundId: recovered.round.id,
        spots: { dragon: 0, tiger: 0, tie: 100 },
      });
      await db
        .update(rounds)
        .set({
          dragon: 0,
          tiger: 13,
          closesAt: new Date(Date.now() - 2000),
          revealsAt: new Date(Date.now() - 1000),
        })
        .where(eq(rounds.id, recovered.round.id));
      const leader = await dragonTigerTable(ids[1]);
      assert.equal(leader.myBet?.payout, 1300);
      assert.equal((await getBalanceByUser(ids[1])).balance, 1120000n);
      assert.equal(leader.leaderboard[0].userId, ids[1]);
      assert.equal(
        (await dragonTigerTable(ids[0])).leaderboard[0].userId,
        ids[1],
      );
    } finally {
      await db.delete(bets);
      await db.delete(rounds);
      await db.delete(players);
      for (const id of ids) {
        await db.delete(walletLedgerTable).where(eq(walletLedgerTable.userId, id));
        await db.delete(walletsTable).where(eq(walletsTable.userId, id));
        await db.delete(usersTable).where(eq(usersTable.id, id));
      }
      await pool.end();
    }
  },
);
