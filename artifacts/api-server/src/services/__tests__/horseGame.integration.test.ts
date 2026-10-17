import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
test(
  "Horse Racing: shared funds, atomic debit, idempotency, locked race, once-only payout and restart recovery",
  { skip: !process.env.HORSE_GAME_INTEGRATION },
  async () => {
    assert(
      new URL(process.env.DATABASE_URL!).pathname.endsWith(
        "_shared_wallet_test",
      ),
    );
    const {
      db,
      pool,
      usersTable,
      walletsTable,
      walletLedgerTable,
      betsTable,
      gameRoundsTable,
    } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { postEntry, getBalanceByUser } = await import("../wallet");
    const {
      startHorseGame,
      horseGameState,
      horseGameConfig,
      startHorseGameEngine,
    } = await import("../horseGame");
    const id = `horse-test-${Date.now()}`;
    let stop = () => {};
    const rounds: string[] = [];
    try {
      await db
        .insert(usersTable)
        .values({
          id,
          email: `${id}@example.test`,
          emailNormalized: `${id}@example.test`,
          passwordHash: "test",
          displayName: "Horse test",
        });
      await postEntry({
        userId: id,
        type: "adjustment",
        scope: "lucky-7",
        amount: 1000000n,
      });
      const config = await horseGameConfig(),
        body = {
          requestId: randomUUID(),
          venueId: "royal",
          bets: Array.from({ length: 8 }, (_, i) => ({
            horseId: i + 1,
            amountPaise: "1000",
          })),
        };
      const results = await Promise.all([
        startHorseGame(id, body),
        startHorseGame(id, body),
      ]);
      assert.equal(results[0].race.id, results[1].race.id);
      assert.equal((await getBalanceByUser(id, "lucky-7")).balance, 992000n);
      assert.equal(
        (await getBalanceByUser(id, "horse-racing")).walletId,
        (await getBalanceByUser(id, "lunar")).walletId,
      );
      await assert.rejects(
        startHorseGame(id, { ...body, requestId: randomUUID() }),
        /still running/,
      );
      await assert.rejects(
        startHorseGame(id, {
          ...body,
          bets: [{ horseId: 1, amountPaise: "2000" }],
        }),
        /different bet/,
      );
      const race = results[0].race;
      const winner = race.plan.order[0],
        payout = BigInt(
          Math.round(
            config.horses.find((h) => h.id === winner)!.multiplier * 1000,
          ),
        );
      const [a, b] = await Promise.all([
        horseGameState(id, race.endsAt + 1),
        horseGameState(id, race.endsAt + 1),
      ]);
      assert.equal(a.race!.winnerId, winner);
      assert.equal(b.race!.payoutAmount, payout.toString());
      assert.equal(
        (await getBalanceByUser(id, "lucky-7")).balance,
        992000n + payout,
      );
      await startHorseGame(id, body, race.endsAt + 1);
      assert.equal((await getBalanceByUser(id)).balance, 992000n + payout);
      const countBefore = (
        await db.select().from(betsTable).where(eq(betsTable.userId, id))
      ).length;
      await assert.rejects(
        startHorseGame(id, {
          requestId: randomUUID(),
          venueId: "royal",
          bets: [{ horseId: 1, amountPaise: "100000000" }],
        }),
      );
      assert.equal(
        (await db.select().from(betsTable).where(eq(betsTable.userId, id)))
          .length,
        countBefore,
      );
      const started = await startHorseGame(id, {
        ...body,
        requestId: randomUUID(),
        venueId: "marathon",
      });
      const [bet] = await db
        .select()
        .from(betsTable)
        .where(eq(betsTable.id, started.race.id));
      await db
        .update(betsTable)
        .set({
          metadata: { ...(bet.metadata as object), endsAt: Date.now() - 1 },
        })
        .where(eq(betsTable.id, bet.id));
      stop = startHorseGameEngine();
      for (let n = 0; n < 40; n++) {
        const [row] = await db
          .select()
          .from(betsTable)
          .where(eq(betsTable.id, bet.id));
        if (row.status !== "placed") break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const [settled] = await db
        .select()
        .from(betsTable)
        .where(eq(betsTable.id, bet.id));
      assert.notEqual(settled.status, "placed");
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, id));
      assert.equal(
        ledger.filter((e) => e.refId === bet.id && e.type === "win").length,
        1,
      );
    } finally {
      stop();
      const rows = await db
        .select()
        .from(betsTable)
        .where(eq(betsTable.userId, id));
      rounds.push(...rows.map((b) => b.roundId!).filter(Boolean));
      await db
        .delete(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, id));
      await db.delete(betsTable).where(eq(betsTable.userId, id));
      for (const roundId of rounds)
        await db.delete(gameRoundsTable).where(eq(gameRoundsTable.id, roundId));
      await db.delete(walletsTable).where(eq(walletsTable.userId, id));
      await db.delete(usersTable).where(eq(usersTable.id, id));
      await pool.end();
    }
  },
);
