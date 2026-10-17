import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";

test(
  "shared horse clock, closed betting, private outcomes, atomic wallet and restart settlement",
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
      tableRoundsTable,
    } = await import("@workspace/db");
    const { eq, inArray, sql } = await import("drizzle-orm");
    const { horseRoundSchedule, RACING_VENUES } =
      await import("@workspace/api-zod/horse-racing-game");
    const {
      horseLiveState,
      placeHorseLiveBet,
      ensureHorseLiveRound,
      settleHorseLiveRound,
      tickHorseLiveGame,
    } = await import("../horseLiveGame");
    const { postEntry, getBalanceByUser } = await import("../wallet");
    const { placeBet, cashOutBet, settleLoss } = await import("../bets");
    const ids = Array.from(
      { length: 4 },
      () => `horse-live-test-${randomUUID()}`,
    );
    const rounds = new Set<string>();
    let now =
      horseRoundSchedule(
        "royal",
        Date.UTC(2037, 0, 1) + Math.floor(Math.random() * 1e9),
      ).bettingOpensAt + 1000;
    const clock = () => now;
    const trackSlots = (time: number) =>
      RACING_VENUES.forEach((v) =>
        rounds.add(horseRoundSchedule(v.id, time).id),
      );
    try {
      for (const id of ids) {
        await db.insert(usersTable).values({
          id,
          email: `${id}@example.test`,
          emailNormalized: `${id}@example.test`,
          passwordHash: "test",
          displayName: "Live horse test",
        });
        await postEntry({
          userId: id,
          type: "adjustment",
          scope: "lucky-7",
          amount: 1000000n,
        });
      }
      trackSlots(now);
      await tickHorseLiveGame(clock);
      const a = await horseLiveState(ids[0], "royal", clock);
      const spectator = await horseLiveState(ids[2], "royal", clock);
      assert.equal(a.race.id, spectator.race.id);
      assert.equal(a.race.startedAt - a.race.bettingOpensAt, 20000);
      assert.equal(a.race.phase, "betting");
      assert.equal(a.race.plan, null);
      assert.equal(a.race.winnerId, null);
      assert(!JSON.stringify(a).includes('"seed"'));
      const body = {
        requestId: randomUUID(),
        roundId: a.race.id,
        venueId: "royal",
        bets: Array.from({ length: 8 }, (_, i) => ({
          horseId: i + 1,
          amountPaise: "1000",
        })),
      };
      const [first, retry, second] = await Promise.all([
        placeHorseLiveBet(ids[0], body, clock),
        placeHorseLiveBet(ids[0], body, clock),
        placeHorseLiveBet(ids[1], { ...body, requestId: randomUUID() }, clock),
      ]);
      assert.equal(first.acceptedBet.id, retry.acceptedBet.id);
      const burst = await Promise.all(
        Array.from({ length: 12 }, () =>
          placeHorseLiveBet(ids[0], body, clock),
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
      assert.equal(first.balance, "992000");
      await assert.rejects(
        placeBet({
          userId: ids[3],
          gameCode: "horse-racing",
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
        992000n,
      );
      await assert.rejects(
        placeHorseLiveBet(ids[0], { ...body, requestId: randomUUID() }, clock),
        /already accepted/,
      );
      await assert.rejects(
        placeHorseLiveBet(
          ids[0],
          { ...body, bets: [{ horseId: 2, amountPaise: "1000" }] },
          clock,
        ),
        /different bet/,
      );
      now = a.race.startedAt - 1;
      await placeHorseLiveBet(
        ids[2],
        { ...body, requestId: randomUUID() },
        clock,
      );
      now = a.race.startedAt;
      await assert.rejects(
        placeHorseLiveBet(ids[3], { ...body, requestId: randomUUID() }, clock),
        /Betting is closed/,
      );
      now += 10000;
      const watching = await horseLiveState(ids[3], "royal", clock);
      const participant = await horseLiveState(ids[0], "royal", clock);
      assert.equal(watching.myBet, null);
      assert.equal(watching.race.phase, "racing");
      assert.deepEqual(watching.race.plan, participant.race.plan);
      await assert.rejects(
        placeHorseLiveBet(ids[3], { ...body, requestId: randomUUID() }, clock),
        /Betting is closed/,
      );
      assert.equal((await getBalanceByUser(ids[3])).balance, 1000000n);
      now = a.race.endsAt;
      await Promise.all([
        settleHorseLiveRound(a.race.id, clock),
        settleHorseLiveRound(a.race.id, clock),
      ]);
      const result = await horseLiveState(ids[0], "royal", clock);
      assert.equal(result.race.phase, "results");
      assert.equal(result.myBet?.status, "finished");
      const balance = (await getBalanceByUser(ids[0])).balance;
      assert.equal(balance, 992000n + BigInt(result.myBet!.payoutAmount));
      await placeHorseLiveBet(ids[0], body, clock);
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
      await tickHorseLiveGame(clock);
      const next = await horseLiveState(ids[3], "royal", clock);
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
      const waiting = placeHorseLiveBet(ids[3], nextBody, clock);
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
      const recovered = await ensureHorseLiveRound("royal", now);
      rounds.add(recovered.id);
      const recoverBet = await placeHorseLiveBet(
        ids[3],
        { ...body, roundId: recovered.id, requestId: randomUUID() },
        clock,
      );
      now = recovered.revealEndsAt.getTime() + 1;
      trackSlots(now);
      await tickHorseLiveGame(clock);
      const [settled] = await db
        .select()
        .from(betsTable)
        .where(eq(betsTable.id, recoverBet.acceptedBet.id));
      assert.notEqual(settled.status, "placed");
      now = recovered.settleEndsAt.getTime();
      trackSlots(now);
      await tickHorseLiveGame(clock);
      const empty = await horseLiveState(ids[3], "royal", clock);
      now = empty.race.nextRoundAt;
      trackSlots(now);
      await tickHorseLiveGame(clock);
      const afterEmpty = await horseLiveState(ids[3], "royal", clock);
      assert.notEqual(
        empty.race.id,
        afterEmpty.race.id,
        "empty rounds must advance too",
      );
      assert.equal(afterEmpty.race.phase, "betting");
      // Deployment must finish a previously accepted hr3 slot on its saved pace.
      const [template] = await db
        .select()
        .from(tableRoundsTable)
        .where(eq(tableRoundsTable.id, afterEmpty.race.id));
      const { raceSpeed: _pace, ...oldConfig } = template.config as Record<
        string,
        unknown
      >;
      const legacyId = `hr3-upgrade-test-${randomUUID()}`;
      rounds.add(legacyId);
      await db
        .insert(tableRoundsTable)
        .values({
          ...template,
          id: legacyId,
          config: oldConfig,
          createdAt: new Date(now),
          bettingEndsAt: new Date(now + 20000),
          revealEndsAt: new Date(now + 53000),
          settleEndsAt: new Date(now + 58000),
        });
      const legacy = await horseLiveState(ids[3], "royal", clock);
      assert.equal(legacy.race.id, legacyId);
      const oldBet = await placeHorseLiveBet(
        ids[3],
        { ...body, roundId: legacyId, requestId: randomUUID() },
        clock,
      );
      assert.equal(oldBet.race.startedAt, legacy.race.startedAt);
      now = legacy.race.startedAt + 1000;
      const oldRunning = await horseLiveState(ids[3], "royal", clock);
      assert(
        oldRunning.race.plan!.duration > 30,
        "old round must retain the original pace",
      );
      now = legacy.race.endsAt;
      await settleHorseLiveRound(legacyId, clock);
      const [oldSettled] = await db
        .select()
        .from(betsTable)
        .where(eq(betsTable.id, oldBet.acceptedBet.id));
      assert.notEqual(oldSettled.status, "placed");
      now = legacy.race.nextRoundAt;
      const upgraded = await ensureHorseLiveRound("royal", now);
      rounds.add(upgraded.id);
      assert(upgraded.id.startsWith("hr4-"));
      assert.equal((upgraded.config as { raceSpeed: number }).raceSpeed, 1.65);
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
