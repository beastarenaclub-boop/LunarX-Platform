import { and, desc, eq, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import {
  db,
  betsTable,
  tableRoundsTable,
  tableRoundBetsTable,
  type TableRound,
} from "@workspace/db";
import {
  W20_GAME,
  W20_VERSION,
  normalizeW20Bets,
  w20Stake,
  w20Payout,
  validW20Outcome,
  type W20Bet,
  type W20Outcome,
  type W20History,
} from "@workspace/api-zod/wheel20-live";
import { badRequest, conflict, notFound } from "../lib/errors";
import { requireGameConfig, sha256Hex } from "./rtp";
import { postEntry, publishWalletBalance } from "./wallet";
import { deriveW20Outcome } from "./wheel20LiveMath";
import type { RoundConfigSnapshot } from "./tableRounds";

export async function placeW20Live(
  userId: string,
  roundId: string,
  raw: W20Bet[],
) {
  let bets: W20Bet[];
  try {
    bets = normalizeW20Bets(raw);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  const stake = w20Stake(bets),
    config = await requireGameConfig(W20_GAME);
  let balance: bigint | undefined;
  const receipt = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`w20-live:${roundId}:${userId}`}, 0))`,
    );
    const [prior] = await tx
      .select()
      .from(tableRoundBetsTable)
      .where(
        and(
          eq(tableRoundBetsTable.roundId, roundId),
          eq(tableRoundBetsTable.userId, userId),
          eq(tableRoundBetsTable.gameCode, W20_GAME),
        ),
      )
      .limit(1);
    if (prior) {
      if (JSON.stringify(prior.bets) !== JSON.stringify(bets))
        throw conflict("Your bets are already confirmed for this round.");
      return {
        slipId: prior.id,
        roundId,
        totalStake: String(prior.totalStake),
        status: prior.status,
      };
    }
    const [round] = await tx
      .select()
      .from(tableRoundsTable)
      .where(
        and(
          eq(tableRoundsTable.id, roundId),
          eq(tableRoundsTable.gameCode, W20_GAME),
        ),
      )
      .for("update");
    const clock = async () =>
      Number(
        (
          await tx.execute<{ now: string }>(
            sql`select (extract(epoch from clock_timestamp()) * 1000)::bigint::text as now`,
          )
        ).rows[0].now,
      );
    if (
      !round ||
      round.phase !== "betting" ||
      round.bettingEndsAt.getTime() <= (await clock())
    )
      throw badRequest("Betting is closed. Please wait for the next round.");
    if (!config.enabled) throw badRequest("This table is paused.");
    const cfg = round.config as RoundConfigSnapshot;
    if (stake < BigInt(cfg.minStakePaise) || stake > BigInt(cfg.maxStakePaise))
      throw badRequest("Your total bet is outside the table limits.");
    const [bet] = await tx
      .insert(betsTable)
      .values({
        userId,
        gameCode: W20_GAME,
        roundId,
        stakeAmount: stake,
        status: "placed",
        metadata: {
          wheel20Version: cfg.wheel20Version,
          bets,
          settlementMode: "house_edge",
        },
      })
      .returning();
    try {
      balance = (
        await postEntry(
          {
            userId,
            type: "bet",
            amount: -stake,
            refType: "bet",
            refId: bet.id,
            memo: "Wheel 2.0 Live table bet",
          },
          tx,
        )
      ).entry.balanceAfter;
    } catch (e) {
      if ((e as Error).message === "INSUFFICIENT_FUNDS")
        throw badRequest("Insufficient wallet balance.");
      throw e;
    }
    const [slip] = await tx
      .insert(tableRoundBetsTable)
      .values({
        roundId,
        gameCode: W20_GAME,
        userId,
        betId: bet.id,
        bets,
        totalStake: stake,
      })
      .returning();
    if (round.bettingEndsAt.getTime() <= (await clock()))
      throw badRequest(
        "Betting closed before confirmation. No money was taken.",
      );
    await tx
      .update(tableRoundsTable)
      .set({
        totalStake: sql`${tableRoundsTable.totalStake} + ${stake}`,
        playerCount: sql`${tableRoundsTable.playerCount} + 1`,
      })
      .where(eq(tableRoundsTable.id, roundId));
    return {
      slipId: slip.id,
      roundId,
      totalStake: String(stake),
      status: "pending",
    };
  });
  if (balance !== undefined)
    publishWalletBalance({ userId, balance, amount: -stake, entryType: "bet" });
  return receipt;
}

/** Receipt, ledger credit and bet settlement are one atomic, idempotent transaction. */
export async function settleW20Live(round: TableRound) {
  const outcome = round.outcome as W20Outcome;
  if (round.gameCode !== W20_GAME || !validW20Outcome(outcome))
    throw new Error("OUTCOME_MISSING");
  const cfg = round.config as RoundConfigSnapshot;
  const pending = await db
    .select({ id: tableRoundBetsTable.id })
    .from(tableRoundBetsTable)
    .where(
      and(
        eq(tableRoundBetsTable.roundId, round.id),
        eq(tableRoundBetsTable.status, "pending"),
      ),
    );
  for (const { id } of pending) {
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
        throw new Error("W20_SLIP_STATE_MISMATCH");
      const payout = w20Payout(
        slip.bets as W20Bet[],
        outcome,
        cfg.wheel20Version ?? W20_VERSION,
      );
      let balance: bigint | undefined;
      if (payout > 0n)
        balance = (
          await postEntry(
            {
              userId: slip.userId,
              type: "win",
              amount: payout,
              refType: "bet",
              refId: bet.id,
              memo: `Wheel 2.0 Live · ${outcome.winner}`,
            },
            tx,
          )
        ).entry.balanceAfter;
      await tx
        .update(betsTable)
        .set({
          status: payout > 0n ? "won" : "lost",
          payoutAmount: payout,
          multiplier: Number(payout) / Number(slip.totalStake),
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
        .where(eq(tableRoundBetsTable.id, id));
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

export async function w20History(userId: string): Promise<W20History[]> {
  const rows = await db
    .select({ slip: tableRoundBetsTable, round: tableRoundsTable })
    .from(tableRoundBetsTable)
    .innerJoin(
      tableRoundsTable,
      eq(tableRoundBetsTable.roundId, tableRoundsTable.id),
    )
    .where(
      and(
        eq(tableRoundBetsTable.gameCode, W20_GAME),
        eq(tableRoundBetsTable.userId, userId),
      ),
    )
    .orderBy(desc(tableRoundBetsTable.createdAt))
    .limit(30);
  return rows.map(({ slip, round }) => ({
    roundId: round.id,
    outcome: slip.status === "settled" ? (round.outcome as W20Outcome) : null,
    bets: slip.bets as W20Bet[],
    totalStake: String(slip.totalStake),
    payoutAmount: String(slip.payoutAmount),
    status: slip.status,
    createdAt: slip.createdAt.toISOString(),
  }));
}

export async function verifyW20Live(id: string) {
  const [round] = await db
    .select()
    .from(tableRoundsTable)
    .where(
      and(eq(tableRoundsTable.id, id), eq(tableRoundsTable.gameCode, W20_GAME)),
    )
    .limit(1);
  if (!round) throw notFound("Round not found.");
  if (round.phase !== "settled")
    throw badRequest("Verification is available after settlement.");
  const derived = deriveW20Outcome(
    round.serverSeed,
    round.clientSeed,
    round.nonce,
  );
  return {
    roundId: id,
    serverSeed: round.serverSeed,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    outcome: round.outcome,
    derived,
    version: (round.config as RoundConfigSnapshot).wheel20Version,
    verified:
      sha256Hex(round.serverSeed) === round.serverSeedHash &&
      isDeepStrictEqual(derived, round.outcome),
  };
}
