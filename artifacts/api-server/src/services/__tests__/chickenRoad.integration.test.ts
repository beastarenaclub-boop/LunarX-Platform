import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";

test("Chicken Road: atomic shared wallet, races, recovery, private seeds and settlement guards", { skip: !process.env.CHICKEN_ROAD_INTEGRATION }, async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /chicken_road_test$/);
  const { db, pool, usersTable, gameConfigTable, betsTable, walletsTable, walletLedgerTable } = await import("@workspace/db");
  const { eq, inArray } = await import("drizzle-orm");
  const { startChicken, moveChicken, chickenState, getChickenRound, chickenConfig } = await import("../chickenRoad");
  const { CHICKEN_DIFFICULTIES, CHICKEN_MODES, chickenPayout } = await import("@workspace/api-zod/chicken-road-game");
  const { chickenStepSafe } = await import("../chickenRoadMath");
  const { getBalanceByUser, postEntry } = await import("../wallet");
  const { placeBet, cashOutBet, settleLoss } = await import("../bets");
  const { bet: serializeBet } = await import("../../lib/serialize");
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const makeInput = () => ({ requestId: randomUUID(), difficulty: "easy" as const, stakeAmount: "10000", clientSeed: "integration-client" });
  // Only in this isolated test DB: recreate an old version 1 receipt for replay tests.
  async function forceClassicStep(id: string, safe: boolean, step: number) {
    const [row] = await db.select().from(betsTable).where(eq(betsTable.id, id));
    const meta = row.metadata as { difficulty: "easy"; clientSeed: string; step: number; attemptedStep: number; serverSeed: string };
    let seed = "";
    for (let i = 0; i < 100000; i++) if (chickenStepSafe(`test-${i}`, meta.clientSeed, meta.difficulty, step, 1) === safe) { seed = `test-${i}`; break; }
    assert(seed);
    await db.update(betsTable).set({ metadata: { ...meta, version: 1, serverSeed: seed, step: step - 1, attemptedStep: step - 1 } }).where(eq(betsTable.id, id));
  }
  try {
    await db.insert(gameConfigTable).values({ gameCode: "chicken-road", enabled: true, minStakePaise: 100n, maxStakePaise: 1000000n }).onConflictDoNothing();
    for (const id of ids) {
      await db.insert(usersTable).values({ id, email: `${id}@example.test`, emailNormalized: `${id}@example.test`, passwordHash: "test" });
      await postEntry({ userId: id, type: "adjustment", amount: id === ids[2] ? 100n : 100000n });
    }
    const input = makeInput();
    const [first, retry] = await Promise.all([startChicken(ids[0], input), startChicken(ids[0], input)]);
    assert.equal((await chickenConfig()).rtp, null);
    assert.equal(first.version, 2);
    assert.equal(first.nextSurvival, 1);
    assert.equal(first.id, retry.id);
    assert.equal(first.serverSeed, null);
    assert.equal((await getBalanceByUser(ids[0], "mines")).balance, 90000n);
    assert.equal((await getBalanceByUser(ids[0], "chicken-road")).walletId, (await getBalanceByUser(ids[0], "lunar")).walletId);
    await assert.rejects(startChicken(ids[0], { ...input, stakeAmount: "20000" }), /already used/);
    await assert.rejects(startChicken(ids[0], makeInput()), /current Chicken Road/);
    await assert.rejects(moveChicken(ids[0], first.id, "cashout", 0), /Cross one lane/);
    await assert.rejects(moveChicken(ids[1], first.id, "step", 0), /not found/);
    await assert.rejects(startChicken(ids[2], makeInput()), /Insufficient/);
    assert.equal((await db.select().from(betsTable).where(eq(betsTable.userId, ids[2]))).length, 0);
    assert.equal((await getBalanceByUser(ids[2])).balance, 100n);
    await assert.rejects(placeBet({ userId: ids[0], gameCode: "chicken-road", stakeAmount: 100n }), /Chicken Road/);
    await assert.rejects(cashOutBet({ userId: ids[0], betId: first.id, multiplier: 1000 }), /Chicken Road/);
    await assert.rejects(settleLoss(first.id, ids[0]), /Chicken Road/);
    const [raw] = await db.select().from(betsTable).where(eq(betsTable.id, first.id));
    assert(!JSON.stringify(serializeBet(raw)).includes((raw.metadata as { serverSeed: string }).serverSeed));
    const moves = await Promise.allSettled([moveChicken(ids[0], first.id, "step", 0), moveChicken(ids[0], first.id, "step", 0)]);
    assert.equal(moves.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await chickenState(ids[0])).round?.step, 1);
    const cashouts = await Promise.all([moveChicken(ids[0], first.id, "cashout", 1), moveChicken(ids[0], first.id, "cashout", 1)]);
    assert(cashouts.every(r => r.payoutAmount === "10100" && r.serverSeed));
    assert.equal((await getBalanceByUser(ids[0])).balance, 100100n);
    assert.equal((await chickenState(ids[0])).round, null);
    assert.equal((await startChicken(ids[0], input)).status, "cashed_out");
    assert.equal((await getBalanceByUser(ids[0])).balance, 100100n);
    const loss = await startChicken(ids[0], makeInput());
    await forceClassicStep(loss.id, false, 1);
    assert.equal((await moveChicken(ids[0], loss.id, "step", 0)).status, "busted");
    await moveChicken(ids[0], loss.id, "cashout", 0);
    assert.equal((await getBalanceByUser(ids[0])).balance, 90100n);
    const starts = await Promise.allSettled([startChicken(ids[1], makeInput()), startChicken(ids[1], makeInput())]);
    assert.equal(starts.filter(r => r.status === "fulfilled").length, 1);
    const complete = (await chickenState(ids[1])).round!;
    for (let step = 0; step < 23; step++) {
      const moved = await moveChicken(ids[1], complete.id, "step", step);
      assert.equal(moved.status, "active");
      assert.equal(moved.nextSurvival, 1);
    }
    const auto = await moveChicken(ids[1], complete.id, "step", 23);
    assert.equal(auto.status, "cashed_out"); assert.equal(auto.payoutAmount, "280000");
    await moveChicken(ids[1], complete.id, "step", 23);
    assert.equal((await getBalanceByUser(ids[1])).balance, 370000n);
    assert.equal((await getChickenRound(ids[1], complete.id)).serverSeed, auto.serverSeed);
    const race = await startChicken(ids[0], makeInput());
    await moveChicken(ids[0], race.id, "step", 0);
    await forceClassicStep(race.id, false, 2);
    await Promise.allSettled([moveChicken(ids[0], race.id, "step", 1), moveChicken(ids[0], race.id, "cashout", 1)]);
    const final = await getChickenRound(ids[0], race.id);
    const ledger = await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.refId, race.id));
    assert.equal(ledger.filter(e => e.type === "win").length, final.status === "cashed_out" ? 1 : 0);
    assert.equal((await getBalanceByUser(ids[0])).balance, final.status === "cashed_out" ? 90200n : 80100n);

    let expectedBalance = 370000n;
    for (const difficulty of CHICKEN_DIFFICULTIES) {
      const started = await startChicken(ids[1], { ...makeInput(), difficulty });
      assert.equal(started.version, 2);
      let finished = started;
      const total = CHICKEN_MODES[difficulty].returns.length;
      for (let step = 0; step < total; step++) {
        assert.equal(finished.nextSurvival, 1);
        finished = await moveChicken(ids[1], started.id, "step", step);
        assert.equal(finished.step, step + 1);
        assert.equal(finished.status, step + 1 === total ? "cashed_out" : "active");
      }
      const payout = chickenPayout(10000n, difficulty, total);
      expectedBalance += payout - 10000n;
      assert.equal(finished.payoutAmount, payout.toString());
      // Retrying the automatic cashout cannot credit the guaranteed prize twice.
      await moveChicken(ids[1], started.id, "step", total - 1);
      await moveChicken(ids[1], started.id, "cashout", total);
      assert.equal((await getBalanceByUser(ids[1])).balance, expectedBalance);
      const entries = await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.refId, started.id));
      assert.equal(entries.filter(e => e.type === "win").length, 1);
    }
  } finally {
    await db.delete(walletLedgerTable).where(inArray(walletLedgerTable.userId, ids));
    await db.delete(betsTable).where(inArray(betsTable.userId, ids));
    await db.delete(walletsTable).where(inArray(walletsTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    await pool.end();
  }
});
