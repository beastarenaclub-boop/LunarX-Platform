import { strict as assert } from "node:assert";
import { test } from "node:test";
import { eq, and } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  betsTable,
  gameConfigTable,
  tableRoundsTable,
  tableRoundBetsTable,
  walletLedgerTable,
  walletsTable,
} from "@workspace/db";
import {
  createTableRound,
  placeTableBets,
  revealTableRound,
  settleTableRound,
  settlePendingSlips,
  getTableRoundSnapshot,
  recoverTableRound,
} from "../tableRounds";
import { getBalanceByUser, postEntry } from "../wallet";
import { placeBet, cashOutBet, settleLoss } from "../bets";
import { deriveVegetableOutcome } from "../vegetableMath";
import { sha256Hex } from "../rtp";

test("Vegetable Bowl wallet settlement, closed bets, repeat settlement and interrupted-round refunds", async () => {
  const id = `vegetable-test-${Date.now()}`;
  const roundIds: string[] = [];
  const [oldConfig] = await db
    .select()
    .from(gameConfigTable)
    .where(eq(gameConfigTable.gameCode, "vegetable-bowl"));
  if (!oldConfig)
    await db
      .insert(gameConfigTable)
      .values({
        gameCode: "vegetable-bowl",
        enabled: true,
        minStakePaise: 100n,
        maxStakePaise: 1000000n,
        maxMultiplier: 20,
        settlementMode: "house_edge",
        bettingWindowMs: 20000,
        revealDurationMs: 7000,
        settleDurationMs: 5000,
      });
  await db
    .insert(usersTable)
    .values({
      id,
      email: `${id}@example.test`,
      emailNormalized: `${id}@example.test`,
      displayName: "Vegetable test",
      passwordHash: "test",
    });
  try {
    await postEntry({
      userId: id,
      type: "adjustment",
      amount: 100000n,
      memo: "Vegetable integration test",
    });
    await assert.rejects(
      () =>
        placeBet({ userId: id, gameCode: "vegetable-bowl", stakeAmount: 100n }),
      /current table round/,
    );
    let expectedBalance = 100000n;
    const cases = [
      { version: 2, winner: "normal" },
      { version: 2, winner: "hard" },
      { version: 2, winner: "risk" },
      { version: 2, winner: "junk" },
      { version: 1, winner: "normal" },
    ] as const;
    for (const { version, winner: winningMode } of cases) {
      let round = await createTableRound("vegetable-bowl");
      roundIds.push(round.id);
      assert.equal((round.config as { vegetableOutcomeVersion: number }).vegetableOutcomeVersion, 2);
      // Simulate a still-open round committed before the junk outcome release.
      const config = { ...(round.config as Record<string, unknown>) };
      if (version === 1) delete config.vegetableOutcomeVersion;
      let seed = "";
      for (let n = 0; ; n++) {
        seed = `vegetable-integration-${n}`;
        if (
          deriveVegetableOutcome(seed, round.clientSeed, round.nonce, version).winner ===
          winningMode
        )
          break;
      }
      await db
        .update(tableRoundsTable)
        .set({ serverSeed: seed, serverSeedHash: sha256Hex(seed), config })
        .where(eq(tableRoundsTable.id, round.id));
      round = { ...round, serverSeed: seed, serverSeedHash: sha256Hex(seed), config };
      const hidden = await getTableRoundSnapshot("vegetable-bowl", id);
      assert.equal(hidden?.outcome, null);
      assert.equal(hidden?.serverSeed, null);
      const slip = await placeTableBets({
        roundId: round.id,
        gameCode: "vegetable-bowl",
        userId: id,
        bets: ["normal", "hard", "risk"].map((type) => ({
          type,
          amountPaise: "100",
        })),
      });
      expectedBalance -= 300n;
      assert.equal((await getBalanceByUser(id)).balance, expectedBalance);
      await assert.rejects(
        () => cashOutBet({ betId: slip.betId, userId: id, multiplier: 20 }),
        /settle automatically/,
      );
      await assert.rejects(
        () => settleLoss(slip.betId, id),
        /settle automatically/,
      );
      await db
        .update(tableRoundsTable)
        .set({ bettingEndsAt: new Date(Date.now() - 1) })
        .where(eq(tableRoundsTable.id, round.id));
      round = await revealTableRound({
        ...round,
        bettingEndsAt: new Date(Date.now() - 1),
      });
      assert.deepEqual(round.outcome, deriveVegetableOutcome(seed, round.clientSeed, round.nonce, version));
      await assert.rejects(
        () =>
          placeTableBets({
            roundId: round.id,
            gameCode: "vegetable-bowl",
            userId: id,
            bets: [{ type: "risk", amountPaise: "100" }],
          }),
        /BETTING_CLOSED/,
      );
      const settled = await settleTableRound(round);
      const expectedPayout = winningMode === "junk" ? 0n : winningMode === "risk" ? 2000n : 198n;
      expectedBalance += expectedPayout;
      assert.equal((await getBalanceByUser(id)).balance, expectedBalance);
      await settlePendingSlips(settled);
      assert.equal(
        (await getBalanceByUser(id)).balance,
        expectedBalance,
        "settling twice must not pay twice",
      );
      const [receipt] = await db
        .select()
        .from(tableRoundBetsTable)
        .where(eq(tableRoundBetsTable.id, slip.slipId));
      assert.equal(receipt.payoutAmount, expectedPayout);
      assert.equal(receipt.status, "settled");
      await db
        .update(tableRoundsTable)
        .set({ phase: "settled" })
        .where(eq(tableRoundsTable.id, round.id));
    }
    const interrupted = await createTableRound("vegetable-bowl");
    roundIds.push(interrupted.id);
    await placeTableBets({
      roundId: interrupted.id,
      gameCode: "vegetable-bowl",
      userId: id,
      bets: [{ type: "normal", amountPaise: "100" }],
    });
    await recoverTableRound(interrupted);
    assert.equal(
      (await getBalanceByUser(id)).balance,
      expectedBalance,
      "unrevealed interrupted bets must be refunded",
    );
  } finally {
    for (const roundId of roundIds) {
      await db
        .delete(tableRoundBetsTable)
        .where(eq(tableRoundBetsTable.roundId, roundId));
      await db.delete(tableRoundsTable).where(eq(tableRoundsTable.id, roundId));
    }
    await db.delete(walletLedgerTable).where(eq(walletLedgerTable.userId, id));
    await db.delete(walletsTable).where(eq(walletsTable.userId, id));
    await db.delete(betsTable).where(eq(betsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
    if (!oldConfig)
      await db
        .delete(gameConfigTable)
        .where(eq(gameConfigTable.gameCode, "vegetable-bowl"));
    await pool.end();
  }
});
