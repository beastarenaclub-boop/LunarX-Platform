import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  betsTable,
  tableRoundsTable,
  tableRoundBetsTable,
  type TableRound,
  type TableRoundBet,
} from "@workspace/db";
import {
  collectionPayout,
  coinLiveMultiplier,
  normalizeCoinLiveBet,
  type CoinLiveInput,
  type CoinLiveOutcome,
  type CoinLiveReceipt,
} from "@workspace/api-zod/instant-collection";
import { badRequest, conflict } from "../lib/errors";
import { requireGameConfig } from "./rtp";
import { postEntry, publishWalletBalance } from "./wallet";
import type { RoundConfigSnapshot } from "./tableRounds";

const CODE = "coin-flip";

type CoinTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function refundCoinSlip(tx: CoinTransaction, slip: TableRoundBet) {
  const [bet] = await tx
    .select()
    .from(betsTable)
    .where(eq(betsTable.id, slip.betId))
    .for("update");
  if (!bet || bet.status !== "placed")
    throw new Error("COIN_REFUND_STATE_MISMATCH");
  const credit = await postEntry(
    {
      userId: slip.userId,
      type: "refund",
      amount: slip.totalStake,
      refType: "bet",
      refId: slip.betId,
      memo: "Coin Flip interrupted round refund",
    },
    tx,
  );
  await tx
    .update(betsTable)
    .set({
      status: "voided",
      payoutAmount: slip.totalStake,
      settledAt: new Date(),
    })
    .where(eq(betsTable.id, slip.betId));
  await tx
    .update(tableRoundBetsTable)
    .set({ status: "refunded", payoutAmount: slip.totalStake })
    .where(eq(tableRoundBetsTable.id, slip.id));
  return {
    userId: slip.userId,
    balance: credit.entry.balanceAfter,
    amount: slip.totalStake,
    entryType: "refund" as const,
  };
}
export async function refundCoinLive(slipId: string) {
  const wallet = await db.transaction(async (tx) => {
    const [slip] = await tx
      .select()
      .from(tableRoundBetsTable)
      .where(
        and(
          eq(tableRoundBetsTable.id, slipId),
          eq(tableRoundBetsTable.gameCode, CODE),
        ),
      )
      .for("update");
    return !slip || slip.status !== "pending" ? null : refundCoinSlip(tx, slip);
  });
  if (wallet) publishWalletBalance(wallet);
}
/** Lock admission and refund all accepted slips before marking an interrupted round void. */
export async function voidCoinLiveRound(
  roundId: string,
): Promise<TableRound | null> {
  const result = await db.transaction(async (tx) => {
    const [round] = await tx
      .select()
      .from(tableRoundsTable)
      .where(
        and(
          eq(tableRoundsTable.id, roundId),
          eq(tableRoundsTable.gameCode, CODE),
        ),
      )
      .for("update");
    if (!round || ["voided", "settled"].includes(round.phase))
      return { resumed: null, wallets: [] };
    if (round.phase !== "betting" || round.outcome !== null)
      return { resumed: round, wallets: [] };
    const slips = await tx
      .select()
      .from(tableRoundBetsTable)
      .where(
        and(
          eq(tableRoundBetsTable.roundId, roundId),
          eq(tableRoundBetsTable.status, "pending"),
        ),
      )
      .for("update");
    const wallets = [];
    for (const slip of slips) wallets.push(await refundCoinSlip(tx, slip));
    await tx
      .update(tableRoundsTable)
      .set({ phase: "voided", settledAt: new Date() })
      .where(eq(tableRoundsTable.id, roundId));
    return { resumed: null, wallets };
  });
  for (const wallet of result.wallets) publishWalletBalance(wallet);
  return result.resumed;
}

/** One wager per player and shared round; an ambiguous response retries this identity. */
export async function placeCoinLive(userId: string, input: CoinLiveInput) {
  const entry = normalizeCoinLiveBet([
    { side: input.side, amount: input.stakeAmount },
  ]);
  const stake = BigInt(entry.amount),
    config = await requireGameConfig(CODE);
  let balance: bigint | undefined;
  const accepted = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`coin-live:${input.roundId}:${userId}`}, 0))`,
    );
    const [prior] = await tx
      .select()
      .from(tableRoundBetsTable)
      .where(
        and(
          eq(tableRoundBetsTable.roundId, input.roundId),
          eq(tableRoundBetsTable.userId, userId),
          eq(tableRoundBetsTable.gameCode, CODE),
        ),
      )
      .limit(1);
    if (prior) {
      if (JSON.stringify(prior.bets) !== JSON.stringify([entry]))
        throw conflict("Your bet is already confirmed for this round.");
      return {
        slipId: prior.id,
        roundId: input.roundId,
        totalStake: prior.totalStake.toString(),
        status: prior.status,
      };
    }
    const [round] = await tx
      .select()
      .from(tableRoundsTable)
      .where(
        and(
          eq(tableRoundsTable.id, input.roundId),
          eq(tableRoundsTable.gameCode, CODE),
        ),
      )
      .for("update");
    if (
      !round ||
      round.phase !== "betting" ||
      round.bettingEndsAt.getTime() <= Date.now()
    )
      throw badRequest("Betting is closed. Wait for the next round.");
    const cfg = round.config as RoundConfigSnapshot;
    if (!config.enabled) throw badRequest("This table is paused.");
    if (stake < BigInt(cfg.minStakePaise) || stake > BigInt(cfg.maxStakePaise))
      throw badRequest("Your bet is outside the table limits.");
    const [bet] = await tx
      .insert(betsTable)
      .values({
        userId,
        gameCode: CODE,
        roundId: round.id,
        stakeAmount: stake,
        status: "placed",
        metadata: {
          version: 2,
          coinLive: true,
          side: entry.side,
          settlementMode: "house_edge",
        },
      })
      .returning();
    try {
      const debit = await postEntry(
        {
          userId,
          type: "bet",
          amount: -stake,
          refType: "bet",
          refId: bet.id,
          memo: "Coin Flip stadium bet",
        },
        tx,
      );
      balance = debit.entry.balanceAfter;
    } catch (e) {
      if ((e as Error).message === "INSUFFICIENT_FUNDS")
        throw badRequest("Insufficient wallet balance.");
      throw e;
    }
    const [slip] = await tx
      .insert(tableRoundBetsTable)
      .values({
        roundId: round.id,
        gameCode: CODE,
        userId,
        betId: bet.id,
        bets: [entry],
        totalStake: stake,
      })
      .returning();
    if (round.bettingEndsAt.getTime() <= Date.now())
      throw badRequest("Betting closed before acceptance. No money was taken.");
    await tx
      .update(tableRoundsTable)
      .set({
        totalStake: sql`${tableRoundsTable.totalStake} + ${stake}`,
        playerCount: sql`${tableRoundsTable.playerCount} + 1`,
      })
      .where(eq(tableRoundsTable.id, round.id));
    return {
      slipId: slip.id,
      roundId: round.id,
      totalStake: stake.toString(),
      status: "pending",
    };
  });
  if (balance !== undefined)
    publishWalletBalance({ userId, balance, amount: -stake, entryType: "bet" });
  return accepted;
}

/** Settle from the persisted shared outcome. Bet, slip and exact paise credit are atomic. */
export async function settleCoinLive(round: TableRound) {
  const outcome = round.outcome as CoinLiveOutcome;
  if (
    !outcome ||
    !["heads", "tails"].includes(outcome.side) ||
    outcome.value !== (outcome.side === "heads" ? 0 : 1)
  )
    throw new Error("COIN_OUTCOME_MISSING");
  const cfg = round.config as RoundConfigSnapshot;
  const ids = await db
    .select({ id: tableRoundBetsTable.id })
    .from(tableRoundBetsTable)
    .where(
      and(
        eq(tableRoundBetsTable.roundId, round.id),
        eq(tableRoundBetsTable.status, "pending"),
      ),
    );
  for (const { id } of ids) {
    const wallet = await db.transaction(async (tx) => {
      const [slip] = await tx
        .select()
        .from(tableRoundBetsTable)
        .where(eq(tableRoundBetsTable.id, id))
        .for("update");
      if (!slip || slip.status !== "pending") return null;
      const [bet] = await tx
        .select()
        .from(betsTable)
        .where(eq(betsTable.id, slip.betId))
        .for("update");
      if (!bet || bet.status !== "placed")
        throw new Error("COIN_SLIP_STATE_MISMATCH");
      const entry = normalizeCoinLiveBet(slip.bets);
      const multiplier =
        entry.side === outcome.side
          ? coinLiveMultiplier(1 - cfg.houseEdge, cfg.maxMultiplier)
          : 0;
      const payout = collectionPayout(slip.totalStake, multiplier);
      let balance: bigint | undefined;
      if (payout > 0n) {
        const credit = await postEntry(
          {
            userId: slip.userId,
            type: "win",
            amount: payout,
            refType: "bet",
            refId: bet.id,
            memo: `Coin Flip · ${outcome.side}`,
          },
          tx,
        );
        balance = credit.entry.balanceAfter;
      }
      await tx
        .update(betsTable)
        .set({
          status: payout > 0n ? "won" : "lost",
          payoutAmount: payout,
          multiplier,
          settledAt: new Date(),
        })
        .where(eq(betsTable.id, bet.id));
      await tx
        .update(tableRoundBetsTable)
        .set({
          status: "settled",
          payoutAmount: payout,
          auditRoundId: round.id,
        })
        .where(eq(tableRoundBetsTable.id, slip.id));
      return balance === undefined
        ? null
        : {
            userId: slip.userId,
            balance,
            amount: payout,
            entryType: "win" as const,
          };
    });
    if (wallet) publishWalletBalance(wallet);
  }
  await db
    .update(tableRoundsTable)
    .set({
      totalPayout: sql`(select coalesce(sum(${tableRoundBetsTable.payoutAmount}), 0) from ${tableRoundBetsTable} where ${tableRoundBetsTable.roundId} = ${round.id} and ${tableRoundBetsTable.status} = 'settled')`,
    })
    .where(eq(tableRoundsTable.id, round.id));
}

export async function coinLiveHistory(
  userId: string,
): Promise<CoinLiveReceipt[]> {
  const rows = await db
    .select({ slip: tableRoundBetsTable, round: tableRoundsTable })
    .from(tableRoundBetsTable)
    .innerJoin(
      tableRoundsTable,
      eq(tableRoundBetsTable.roundId, tableRoundsTable.id),
    )
    .where(
      and(
        eq(tableRoundBetsTable.gameCode, CODE),
        eq(tableRoundBetsTable.userId, userId),
        inArray(tableRoundBetsTable.status, ["settled", "refunded"]),
      ),
    )
    .orderBy(desc(tableRoundBetsTable.createdAt))
    .limit(20);
  return rows.map(({ slip, round }) => {
    const cfg = round.config as RoundConfigSnapshot,
      entry = normalizeCoinLiveBet(slip.bets),
      refunded = slip.status === "refunded";
    return {
      id: slip.betId,
      tableRoundId: round.id,
      slipStatus: slip.status,
      gameCode: CODE,
      requestId: slip.id,
      status: refunded ? "cashed_out" : slip.payoutAmount > 0n ? "won" : "lost",
      stakeAmount: slip.totalStake.toString(),
      payoutAmount: slip.payoutAmount.toString(),
      cashoutAmount: slip.payoutAmount.toString(),
      multiplier: Number(slip.payoutAmount) / Number(slip.totalStake),
      step: 0,
      options: { difficulty: "easy", mines: 3, choice: entry.side },
      outcome: refunded ? [] : [(round.outcome as CoinLiveOutcome).value],
      revealed: [],
      hazards: null,
      serverSeed: refunded ? null : round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      createdAt: slip.createdAt.toISOString(),
      rtp: 1 - cfg.houseEdge,
      maxMultiplier: cfg.maxMultiplier,
    };
  });
}
