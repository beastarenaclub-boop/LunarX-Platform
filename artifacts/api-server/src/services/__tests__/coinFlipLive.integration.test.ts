import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import {
  db,
  usersTable,
  betsTable,
  walletLedgerTable,
  tableRoundsTable,
  tableRoundBetsTable,
  gameConfigTable,
} from "@workspace/db";
import { ready, memory } from "../../demo/database";
import {
  createTableRound,
  revealTableRound,
  settleTableRound,
  finishTableRound,
  getTableRoundSnapshot,
  recoverTableRound,
  isOutcomeDisclosed,
  outcomeDiscloseAt,
} from "../tableRounds";
import {
  placeCoinLive,
  settleCoinLive,
  coinLiveHistory,
} from "../coinFlipLive";
import { postEntry, getBalanceByUser as balanceByUser } from "../wallet";
import { invalidateConfigCache } from "../rtp";
import {
  collectionPayout,
  coinLiveMultiplier,
} from "@workspace/api-zod/instant-collection";

before(async () => {
  await ready;
  await db
    .insert(gameConfigTable)
    .values({
      gameCode: "coin-flip",
      enabled: true,
      houseEdge: 0.03,
      minStakePaise: 100n,
      maxStakePaise: 1000000n,
      maxMultiplier: 1000,
    })
    .onConflictDoNothing();
  invalidateConfigCache();
});
after(async () => {
  await memory.close();
});
async function user(balance = 100000n) {
  const id = randomUUID();
  await db.insert(usersTable).values({
    id,
    email: `${id}@example.test`,
    emailNormalized: `${id}@example.test`,
    passwordHash: "unused",
  });
  if (balance)
    await postEntry({
      userId: id,
      type: "adjustment",
      amount: balance,
      memo: "Volatile coin test funds",
    });
  return id;
}
const getBalanceByUser = async (id: string) =>
  (await balanceByUser(id)).balance;
const input = (
  roundId: string,
  side: "heads" | "tails" = "heads",
  stakeAmount = "10000",
) => ({ roundId, side, stakeAmount });
async function completed(round: Awaited<ReturnType<typeof createTableRound>>) {
  const ended = new Date(Date.now() - 100);
  const [updated] = await db
    .update(tableRoundsTable)
    .set({ bettingEndsAt: ended, revealEndsAt: ended, settleEndsAt: ended })
    .where(eq(tableRoundsTable.id, round.id))
    .returning();
  const revealed = await revealTableRound(updated);
  const settled = await settleTableRound(revealed);
  await finishTableRound(settled);
  return settled;
}

test("shared 30 second clock and private outcome until the palm reveal", async () => {
  const r = await createTableRound("coin-flip");
  const c = r.config as any;
  assert.equal(c.bettingWindowMs, 15000);
  assert.equal(c.revealDurationMs, 10000);
  assert.equal(c.settleDurationMs, 5000);
  assert.equal(
    r.settleEndsAt.getTime() - (r.bettingEndsAt.getTime() - c.bettingWindowMs),
    30000,
  );
  const revealed = await revealTableRound(r);
  assert.equal(outcomeDiscloseAt(revealed), r.revealEndsAt.getTime());
  assert.equal(
    isOutcomeDisclosed(revealed, r.revealEndsAt.getTime() - 1),
    false,
  );
  assert.equal(isOutcomeDisclosed(revealed, r.revealEndsAt.getTime()), true);
  const a = await getTableRoundSnapshot("coin-flip", await user()),
    b = await getTableRoundSnapshot("coin-flip", await user());
  assert.equal(a!.roundId, b!.roundId);
  assert.equal(a!.outcome, null);
  assert.equal(a!.serverSeed, null);
  await completed(revealed);
});

test("one shared result settles opposite bets exactly once, with exact paise", async () => {
  const a = await user(),
    b = await user(),
    r = await createTableRound("coin-flip");
  await placeCoinLive(a, input(r.id, "heads", "10101"));
  await placeCoinLive(b, input(r.id, "tails", "10101"));
  const settled = await completed(r);
  await settleCoinLive(settled);
  await settleCoinLive(settled);
  const ha = (await coinLiveHistory(a))[0],
    hb = (await coinLiveHistory(b))[0];
  assert.deepEqual(ha.outcome, hb.outcome);
  assert.notEqual(ha.status, hb.status);
  const paid = collectionPayout(10101n, coinLiveMultiplier(0.97, 1000));
  assert.equal(paid, 19595n);
  const winner = ha.status === "won" ? a : b,
    loser = winner === a ? b : a;
  assert.equal(await getBalanceByUser(winner), 100000n - 10101n + paid);
  assert.equal(await getBalanceByUser(loser), 89899n);
  const wins = await db
    .select()
    .from(walletLedgerTable)
    .where(
      and(
        eq(walletLedgerTable.userId, winner),
        eq(walletLedgerTable.type, "win"),
      ),
    );
  assert.equal(wins.length, 1);
});

test("parallel duplicate requests and changed selections cannot double debit", async () => {
  const id = await user(),
    r = await createTableRound("coin-flip"),
    i = input(r.id);
  const [a, b] = await Promise.all([
    placeCoinLive(id, i),
    placeCoinLive(id, i),
  ]);
  assert.equal(a.slipId, b.slipId);
  assert.equal(await getBalanceByUser(id), 90000n);
  await assert.rejects(
    placeCoinLive(id, input(r.id, "tails")),
    /already confirmed/,
  );
  const settled = await completed(r);
  const before = await getBalanceByUser(id);
  await placeCoinLive(id, i);
  assert.equal(await getBalanceByUser(id), before);
  assert.equal((await coinLiveHistory(id))[0].tableRoundId, settled.id);
});

test("late, invalid and unfunded bets are rejected without ledger or slips", async () => {
  const id = await user(500n),
    r = await createTableRound("coin-flip");
  await assert.rejects(placeCoinLive(id, input(r.id)), /Insufficient/);
  await assert.rejects(placeCoinLive(id, input(r.id, "heads", "0")), /Invalid/);
  await assert.rejects(placeCoinLive(id, input(r.id, "heads", "99")), /limits/);
  await assert.rejects(
    placeCoinLive(id, input(r.id, "heads", "1000001")),
    /limits/,
  );
  await db
    .update(tableRoundsTable)
    .set({ bettingEndsAt: new Date(Date.now() - 1) })
    .where(eq(tableRoundsTable.id, r.id));
  await assert.rejects(
    placeCoinLive(id, input(r.id, "heads", "100")),
    /closed/,
  );
  assert.equal(await getBalanceByUser(id), 500n);
  const slips = await db
    .select()
    .from(tableRoundBetsTable)
    .where(eq(tableRoundBetsTable.userId, id));
  assert.equal(slips.length, 0);
  await completed(r);
});

test("restart refunds an unrevealed wager atomically and only once", async () => {
  const id = await user(),
    r = await createTableRound("coin-flip");
  await placeCoinLive(id, input(r.id));
  await recoverTableRound(r);
  await recoverTableRound(r);
  assert.equal(await getBalanceByUser(id), 100000n);
  const refunds = await db
    .select()
    .from(walletLedgerTable)
    .where(
      and(
        eq(walletLedgerTable.userId, id),
        eq(walletLedgerTable.type, "refund"),
      ),
    );
  assert.equal(refunds.length, 1);
  const [bet] = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.userId, id));
  assert.equal(bet.status, "voided");
  assert.equal(bet.payoutAmount, 10000n);
  const history = await coinLiveHistory(id);
  assert.equal(history[0].slipStatus, "refunded");
  assert.equal(history[0].payoutAmount, "10000");
  assert.deepEqual(history[0].outcome, []);
});

test("restart preserves a revealed outcome and settles it once after expiry", async () => {
  const id = await user(),
    r = await createTableRound("coin-flip");
  await placeCoinLive(id, input(r.id));
  const revealed = await revealTableRound(r),
    outcome = revealed.outcome;
  assert.equal((await recoverTableRound(revealed))?.id, r.id);
  await recoverTableRound(revealed, r.settleEndsAt.getTime() + 1);
  await recoverTableRound(revealed, r.settleEndsAt.getTime() + 1);
  const [persisted] = await db
    .select()
    .from(tableRoundsTable)
    .where(eq(tableRoundsTable.id, r.id));
  assert.deepEqual(persisted.outcome, outcome);
  assert.equal(persisted.phase, "settled");
  assert.equal((await coinLiveHistory(id)).length, 1);
});

test("all players see rounds continue without any wager", async () => {
  const id = await user(),
    before = await getBalanceByUser(id);
  const r = await createTableRound("coin-flip");
  await completed(r);
  const next = await createTableRound("coin-flip"),
    snap = await getTableRoundSnapshot("coin-flip", id);
  assert.equal(snap!.roundId, next.id);
  assert.ok(snap!.recent.some((x) => x.roundId === r.id));
  assert.equal(snap!.myBets.length, 0);
  assert.equal(await getBalanceByUser(id), before);
  await completed(next);
});

test("restart recovery cannot strand a wager racing admission", async () => {
  const id = await user(),
    r = await createTableRound("coin-flip");
  await Promise.allSettled([
    placeCoinLive(id, input(r.id)),
    recoverTableRound(r),
  ]);
  assert.equal(await getBalanceByUser(id), 100000n);
  const slips = await db
    .select()
    .from(tableRoundBetsTable)
    .where(eq(tableRoundBetsTable.roundId, r.id));
  assert.ok(slips.every((s) => s.status === "refunded"));
  const [round] = await db
    .select()
    .from(tableRoundsTable)
    .where(eq(tableRoundsTable.id, r.id));
  assert.equal(round.phase, "voided");
  await assert.rejects(placeCoinLive(await user(), input(r.id)), /closed/);
});

test("payout uses the accepted round's cap despite later config changes", async () => {
  await db
    .update(gameConfigTable)
    .set({ maxMultiplier: 1.5 })
    .where(eq(gameConfigTable.gameCode, "coin-flip"));
  invalidateConfigCache();
  const a = await user(),
    b = await user(),
    r = await createTableRound("coin-flip");
  await placeCoinLive(a, input(r.id, "heads", "10101"));
  await placeCoinLive(b, input(r.id, "tails", "10101"));
  await db
    .update(gameConfigTable)
    .set({ maxMultiplier: 1000 })
    .where(eq(gameConfigTable.gameCode, "coin-flip"));
  invalidateConfigCache();
  await completed(r);
  const receipts = [
    ...(await coinLiveHistory(a)),
    ...(await coinLiveHistory(b)),
  ];
  assert.equal(receipts.find((r) => r.status === "won")!.payoutAmount, "15151");
});
