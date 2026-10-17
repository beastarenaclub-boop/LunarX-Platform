import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";

test(
  "shared bike clock, closed betting, private outcomes, atomic wallet and restart settlement",
  { skip: !process.env.BIKE_GAME_INTEGRATION },
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
      tableRoundsTable,
      gameConfigTable,
    } = await import("@workspace/db");
    const { eq, inArray, sql } = await import("drizzle-orm");
    const { bikeRoundSchedule, RACING_VENUES } =
      await import("@workspace/api-zod/bike-racing-game");
    const {
      bikeLiveState,
      placeBikeLiveBet,
      ensureBikeLiveRound,
      settleBikeLiveRound,
      tickBikeLiveGame,
    } = await import("../bikeLiveGame");
    const { postEntry, getBalanceByUser } = await import("../wallet");
    const { placeBet, cashOutBet, settleLoss } = await import("../bets");
    const ids = Array.from(
      { length: 4 },
      () => `bike-live-test-${randomUUID()}`,
    );
    const rounds = new Set<string>();
    let now =
      bikeRoundSchedule(
        "apex",
        Date.UTC(2037, 0, 1) + Math.floor(Math.random() * 1e9),
      ).bettingOpensAt + 1000;
    const clock = () => now;
    const trackSlots = (time: number) =>
      RACING_VENUES.forEach((v) =>
        rounds.add(bikeRoundSchedule(v.id, time).id),
      );
    await db.insert(gameConfigTable).values({ gameCode: "bike-racing", enabled: true,
      houseEdge: .03, minStakePaise: 100n, maxStakePaise: 1_000_000_000_000n, maxMultiplier: 6,
    }).onConflictDoNothing();
    try {
      for (const id of ids) {
        await db.insert(usersTable).values({
          id,
          email: `${id}@example.test`,
          emailNormalized: `${id}@example.test`,
          passwordHash: "test",
          displayName: "Live bike test",
        });
        await postEntry({
          userId: id,
          type: "adjustment",
          scope: "lucky-7",
          amount: 1000000n,
        });
      }
      trackSlots(now);
      await tickBikeLiveGame(clock);
      const a = await bikeLiveState(ids[0], "apex", clock);
      const spectator = await bikeLiveState(ids[2], "apex", clock);
      assert.equal(a.race.id, spectator.race.id);
      assert.equal(a.race.startedAt - a.race.bettingOpensAt, 20000);
      assert.equal(a.race.phase, "betting");
      assert.equal(a.race.plan, null);
      assert.equal(a.race.winnerId, null);
      assert(!JSON.stringify(a).includes('"seed"'));
      const body = {
        requestId: randomUUID(),
        roundId: a.race.id,
        venueId: "apex",
        bets: Array.from({ length: 6 }, (_, i) => ({
          bikeId: i + 1,
          amountPaise: "1000",
        })),
      };
      const [first, retry, second] = await Promise.all([
        placeBikeLiveBet(ids[0], body, clock),
        placeBikeLiveBet(ids[0], body, clock),
        placeBikeLiveBet(ids[1], { ...body, requestId: randomUUID() }, clock),
      ]);
      assert.equal(first.acceptedBet.id, retry.acceptedBet.id);
      const burst = await Promise.all(
        Array.from({ length: 12 }, () =>
          placeBikeLiveBet(ids[0], body, clock),
        ),
      );
      assert(burst.every((b) => b.acceptedBet.id === first.acceptedBet.id));
      assert.equal(first.race.id, second.race.id);
      assert.equal(
        first.race.startedAt,
        a.race.startedAt,
        "bet must not reset the clock",
      );
      assert.equal(first.race.plan, null);
      assert.equal(first.balance, "994000");
      await assert.rejects(
        placeBet({
          userId: ids[3],
          gameCode: "bike-racing",
          roundId: a.race.id,
          stakeAmount: 1000n,
        }),
        /betting window/,
      );
      await assert.rejects(
        cashOutBet({
          userId: ids[0],
          betId: first.acceptedBet.id,
          multiplier: 100,
        }),
        /settle automatically/,
      );
      await assert.rejects(
        settleLoss(first.acceptedBet.id, ids[0]),
        /settle automatically/,
      );
      assert.equal(
        (await getBalanceByUser(ids[0], "lucky-7")).balance,
        994000n,
      );
      await assert.rejects(
        placeBikeLiveBet(ids[0], { ...body, requestId: randomUUID() }, clock),
        /already accepted/,
      );
      await assert.rejects(
        placeBikeLiveBet(
          ids[0],
          { ...body, bets: [{ bikeId: 2, amountPaise: "1000" }] },
          clock,
        ),
        /different bet/,
      );
      now = a.race.startedAt - 1;
      await placeBikeLiveBet(
        ids[2],
        { ...body, requestId: randomUUID() },
        clock,
      );
      now = a.race.startedAt;
      await assert.rejects(
        placeBikeLiveBet(ids[3], { ...body, requestId: randomUUID() }, clock),
        /Betting is closed/,
      );
      now += 10000;
      const watching = await bikeLiveState(ids[3], "apex", clock);
      const participant = await bikeLiveState(ids[0], "apex", clock);
      assert.equal(watching.myBet, null);
      assert.equal(watching.race.phase, "racing");
      assert.deepEqual(watching.race.plan, participant.race.plan);
      await assert.rejects(
        placeBikeLiveBet(ids[3], { ...body, requestId: randomUUID() }, clock),
        /Betting is closed/,
      );
      assert.equal((await getBalanceByUser(ids[3])).balance, 1000000n);
      now = a.race.endsAt;
      await Promise.all([
        settleBikeLiveRound(a.race.id, clock),
        settleBikeLiveRound(a.race.id, clock),
      ]);
      const result = await bikeLiveState(ids[0], "apex", clock);
      assert.equal(result.race.phase, "results");
      assert.equal(result.myBet?.status, "finished");
      const balance = (await getBalanceByUser(ids[0])).balance;
      assert.equal(balance, 994000n + BigInt(result.myBet!.payoutAmount));
      await placeBikeLiveBet(ids[0], body, clock);
      assert.equal((await getBalanceByUser(ids[0])).balance, balance);
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, ids[0]));
      assert.equal(
        ledger.filter(
          (e) => e.refId === first.acceptedBet.id && e.type === "bet",
        ).length,
        1,
      );
      assert.equal(
        ledger.filter(
          (e) => e.refId === first.acceptedBet.id && e.type === "win",
        ).length,
        1,
      );

      now = a.race.nextRoundAt;
      trackSlots(now);
      await tickBikeLiveGame(clock);
      const next = await bikeLiveState(ids[3], "apex", clock);
      assert.notEqual(next.race.id, a.race.id);
      assert.equal(next.race.phase, "betting");
      assert.equal(next.myBet, null);
      const nextBody = {
        ...body,
        roundId: next.race.id,
        requestId: randomUUID(),
      };
      // A wallet lock that crosses the deadline must roll back both the slip and debit.
      let release!: () => void, locked!: () => void;
      const held = new Promise<void>((r) => {
        release = r;
      });
      const ready = new Promise<void>((r) => {
        locked = r;
      });
      const blocker = db.transaction(async (tx) => {
        await tx
          .select()
          .from(walletsTable)
          .where(eq(walletsTable.userId, ids[3]))
          .for("update");
        locked();
        await held;
      });
      await ready;
      const waiting = placeBikeLiveBet(ids[3], nextBody, clock);
      const rejected = assert.rejects(waiting, /Betting closed before/);
      try {
        let blocked = false;
        for (let n = 0; n < 100 && !blocked; n++) {
          const activity = await db.execute(
            sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%wallets%'`,
          );
          blocked = activity.rows.length > 0;
          if (!blocked) await new Promise((r) => setTimeout(r, 20));
        }
        assert(blocked, "bet should be waiting for its wallet row");
        now = next.race.startedAt;
      } finally {
        release();
        await blocker;
      }
      await rejected;
      assert.equal((await getBalanceByUser(ids[3])).balance, 1000000n);
      assert.equal(
        (await db.select().from(betsTable).where(eq(betsTable.userId, ids[3])))
          .length,
        0,
      );
      // A new process can recover an accepted round solely from persisted rows.
      now = next.race.nextRoundAt;
      const recovered = await ensureBikeLiveRound("apex", now);
      rounds.add(recovered.id);
      const recoverBet = await placeBikeLiveBet(
        ids[3],
        { ...body, roundId: recovered.id, requestId: randomUUID() },
        clock,
      );
      now = recovered.revealEndsAt.getTime() + 1;
      trackSlots(now);
      await tickBikeLiveGame(clock);
      const [settled] = await db
        .select()
        .from(betsTable)
        .where(eq(betsTable.id, recoverBet.acceptedBet.id));
      assert.notEqual(settled.status, "placed");
      now = recovered.settleEndsAt.getTime();
      trackSlots(now);
      await tickBikeLiveGame(clock);
      const empty = await bikeLiveState(ids[3], "apex", clock);
      now = empty.race.nextRoundAt;
      trackSlots(now);
      await tickBikeLiveGame(clock);
      const afterEmpty = await bikeLiveState(ids[3], "apex", clock);
      assert.notEqual(
        empty.race.id,
        afterEmpty.race.id,
        "empty rounds must advance too",
      );
      assert.equal(afterEmpty.race.phase, "betting");
    } finally {
      await db
        .delete(walletLedgerTable)
        .where(inArray(walletLedgerTable.userId, ids));
      await db.delete(betsTable).where(inArray(betsTable.userId, ids));
      await db.delete(walletsTable).where(inArray(walletsTable.userId, ids));
      await db.delete(usersTable).where(inArray(usersTable.id, ids));
      if (rounds.size)
        await db
          .delete(tableRoundsTable)
          .where(inArray(tableRoundsTable.id, [...rounds]));
      await pool.end();
    }
  },
);
