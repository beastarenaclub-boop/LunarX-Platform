import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";

test(
  "Crazy Time: authenticated API, one debit, all payouts, verification and restart refunds",
  { skip: !process.env.CRAZY_TIME_INTEGRATION },
  async () => {
    assert.match(
      new URL(process.env.DATABASE_URL!).pathname,
      /crazy_time_test/,
    );
    const {
      db,
      pool,
      usersTable,
      sessionsTable,
      betsTable,
      gameConfigTable,
      tableRoundsTable,
      tableRoundBetsTable,
      walletLedgerTable,
      walletsTable,
    } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const {
      createTableRound,
      placeTableBets,
      revealTableRound,
      settleTableRound,
      settlePendingSlips,
      getTableRoundSnapshot,
      recoverTableRound,
    } = await import("../tableRounds");
    const { getBalanceByUser, postEntry } = await import("../wallet");
    const { placeBet, cashOutBet, settleLoss } = await import("../bets");
    const { createSession } = await import("../auth");
    const { deriveCrazyTimeOutcome, settleCrazyTimeBets } =
      await import("../crazyTimeMath");
    const { sha256Hex } = await import("../rtp");
    const { CRAZY_TIME_TYPES } =
      await import("@workspace/api-zod/crazy-time-game");
    const { default: app } = await import("../../app");
    const id = `crazy-integration-${Date.now()}`;
    const roundIds: string[] = [];
    const [oldConfig] = await db
      .select()
      .from(gameConfigTable)
      .where(eq(gameConfigTable.gameCode, "crazy-time"));
    if (!oldConfig)
      await db
        .insert(gameConfigTable)
        .values({
          gameCode: "crazy-time",
          enabled: true,
          minStakePaise: 100n,
          maxStakePaise: 100000000n,
          maxMultiplier: 5001,
          settlementMode: "house_edge",
          bettingWindowMs: 20000,
          revealDurationMs: 5000,
          settleDurationMs: 5000,
        });
    await db
      .insert(usersTable)
      .values({
        id,
        email: `${id}@example.test`,
        emailNormalized: `${id}@example.test`,
        displayName: "Crazy test",
        passwordHash: "test",
      });
    const session = await createSession(id, null, "test");
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = {
      Cookie: `sid=${session.id}`,
      "Content-Type": "application/json",
    };
    const post = (body: unknown) =>
      fetch(`${origin}/api/crazy-time/bet`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    try {
      assert.equal((await fetch(`${origin}/api/crazy-time/round`)).status, 401);
      await postEntry({
        userId: id,
        type: "adjustment",
        amount: 1000000n,
        memo: "Isolated Crazy Time test funds",
      });
      let expectedBalance = 1000000n;
      await assert.rejects(
        () =>
          placeBet({ userId: id, gameCode: "crazy-time", stakeAmount: 100n }),
        /current table round/,
      );
      for (const winner of CRAZY_TIME_TYPES) {
        let round = await createTableRound("crazy-time");
        roundIds.push(round.id);
        let seed = "";
        for (let n = 0; ; n++) {
          seed = `crazy-test-${n}`;
          if (
            deriveCrazyTimeOutcome(seed, round.clientSeed, round.nonce)
              .winner === winner
          )
            break;
        }
        const hash = sha256Hex(seed);
        await db
          .update(tableRoundsTable)
          .set({ serverSeed: seed, serverSeedHash: hash })
          .where(eq(tableRoundsTable.id, round.id));
        round = { ...round, serverSeed: seed, serverSeedHash: hash };
        const hidden = await getTableRoundSnapshot("crazy-time", id);
        assert.equal(hidden?.outcome, null);
        assert.equal(hidden?.serverSeed, null);
        assert.equal(
          (
            await fetch(`${origin}/api/crazy-time/${round.id}/verify`, {
              headers,
            })
          ).status,
          400,
        );
        const input = {
          roundId: round.id,
          bets: CRAZY_TIME_TYPES.map((type) => ({
            type,
            amountPaise: "101",
            ...(type === "cash-hunt"
              ? { choice: 107 }
              : type === "crazy-time"
                ? { choice: 2 }
                : {}),
          })),
        };
        const responses = await Promise.all(
          Array.from({ length: winner === "1" ? 12 : 2 }, () => post(input)),
        );
        for (const response of responses)
          assert.equal(response.status, 200, await response.clone().text());
        const receipts = (await Promise.all(
          responses.map((r) => r.json()),
        )) as { slipId: string }[];
        const [one, two] = receipts;
        assert.equal(
          new Set(receipts.map((r) => r.slipId)).size,
          1,
          "a concurrent request burst must finish without deadlock or duplicate slips",
        );
        assert.equal(
          one.slipId,
          two.slipId,
          "retry cannot create a second slip",
        );
        expectedBalance -= 808n;
        assert.equal((await getBalanceByUser(id)).balance, expectedBalance);
        if (winner === "1") assert.equal(
          (await post({ ...input, bets: [{ type: "1", amountPaise: "200" }] })).status,
          400,
        );
        const [slip] = await db
          .select()
          .from(tableRoundBetsTable)
          .where(eq(tableRoundBetsTable.id, one.slipId));
        await assert.rejects(
          () => cashOutBet({ betId: slip.betId, userId: id, multiplier: 5001 }),
          /settle automatically/,
        );
        await assert.rejects(
          () => settleLoss(slip.betId, id),
          /settle automatically/,
        );
        const closedAt = new Date(Date.now() - 1);
        await db
          .update(tableRoundsTable)
          .set({ bettingEndsAt: closedAt })
          .where(eq(tableRoundsTable.id, round.id));
        round = await revealTableRound({ ...round, bettingEndsAt: closedAt });
        await assert.rejects(
          () =>
            placeTableBets({
              userId: id,
              gameCode: "crazy-time",
              roundId: round.id,
              bets: input.bets,
            }),
          /BETTING_CLOSED/,
        );
        const result = deriveCrazyTimeOutcome(
          seed,
          round.clientSeed,
          round.nonce,
        );
        assert.deepEqual(round.outcome, result);
        const expected = settleCrazyTimeBets(
          input.bets.map((b) => ({ ...b, amountPaise: BigInt(b.amountPaise) })),
          result,
        ).totalPayout;
        const settled = await settleTableRound(round);
        expectedBalance += expected;
        assert.equal(
          (await getBalanceByUser(id)).balance,
          expectedBalance,
          `exact ${winner} payout`,
        );
        await settlePendingSlips(settled);
        assert.equal(
          (await getBalanceByUser(id)).balance,
          expectedBalance,
          "repeated settlement cannot double credit",
        );
        // Simulate restart after wallet credit but before slip receipt is persisted.
        await db
          .update(tableRoundBetsTable)
          .set({ status: "pending", payoutAmount: 0n, auditRoundId: null })
          .where(eq(tableRoundBetsTable.id, slip.id));
        await settlePendingSlips(settled);
        assert.equal((await getBalanceByUser(id)).balance, expectedBalance);
        const [recovered] = await db
          .select()
          .from(tableRoundBetsTable)
          .where(eq(tableRoundBetsTable.id, slip.id));
        assert.equal(recovered.payoutAmount, expected);
        const verifyResponse = await fetch(
          `${origin}/api/crazy-time/${round.id}/verify`,
          { headers },
        );
        assert.equal(verifyResponse.status, 200);
        const verified = (await verifyResponse.json()) as {
          verified: boolean;
          slips: { payoutMatch: boolean }[];
        };
        assert.equal(verified.verified, true);
        assert.equal(verified.slips[0].payoutMatch, true);
        await db
          .update(tableRoundsTable)
          .set({ phase: "settled", settledAt: new Date() })
          .where(eq(tableRoundsTable.id, round.id));
      }
      const interrupted = await createTableRound("crazy-time");
      roundIds.push(interrupted.id);
      assert.equal(
        (
          await post({
            roundId: interrupted.id,
            bets: [{ type: "cash-hunt", amountPaise: "100", choice: 108 }],
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await post({
            roundId: interrupted.id,
            bets: [{ type: "1", amountPaise: "9999999999999" }],
          })
        ).status,
        400,
      );
      await placeTableBets({
        gameCode: "crazy-time",
        roundId: interrupted.id,
        userId: id,
        bets: [{ type: "1", amountPaise: "100" }],
      });
      await recoverTableRound(interrupted);
      assert.equal(
        (await getBalanceByUser(id)).balance,
        expectedBalance,
        "interrupted unopened wheel refunds the stake",
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      for (const roundId of roundIds) {
        await db
          .delete(tableRoundBetsTable)
          .where(eq(tableRoundBetsTable.roundId, roundId));
        await db
          .delete(tableRoundsTable)
          .where(eq(tableRoundsTable.id, roundId));
      }
      await db
        .delete(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, id));
      await db.delete(walletsTable).where(eq(walletsTable.userId, id));
      await db.delete(betsTable).where(eq(betsTable.userId, id));
      await db.delete(sessionsTable).where(eq(sessionsTable.userId, id));
      await db.delete(usersTable).where(eq(usersTable.id, id));
      if (!oldConfig)
        await db
          .delete(gameConfigTable)
          .where(eq(gameConfigTable.gameCode, "crazy-time"));
      await pool.end();
    }
  },
);
