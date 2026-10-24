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
  JOKER_GAME,
  JOKER_VERSION,
  normalizeJokerBets,
  jokerStake,
  jokerPayout,
  validJokerOutcome,
  type JokerBet,
  type JokerOutcome,
  type JokerHistory,
} from "@workspace/api-zod/teenpatti-joker";
import { badRequest, conflict, notFound } from "../lib/errors";
import { requireGameConfig, sha256Hex } from "./rtp";
import { postEntry, publishWalletBalance } from "./wallet";
import { deriveJokerOutcome } from "./teenPattiJokerMath";
import type { RoundConfigSnapshot } from "./tableRounds";

export async function placeJokerBets(
  userId: string,
  roundId: string,
  raw: JokerBet[],
) {
  let bets: JokerBet[];
  try {
    bets = normalizeJokerBets(raw);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  const stake = jokerStake(bets),
    config = await requireGameConfig(JOKER_GAME);
  let balance: bigint | undefined;
  const receipt = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`joker-2020:${roundId}:${userId}`}, 0))`,
    );
    const [prior] = await tx
      .select()
      .from(tableRoundBetsTable)
      .where(
        and(
          eq(tableRoundBetsTable.roundId, roundId),
          eq(tableRoundBetsTable.userId, userId),
          eq(tableRoundBetsTable.gameCode, JOKER_GAME),
        ),
      )
      .limit(1);
    if (prior) {
      if (!isDeepStrictEqual(prior.bets, bets))
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
          eq(tableRoundsTable.gameCode, JOKER_GAME),
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
        gameCode: JOKER_GAME,
        roundId,
        stakeAmount: stake,
        status: "placed",
        metadata: {
          jokerVersion: cfg.jokerVersion,
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
            memo: "Teenpatti Joker 20-20 table bet",
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
        gameCode: JOKER_GAME,
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
export async function settleJokerBets(round: TableRound) {
  const outcome = round.outcome as JokerOutcome;
  if (round.gameCode !== JOKER_GAME || !validJokerOutcome(outcome))
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
        throw new Error("JOKER_SLIP_STATE_MISMATCH");
      const payout = jokerPayout(
        slip.bets as JokerBet[],
        outcome,
        cfg.jokerVersion ?? JOKER_VERSION,
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
              memo: `Teenpatti Joker 20-20 · ${outcome.winner}`,
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

export async function jokerHistory(userId: string): Promise<JokerHistory[]> {
  const rows = await db
    .select({ slip: tableRoundBetsTable, round: tableRoundsTable })
    .from(tableRoundBetsTable)
    .innerJoin(
      tableRoundsTable,
      eq(tableRoundBetsTable.roundId, tableRoundsTable.id),
    )
    .where(
      and(
        eq(tableRoundBetsTable.gameCode, JOKER_GAME),
        eq(tableRoundBetsTable.userId, userId),
      ),
    )
    .orderBy(desc(tableRoundBetsTable.createdAt))
    .limit(30);
  return rows.map(({ slip, round }) => ({
    roundId: round.id,
    outcome: slip.status === "settled" ? (round.outcome as JokerOutcome) : null,
    bets: slip.bets as JokerBet[],
    totalStake: String(slip.totalStake),
    payoutAmount: String(slip.payoutAmount),
    status: slip.status,
    createdAt: slip.createdAt.toISOString(),
  }));
}

export async function verifyJokerRound(id: string) {
  const [round] = await db
    .select()
    .from(tableRoundsTable)
    .where(
      and(
        eq(tableRoundsTable.id, id),
        eq(tableRoundsTable.gameCode, JOKER_GAME),
      ),
    )
    .limit(1);
  if (!round) throw notFound("Round not found.");
  if (round.phase !== "settled")
    throw badRequest("Verification is available after settlement.");
  const derived = deriveJokerOutcome(
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
    version: (round.config as RoundConfigSnapshot).jokerVersion,
    verified:
      sha256Hex(round.serverSeed) === round.serverSeedHash &&
      isDeepStrictEqual(derived, round.outcome),
  };
}
