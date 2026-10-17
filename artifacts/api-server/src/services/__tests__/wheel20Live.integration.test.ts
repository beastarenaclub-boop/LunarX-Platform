import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  W20_GAME,
  W20_TIMING,
  w20Payout,
  type W20Bet,
  type W20Outcome,
} from "@workspace/api-zod/wheel20-live";

test(
  "Wheel 2.0 Live wallet admission, hidden results, exact settlement and restart recovery",
  { skip: !process.env.W20_LIVE_INTEGRATION },
  async () => {
    assert.match(
      new URL(process.env.DATABASE_URL!).pathname,
      /^\/w20_live_test_/,
    );
    const {
      db,
      pool,
      usersTable,
      gameConfigTable,
      tableRoundsTable,
      tableRoundBetsTable,
      walletLedgerTable,
      betsTable,
    } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { placeW20Live, settleW20Live, w20History, verifyW20Live } =
      await import("../wheel20Live");
    const {
      createTableRound,
      revealTableRound,
      settleTableRound,
      finishTableRound,
      getTableRoundSnapshot,
      recoverTableRound,
    } = await import("../tableRounds");
    const { placeBet, cashOutBet, settleLoss } = await import("../bets");
    const { postEntry, getBalanceByUser } = await import("../wallet");
    const { invalidateConfigCache } = await import("../rtp");
    const userId = `l7-${randomUUID()}`,
      poorId = `l7-poor-${randomUUID()}`;
    try {
      for (const id of [userId, poorId])
        await db.insert(usersTable).values({
          id,
          email: `${id}@example.test`,
          emailNormalized: `${id}@example.test`,
          passwordHash: "test-only",
        });
      await db.insert(gameConfigTable).values({
        gameCode: W20_GAME,
        enabled: true,
        houseEdge: 1 / 13,
        minStakePaise: 5000n,
        maxStakePaise: 20000000n,
        maxMultiplier: 321,
        ...W20_TIMING,
      });
      await postEntry({ userId, type: "deposit", amount: 100000n });
      const bets: W20Bet[] = [
        { spot: "20", amountPaise: "5001" },
        { spot: "2", amountPaise: "5001" },
        { spot: "40", amountPaise: "5001" },
        { spot: "1", amountPaise: "5001" },
        { spot: "5", amountPaise: "5001" },
        { spot: "8", amountPaise: "5001" },
        { spot: "10", amountPaise: "5001" },
        { spot: "15", amountPaise: "5001" },
        { spot: "30", amountPaise: "5001" },
      ];
      const first = await createTableRound(W20_GAME);
      const initial = await getTableRoundSnapshot(W20_GAME, userId);
      assert.equal(initial?.outcome, null);
      assert.equal(initial?.serverSeed, null);
      await assert.rejects(verifyW20Live(first.id), /after settlement/);
      const [a, b] = await Promise.all([
        placeW20Live(userId, first.id, bets),
        placeW20Live(userId, first.id, [...bets].reverse()),
      ]);
      assert.equal(a.slipId, b.slipId);
      assert.equal((await getBalanceByUser(userId)).balance, 54991n);
      await assert.rejects(
        placeW20Live(userId, first.id, [{ spot: "20", amountPaise: "6000" }]),
        /already confirmed/,
      );
      await assert.rejects(
        placeW20Live(poorId, first.id, bets),
        /Insufficient/,
      );
      await assert.rejects(
        placeW20Live(poorId, first.id, [{ spot: "1", amountPaise: "100" }]),
        /limits/,
      );
      assert.equal(
        (await getTableRoundSnapshot(W20_GAME, poorId))?.myBets.length,
        0,
      );
      const [slip] = await db
        .select()
        .from(tableRoundBetsTable)
        .where(eq(tableRoundBetsTable.id, a.slipId));
      await assert.rejects(
        placeBet({ userId, gameCode: W20_GAME, stakeAmount: 5000n }),
        /table/,
      );
      await assert.rejects(
        cashOutBet({ betId: slip.betId, userId, multiplier: 12 }),
        /game server/,
      );
      await assert.rejects(settleLoss(slip.betId, userId), /game server/);
      const revealed = await revealTableRound(first);
      assert.equal(
        (await getTableRoundSnapshot(W20_GAME, userId))?.outcome,
        null,
        "target remains private before the betting deadline even if reveal is forced early",
      );
      assert.equal((await w20History(userId))[0].outcome, null);
      await assert.rejects(placeW20Live(poorId, first.id, bets), /closed/);
      // The target pocket is disclosed after bets lock. It never reopens admission.
      await db
        .update(tableRoundsTable)
        .set({
          bettingEndsAt: new Date(Date.now() - 2000),
          revealEndsAt: new Date(Date.now() + 1200),
        })
        .where(eq(tableRoundsTable.id, first.id));
      assert.deepEqual(
        (await getTableRoundSnapshot(W20_GAME, userId))?.outcome,
        revealed.outcome,
        "the authoritative target is available during the spin",
      );
      await assert.rejects(placeW20Live(poorId, first.id, bets), /closed/);
      const expected = w20Payout(bets, revealed.outcome as W20Outcome);
      await Promise.all([settleW20Live(revealed), settleW20Live(revealed)]);
      await finishTableRound(await settleTableRound(revealed));
      assert.equal((await getBalanceByUser(userId)).balance, 54991n + expected);
      assert.equal(
        (await w20History(userId))[0].payoutAmount,
        String(expected),
      );
      assert.equal((await verifyW20Live(first.id)).verified, true);
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, userId));
      assert.equal(ledger.filter((e) => e.type === "bet").length, 1);
      assert.equal(ledger.filter((e) => e.type === "win").length, 1);
      assert.equal(
        (await placeW20Live(userId, first.id, bets)).slipId,
        a.slipId,
        "lost-response retry after settlement never charges again",
      );
      const interrupted = await createTableRound(W20_GAME);
      await placeW20Live(userId, interrupted.id, bets);
      await recoverTableRound(interrupted);
      await recoverTableRound(interrupted);
      assert.equal(
        (await getBalanceByUser(userId)).balance,
        54991n + expected,
        "unrevealed restart refunds exactly once",
      );
      const expired = await createTableRound(W20_GAME);
      await db
        .update(tableRoundsTable)
        .set({ bettingEndsAt: new Date(Date.now() - 1) })
        .where(eq(tableRoundsTable.id, expired.id));
      await assert.rejects(placeW20Live(poorId, expired.id, bets), /closed/);
      const paused = await createTableRound(W20_GAME);
      await db
        .update(gameConfigTable)
        .set({ enabled: false })
        .where(eq(gameConfigTable.gameCode, W20_GAME));
      invalidateConfigCache(W20_GAME);
      await assert.rejects(placeW20Live(userId, paused.id, bets), /paused/);
      assert.equal(
        (await db.select().from(betsTable).where(eq(betsTable.userId, poorId)))
          .length,
        0,
        "rejections roll back all bet rows",
      );
    } finally {
      await pool.end();
    }
  },
);
