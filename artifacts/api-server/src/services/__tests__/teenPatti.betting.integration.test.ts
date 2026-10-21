import { strict as assert } from "node:assert";
import { after, beforeEach, test } from "node:test";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  gameConfigTable,
  tableRoundsTable,
  tableRoundBetsTable,
  betsTable,
  teenPattiRoundsTable,
  teenPattiLiveRoundsTable,
} from "@workspace/db";
import {
  createTableRound,
  getTableRoundSnapshot,
  placeTableBets,
  settlePendingSlips,
} from "../tableRounds";
import { deriveTeenPattiDeal } from "../teenPatti";
import { settleTeenPattiBets, type TeenPattiBetInput } from "../teenPattiMath";
import { cashOutBet } from "../bets";
import { postEntry, getBalanceByUser } from "../wallet";
import { invalidateConfigCache } from "../rtp";

// This suite changes clocks/config and installs a trigger. Run ONLY in a
// disposable database whose name ends in _audit, never against a live server.
const isolated =
  !!process.env.DATABASE_URL &&
  new URL(process.env.DATABASE_URL).pathname.endsWith("_audit");
const auditTest = isolated ? test : test.skip;
beforeEach(() => assert.ok(isolated, "Use a disposable *_audit database"));
after(async () => {
  await pool.end();
});

for (const gameCode of ["teen-patti", "teen-patti-live"] as const) {
  const auditTable =
    gameCode === "teen-patti" ? teenPattiRoundsTable : teenPattiLiveRoundsTable;
  async function fixture() {
    await db
      .update(tableRoundsTable)
      .set({ phase: "settled" })
      .where(eq(tableRoundsTable.gameCode, gameCode));
    const config = {
      gameCode,
      minStakePaise: 100n,
      maxStakePaise: 100000n,
      maxMultiplier: 40,
      bettingWindowMs: 60000,
      enabled: true,
    };
    await db
      .insert(gameConfigTable)
      .values(config)
      .onConflictDoUpdate({ target: gameConfigTable.gameCode, set: config });
    invalidateConfigCache(gameCode);
    const userId = nanoid();
    const email = `${userId}@example.test`;
    await db
      .insert(usersTable)
      .values({
        id: userId,
        email,
        emailNormalized: email,
        displayName: "Bet audit",
        passwordHash: "test",
      });
    await postEntry({
      userId,
      type: "adjustment",
      amount: 1000000n,
      scope: gameCode,
      memo: "isolated test",
    });
    const round = await createTableRound(gameCode);
    const outcome = deriveTeenPattiDeal(
      round.serverSeed,
      round.clientSeed,
      round.nonce,
    );
    const reveal = async () => {
      const [updated] = await db
        .update(tableRoundsTable)
        .set({
          phase: "settling",
          outcome,
          bettingEndsAt: new Date(Date.now() - 1),
        })
        .where(eq(tableRoundsTable.id, round.id))
        .returning();
      return updated;
    };
    const balance = async () =>
      (await getBalanceByUser(userId, gameCode)).balance;
    return { userId, round, outcome, reveal, balance };
  }

  auditTest(
    `${gameCode}: all five markets debit once and settle exact paise on retries`,
    async () => {
      const f = await fixture();
      const bets: TeenPattiBetInput[] = [
        "playerA",
        "playerB",
        "tie",
        "pairPlusA",
        "pairPlusB",
      ].map((type) => ({
        type: type as TeenPattiBetInput["type"],
        amountPaise: 10001n,
      }));
      const expected = settleTeenPattiBets(bets, f.outcome, 40, 2);
      const slip = await placeTableBets({
        gameCode,
        userId: f.userId,
        roundId: f.round.id,
        bets,
      });
      assert.equal(await f.balance(), 1000000n - expected.totalStake);
      const revealed = await f.reveal();
      await Promise.all([
        settlePendingSlips(revealed),
        settlePendingSlips(revealed),
      ]);
      await settlePendingSlips(revealed);
      assert.equal(
        await f.balance(),
        1000000n - expected.totalStake + expected.totalPayout,
      );
      const [receipt] = await db
        .select()
        .from(tableRoundBetsTable)
        .where(eq(tableRoundBetsTable.id, slip.slipId));
      assert.equal(receipt.status, "settled");
      assert.equal(receipt.payoutAmount, expected.totalPayout);
      assert.equal(
        (
          await db
            .select()
            .from(auditTable)
            .where(eq(auditTable.betId, slip.betId))
        ).length,
        1,
      );
      const [round] = await db
        .select()
        .from(tableRoundsTable)
        .where(eq(tableRoundsTable.id, f.round.id));
      assert.equal(round.totalPayout, expected.totalPayout);
    },
  );

  auditTest(
    `${gameCode}: invalid/duplicate/out-of-limit and stale bets never debit`,
    async () => {
      const f = await fixture();
      const place = (bets: unknown[], roundId = f.round.id) =>
        placeTableBets({ gameCode, userId: f.userId, roundId, bets });
      for (const bets of [
        [],
        [{ type: "playerA", amountPaise: 0n }],
        [{ type: "playerA", amountPaise: -1n }],
        [{ type: "unknown", amountPaise: 100n }],
        [{ type: "playerA", amountPaise: 99n }],
        [{ type: "playerA", amountPaise: 100001n }],
        [
          { type: "playerA", amountPaise: 100n },
          { type: "playerA", amountPaise: 100n },
        ],
      ]) {
        await assert.rejects(place(bets));
        assert.equal(await f.balance(), 1000000n);
      }
      await assert.rejects(
        place([{ type: "playerA", amountPaise: 100n }], "old-round"),
        /BETTING_CLOSED/,
      );
      await f.reveal();
      await assert.rejects(
        place([{ type: "playerA", amountPaise: 100n }]),
        /BETTING_CLOSED/,
      );
      assert.equal(await f.balance(), 1000000n);
    },
  );

  auditTest(
    `${gameCode}: accepted payout survives a subsequent admin cap change`,
    async () => {
      const f = await fixture();
      const bets = [{ type: f.outcome.winner, amountPaise: 10001n }];
      const expected = settleTeenPattiBets(bets, f.outcome, 40, 2).totalPayout;
      const slip = await placeTableBets({
        gameCode,
        userId: f.userId,
        roundId: f.round.id,
        bets,
      });
      await db
        .update(gameConfigTable)
        .set({ maxMultiplier: 1 })
        .where(eq(gameConfigTable.gameCode, gameCode));
      invalidateConfigCache(gameCode);
      await settlePendingSlips(await f.reveal());
      const [bet] = await db
        .select()
        .from(betsTable)
        .where(eq(betsTable.id, slip.betId));
      assert.equal(bet.payoutAmount, expected);
      assert.equal(await f.balance(), 989999n + expected);
    },
  );

  auditTest(
    `${gameCode}: recover credit-before-receipt and audit-before-receipt without double payout`,
    async () => {
      const f = await fixture();
      const bets = [{ type: f.outcome.winner, amountPaise: 10000n }];
      const expected = settleTeenPattiBets(bets, f.outcome, 40, 2).totalPayout;
      const slip = await placeTableBets({
        gameCode,
        userId: f.userId,
        roundId: f.round.id,
        bets,
      });
      const round = await f.reveal();
      await cashOutBet({
        userId: f.userId,
        betId: slip.betId,
        multiplier: Number(expected) / 10000,
        teenPattiPayoutPaise: expected,
      });
      await settlePendingSlips(round);
      let [receipt] = await db
        .select()
        .from(tableRoundBetsTable)
        .where(eq(tableRoundBetsTable.id, slip.slipId));
      assert.equal(
        receipt.payoutAmount,
        expected,
        "credit must appear on the receipt",
      );
      await db
        .update(tableRoundBetsTable)
        .set({ status: "pending", payoutAmount: 0n, auditRoundId: null })
        .where(eq(tableRoundBetsTable.id, slip.slipId));
      await settlePendingSlips(round);
      [receipt] = await db
        .select()
        .from(tableRoundBetsTable)
        .where(eq(tableRoundBetsTable.id, slip.slipId));
      assert.equal(receipt.status, "settled");
      assert.ok(receipt.auditRoundId);
      assert.equal(receipt.payoutAmount, expected);
      assert.equal(await f.balance(), 990000n + expected);
      assert.equal(
        (
          await db
            .select()
            .from(auditTable)
            .where(eq(auditTable.betId, slip.betId))
        ).length,
        1,
      );
      const [stored] = await db
        .select()
        .from(tableRoundsTable)
        .where(eq(tableRoundsTable.id, round.id));
      assert.equal(stored.totalPayout, expected);
    },
  );

  auditTest(
    `${gameCode}: deadline expiring during wallet debit refunds the full stake`,
    async () => {
      const f = await fixture();
      // Deterministically expire the round between the initial check and receipt.
      await pool.query(
        `CREATE OR REPLACE FUNCTION tp_expire_test() RETURNS trigger AS $$ BEGIN UPDATE table_rounds SET betting_ends_at = now() - interval '1 second' WHERE id = NEW.round_id; RETURN NEW; END; $$ LANGUAGE plpgsql`,
      );
      await pool.query(
        `CREATE TRIGGER tp_expire_test BEFORE INSERT ON table_round_bets FOR EACH ROW EXECUTE FUNCTION tp_expire_test()`,
      );
      try {
        await assert.rejects(
          placeTableBets({
            gameCode,
            userId: f.userId,
            roundId: f.round.id,
            bets: [{ type: "playerA", amountPaise: 10000n }],
          }),
          /BETTING_CLOSED/,
        );
        assert.equal(await f.balance(), 1000000n);
        const [receipt] = await db
          .select()
          .from(tableRoundBetsTable)
          .where(
            and(
              eq(tableRoundBetsTable.roundId, f.round.id),
              eq(tableRoundBetsTable.userId, f.userId),
            ),
          );
        assert.equal(receipt.status, "refunded");
      } finally {
        await pool.query(
          "DROP TRIGGER tp_expire_test ON table_round_bets; DROP FUNCTION tp_expire_test()",
        );
      }
    },
  );

  auditTest(
    `${gameCode}: disabled game and simultaneous bets cannot overspend the wallet`,
    async () => {
      const f = await fixture();
      await db
        .update(gameConfigTable)
        .set({ enabled: false })
        .where(eq(gameConfigTable.gameCode, gameCode));
      invalidateConfigCache(gameCode);
      const place = () =>
        placeTableBets({
          gameCode,
          userId: f.userId,
          roundId: f.round.id,
          bets: [{ type: "playerA", amountPaise: 10000n }],
        });
      await assert.rejects(place(), /GAME_DISABLED/);
      assert.equal(await f.balance(), 1000000n);
      await db
        .update(gameConfigTable)
        .set({ enabled: true })
        .where(eq(gameConfigTable.gameCode, gameCode));
      invalidateConfigCache(gameCode);
      await postEntry({
        userId: f.userId,
        type: "adjustment",
        amount: -990000n,
        scope: gameCode,
      });
      const results = await Promise.allSettled([place(), place()]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(results.filter((r) => r.status === "rejected").length, 1);
      assert.equal(await f.balance(), 0n);
    },
  );

  auditTest(
    `${gameCode}: failed wallet credit rolls back settlement and retries once`,
    async () => {
      const f = await fixture();
      const bets = [{ type: f.outcome.winner, amountPaise: 10001n }];
      const expected = settleTeenPattiBets(bets, f.outcome, 40, 2).totalPayout;
      const slip = await placeTableBets({
        gameCode,
        userId: f.userId,
        roundId: f.round.id,
        bets,
      });
      await pool.query(
        `CREATE FUNCTION tp_fail_credit_test() RETURNS trigger AS $$ BEGIN IF NEW.type = 'win' THEN RAISE EXCEPTION 'simulated credit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
      );
      await pool.query(
        `CREATE TRIGGER tp_fail_credit_test BEFORE INSERT ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION tp_fail_credit_test()`,
      );
      try {
        await assert.rejects(
          cashOutBet({
            userId: f.userId,
            betId: slip.betId,
            multiplier: Number(expected) / 10001,
            teenPattiPayoutPaise: expected,
          }),
        );
        const [bet] = await db
          .select()
          .from(betsTable)
          .where(eq(betsTable.id, slip.betId));
        assert.equal(bet.status, "placed");
        assert.equal(bet.payoutAmount, 0n);
        assert.equal(await f.balance(), 989999n);
      } finally {
        await pool.query(
          "DROP TRIGGER tp_fail_credit_test ON wallet_ledger; DROP FUNCTION tp_fail_credit_test()",
        );
      }
      const round = await f.reveal();
      await settlePendingSlips(round);
      await settlePendingSlips(round);
      assert.equal(await f.balance(), 989999n + expected);
    },
  );

  auditTest(
    `${gameCode}: own receipt stays visible beyond the 100-slip public feed`,
    async () => {
      const f = await fixture();
      const first = await placeTableBets({
        gameCode,
        userId: f.userId,
        roundId: f.round.id,
        bets: [{ type: "playerA", amountPaise: 100n }],
      });
      // Populate 101 newer fixtures; this test concerns receipt pagination only.
      const rows = await db
        .insert(betsTable)
        .values(
          Array.from({ length: 101 }, () => ({
            userId: f.userId,
            gameCode,
            roundId: f.round.id,
            stakeAmount: 100n,
            status: "placed" as const,
          })),
        )
        .returning();
      await db
        .insert(tableRoundBetsTable)
        .values(
          rows.map((bet) => ({
            userId: f.userId,
            gameCode,
            roundId: f.round.id,
            betId: bet.id,
            totalStake: 100n,
            bets: [{ type: "playerA", amountPaise: "100" }],
            createdAt: new Date(Date.now() + 1000),
          })),
        );
      const snapshot = await getTableRoundSnapshot(gameCode, f.userId);
      assert.equal(snapshot?.liveBets.length, 100);
      assert.equal(snapshot?.myBets.length, 102);
      assert.ok(snapshot?.myBets.some((bet) => bet.slipId === first.slipId));
      assert.equal(snapshot?.config.teenPattiPayouts?.tie, 40);
    },
  );
}
