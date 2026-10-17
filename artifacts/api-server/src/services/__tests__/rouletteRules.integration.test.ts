import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool, usersTable, gameConfigTable, tableRoundsTable, tableRoundBetsTable, betsTable, rouletteRoundsTable, type TableRound } from "@workspace/db";
import { createTableRound, placeTableBets, revealTableRound, settleTableRound, settlePendingSlips, finishTableRound, recoverTableRound } from "../tableRounds";
import { getBalanceByUser, postEntry } from "../wallet";
import { placeBet, cashOutBet, settleLoss } from "../bets";
import { deriveRouletteOutcome, invalidateConfigCache } from "../rtp";
import { parseStoredBets } from "../roulette";
import { settleRouletteBets } from "../rouletteMath";

// This suite creates funded accounts and must never run on an application DB.
if (new URL(process.env.DATABASE_URL!).pathname !== "/roulette_rules_test") {
  throw new Error("Use the isolated roulette_rules_test database only");
}
after(() => pool.end());
const run = `roulette-${Date.now()}`;
let sequence = 0;
async function player() {
  const id = `${run}-${sequence++}`;
  await db.insert(usersTable).values({ id, email: `${id}@example.test`, emailNormalized: `${id}@example.test`, displayName: "Rules test", passwordHash: "test" });
  await postEntry({ userId: id, type: "adjustment", amount: 100000000n, memo: "Isolated roulette test funds" });
  return id;
}
const straight = (amountPaise: string, number = 17) => ({ type: "straight", numbers: [number], amountPaise });
const submit = (round: TableRound, userId: string, bets: unknown[]) => placeTableBets({ gameCode: "roulette", roundId: round.id, userId, bets });
async function close(round: TableRound) {
  const revealed = await revealTableRound(round);
  const settled = await settleTableRound(revealed);
  await finishTableRound(settled);
  return settled;
}

test("roulette admission, wallet credit and historical contracts", { timeout: 60000 }, async t => {
  const config = { enabled: true, minStakePaise: 1000n, maxStakePaise: 50000000n, maxMultiplier: 36, houseEdge: 1 / 37, settlementMode: "house_edge", bettingWindowMs: 120000, revealDurationMs: 5000, settleDurationMs: 5000 };
  await db.insert(gameConfigTable).values({ gameCode: "roulette", ...config }).onConflictDoUpdate({ target: gameConfigTable.gameCode, set: config });
  invalidateConfigCache("roulette");
  let open: TableRound | undefined;
  try {
    await t.test("invalid amounts never debit; cumulative limits apply across slips and users", async () => {
      open = await createTableRound("roulette");
      const userId = await player();
      const before = (await getBalanceByUser(userId)).balance;
      for (const bets of [[straight("999")], [straight("2000001")], [{ type: "red", amountPaise: "10000001" }], [straight("1000000"), straight("1001000")]]) {
        await assert.rejects(() => submit(open!, userId, bets), /ROULETTE_.*(SMALL|LIMIT)/);
      }
      assert.equal((await getBalanceByUser(userId)).balance, before);
      assert.equal((await db.select().from(betsTable).where(eq(betsTable.userId, userId))).length, 0);
      const first = await submit(open, userId, [straight("2000000"), { type: "red", amountPaise: "10000000" }]);
      assert.equal((await getBalanceByUser(userId)).balance, before - 12000000n);
      await assert.rejects(() => submit(open!, userId, [straight("1000")]), /ROULETTE_STRAIGHT_LIMIT/);
      await assert.rejects(() => submit(open!, userId, [{ type: "red", numbers: [7], amountPaise: "1000" }]), /ROULETTE_OTHER_LIMIT/);
      await submit(open, userId, [straight("1000", 18)]);
      await submit(open, await player(), [straight("2000000")]);
      await assert.rejects(() => placeBet({ userId, gameCode: "roulette", stakeAmount: 1000n }), /current table/);
      await assert.rejects(() => cashOutBet({ userId, betId: first.betId, multiplier: 36 }), /settle automatically/);
      await assert.rejects(() => settleLoss(first.betId, userId), /settle automatically/);
      await close(open);
      open = await createTableRound("roulette");
      await submit(open, userId, [straight("2000000")]);
      await close(open);
    });
    await t.test("parallel requests cannot exceed one selection's cap or starve the wallet pool", async () => {
      open = await createTableRound("roulette");
      const userId = await player();
      const results = await Promise.allSettled(Array.from({ length: 12 }, () => submit(open!, userId, [straight("2000000")])));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      for (const result of results) if (result.status === "rejected") assert.match(result.reason.message, /ROULETTE_(STRAIGHT_LIMIT|BET_IN_PROGRESS)/);
      assert.equal((await getBalanceByUser(userId)).balance, 98000000n);
      const users = await Promise.all(Array.from({ length: 14 }, () => player()));
      await Promise.all(users.map(id => submit(open!, id, [straight("1000")])));
      await close(open);
    });
    await t.test("36x is exact total return; repeated settlement and receipt recovery credit once", async () => {
      open = await createTableRound("roulette");
      assert.equal((open.config as { roulettePayoutBase: number }).roulettePayoutBase, 36);
      const pocket = deriveRouletteOutcome(open.serverSeed, open.clientSeed, open.nonce).pocket;
      const userId = await player();
      const slip = await submit(open, userId, [straight("2000000", pocket)]);
      const settled = await close(open);
      assert.equal((await getBalanceByUser(userId)).balance, 170000000n);
      const [bet] = await db.select().from(betsTable).where(eq(betsTable.id, slip.betId));
      assert.equal(bet.payoutAmount, 72000000n);
      assert.equal(bet.multiplier, 36);
      await settlePendingSlips(settled);
      // Simulate a restart between wallet credit and persistence of the receipt.
      await db.update(tableRoundBetsTable).set({ status: "pending", payoutAmount: 0n }).where(eq(tableRoundBetsTable.id, slip.slipId));
      await settlePendingSlips(settled);
      assert.equal((await getBalanceByUser(userId)).balance, 170000000n);
      const [receipt] = await db.select().from(tableRoundBetsTable).where(eq(tableRoundBetsTable.id, slip.slipId));
      assert.equal(receipt.payoutAmount, 72000000n);
      assert.equal(receipt.status, "settled");
      const [roundReceipt] = await db.select().from(tableRoundsTable).where(eq(tableRoundsTable.id, settled.id));
      assert.equal(roundReceipt.totalPayout, 72000000n);
      const [audit] = await db.select().from(rouletteRoundsTable).where(eq(rouletteRoundsTable.betId, slip.betId));
      const stored = parseStoredBets(audit.bets);
      assert.equal(stored.payoutBase, 36);
      assert.equal(deriveRouletteOutcome(audit.serverSeed, audit.clientSeed, audit.nonce).pocket, audit.pocket);
      assert.equal(settleRouletteBets(stored.bets.map(b => ({ ...b, amountPaise: BigInt(b.amountPaise) })), audit.pocket, audit.maxMultiplier, stored.payoutBase).totalPayout, audit.payoutAmount);
    });
    await t.test("already committed 31.45x and 35x rounds retain their old returns", async () => {
      for (const base of [31.45, 35]) {
        open = await createTableRound("roulette");
        const config = { ...(open.config as object), roulettePayoutBase: base, maxMultiplier: 35 };
        await db.update(tableRoundsTable).set({ config }).where(eq(tableRoundsTable.id, open.id));
        open = { ...open, config };
        const pocket = deriveRouletteOutcome(open.serverSeed, open.clientSeed, open.nonce).pocket;
        const userId = await player();
        const slip = await submit(open, userId, [straight("1000", pocket)]);
        await close(open);
        const [bet] = await db.select().from(betsTable).where(eq(betsTable.id, slip.betId));
        assert.equal(bet.payoutAmount, BigInt(base * 1000));
        assert.equal((await getBalanceByUser(userId)).balance, 100000000n - 1000n + BigInt(base * 1000));
        const [audit] = await db.select().from(rouletteRoundsTable).where(eq(rouletteRoundsTable.betId, slip.betId));
        assert.equal(parseStoredBets(audit.bets).payoutBase, base);
      }
    });
    await t.test("closed windows reject before debit", async () => {
      open = await createTableRound("roulette");
      const userId = await player();
      await db.update(tableRoundsTable).set({ bettingEndsAt: new Date(0) }).where(eq(tableRoundsTable.id, open.id));
      await assert.rejects(() => submit(open!, userId, [straight("1000")]), /BETTING_CLOSED/);
      assert.equal((await getBalanceByUser(userId)).balance, 100000000n);
      await close(open);
    });
  } finally {
    if (open) {
      const [current] = await db.select().from(tableRoundsTable).where(eq(tableRoundsTable.id, open.id));
      if (current && ["betting", "reveal", "settling"].includes(current.phase)) await recoverTableRound(current, Date.now() + 1000000);
    }
  }
});
