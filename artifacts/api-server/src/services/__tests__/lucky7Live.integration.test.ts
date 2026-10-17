import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  L7_GAME,
  L7_TIMING,
  l7Payout,
  type L7Bet,
  type L7Card,
} from "@workspace/api-zod/lucky7-live";

test(
  "Lucky 7 Live wallet admission, hidden results, exact settlement and restart recovery",
  { skip: !process.env.L7_LIVE_INTEGRATION },
  async () => {
    assert.match(
      new URL(process.env.DATABASE_URL!).pathname,
      /^\/l7_live_test_/,
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
    const { placeL7Live, settleL7Live, l7History, verifyL7Live } =
      await import("../lucky7Live");
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
        await db
          .insert(usersTable)
          .values({
            id,
            email: `${id}@example.test`,
            emailNormalized: `${id}@example.test`,
            passwordHash: "test-only",
          });
      await db
        .insert(gameConfigTable)
        .values({
          gameCode: L7_GAME,
          enabled: true,
          houseEdge: 1 / 13,
          minStakePaise: 5000n,
          maxStakePaise: 20000000n,
          maxMultiplier: 12,
          ...L7_TIMING,
        });
      await postEntry({ userId, type: "deposit", amount: 100000n });
      const bets: L7Bet[] = [
        { spot: "up", amountPaise: "5001" },
        { spot: "down", amountPaise: "5001" },
        { spot: "seven", amountPaise: "5001" },
        { spot: "red", amountPaise: "5001" },
        { spot: "black", amountPaise: "5001" },
      ];
      const first = await createTableRound(L7_GAME);
      const initial = await getTableRoundSnapshot(L7_GAME, userId);
      assert.equal(initial?.outcome, null);
      assert.equal(initial?.serverSeed, null);
      await assert.rejects(verifyL7Live(first.id), /after settlement/);
      const [a, b] = await Promise.all([
        placeL7Live(userId, first.id, bets),
        placeL7Live(userId, first.id, [...bets].reverse()),
      ]);
      assert.equal(a.slipId, b.slipId);
      assert.equal((await getBalanceByUser(userId)).balance, 74995n);
      await assert.rejects(
        placeL7Live(userId, first.id, [{ spot: "up", amountPaise: "6000" }]),
        /already confirmed/,
      );
      await assert.rejects(placeL7Live(poorId, first.id, bets), /Insufficient/);
      await assert.rejects(
        placeL7Live(poorId, first.id, [{ spot: "red", amountPaise: "100" }]),
        /limits/,
      );
      assert.equal(
        (await getTableRoundSnapshot(L7_GAME, poorId))?.myBets.length,
        0,
      );
      const [slip] = await db
        .select()
        .from(tableRoundBetsTable)
        .where(eq(tableRoundBetsTable.id, a.slipId));
      await assert.rejects(
        placeBet({ userId, gameCode: L7_GAME, stakeAmount: 5000n }),
        /table/,
      );
      await assert.rejects(
        cashOutBet({ betId: slip.betId, userId, multiplier: 12 }),
        /game server/,
      );
      await assert.rejects(settleLoss(slip.betId, userId), /game server/);
      const revealed = await revealTableRound(first);
      assert.equal(
        (await getTableRoundSnapshot(L7_GAME, userId))?.outcome,
        null,
        "card remains private until reveal landing",
      );
      assert.equal((await l7History(userId))[0].card, null);
      await assert.rejects(placeL7Live(poorId, first.id, bets), /closed/);
      // The filmed face is disclosed only after bets lock, while the dealer
      // raises the card. A visible face must never reopen admission.
      await db.update(tableRoundsTable).set({
        bettingEndsAt: new Date(Date.now() - 2000),
        revealEndsAt: new Date(Date.now() + 1200),
      }).where(eq(tableRoundsTable.id, first.id));
      assert.deepEqual(
        (await getTableRoundSnapshot(L7_GAME, userId))?.outcome,
        revealed.outcome,
        "the authoritative face is available during the filmed turn",
      );
      await assert.rejects(placeL7Live(poorId, first.id, bets), /closed/);
      const expected = l7Payout(bets, revealed.outcome as L7Card);
      await Promise.all([settleL7Live(revealed), settleL7Live(revealed)]);
      await finishTableRound(await settleTableRound(revealed));
      assert.equal((await getBalanceByUser(userId)).balance, 74995n + expected);
      assert.equal((await l7History(userId))[0].payoutAmount, String(expected));
      assert.equal((await verifyL7Live(first.id)).verified, true);
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, userId));
      assert.equal(ledger.filter((e) => e.type === "bet").length, 1);
      assert.equal(ledger.filter((e) => e.type === "win").length, 1);
      assert.equal(
        (await placeL7Live(userId, first.id, bets)).slipId,
        a.slipId,
        "lost-response retry after settlement never charges again",
      );
      const interrupted = await createTableRound(L7_GAME);
      await placeL7Live(userId, interrupted.id, bets);
      await recoverTableRound(interrupted);
      await recoverTableRound(interrupted);
      assert.equal(
        (await getBalanceByUser(userId)).balance,
        74995n + expected,
        "unrevealed restart refunds exactly once",
      );
      const expired = await createTableRound(L7_GAME);
      await db
        .update(tableRoundsTable)
        .set({ bettingEndsAt: new Date(Date.now() - 1) })
        .where(eq(tableRoundsTable.id, expired.id));
      await assert.rejects(placeL7Live(poorId, expired.id, bets), /closed/);
      const paused = await createTableRound(L7_GAME);
      await db
        .update(gameConfigTable)
        .set({ enabled: false })
        .where(eq(gameConfigTable.gameCode, L7_GAME));
      invalidateConfigCache(L7_GAME);
      await assert.rejects(placeL7Live(userId, paused.id, bets), /paused/);
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
