import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  betsTable,
  tableRoundsTable,
  tableRoundBetsTable,
  type TableRound,
} from "@workspace/db";
import {
  L7_GAME,
  L7_VERSION,
  normalizeL7Bets,
  l7Stake,
  l7Payout,
  validCard,
  type L7Bet,
  type L7Card,
  type L7History,
} from "@workspace/api-zod/lucky7-live";
import { badRequest, conflict, notFound } from "../lib/errors";
import { requireGameConfig, sha256Hex } from "./rtp";
import { postEntry, publishWalletBalance } from "./wallet";
import { deriveL7Card } from "./lucky7LiveMath";
import type { RoundConfigSnapshot } from "./tableRounds";

export async function placeL7Live(
  userId: string,
  roundId: string,
  raw: L7Bet[],
) {
  let bets: L7Bet[];
  try {
    bets = normalizeL7Bets(raw);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  const stake = l7Stake(bets),
    config = await requireGameConfig(L7_GAME);
  let balance: bigint | undefined;
  const receipt = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`l7-live:${roundId}:${userId}`}, 0))`,
    );
    const [prior] = await tx
      .select()
      .from(tableRoundBetsTable)
      .where(
        and(
          eq(tableRoundBetsTable.roundId, roundId),
          eq(tableRoundBetsTable.userId, userId),
          eq(tableRoundBetsTable.gameCode, L7_GAME),
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
          eq(tableRoundsTable.gameCode, L7_GAME),
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
        gameCode: L7_GAME,
        roundId,
        stakeAmount: stake,
        status: "placed",
        metadata: {
          lucky7CardVersion: cfg.lucky7CardVersion,
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
            memo: "Lucky 7 Live table bet",
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
        gameCode: L7_GAME,
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
export async function settleL7Live(round: TableRound) {
  const card = round.outcome as L7Card;
  if (round.gameCode !== L7_GAME || !validCard(card))
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
        throw new Error("L7_SLIP_STATE_MISMATCH");
      const payout = l7Payout(
        slip.bets as L7Bet[],
        card,
        cfg.lucky7CardVersion ?? L7_VERSION,
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
              memo: `Lucky 7 Live · ${card.rank} ${card.suit}`,
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

export async function l7History(userId: string): Promise<L7History[]> {
  const rows = await db
    .select({ slip: tableRoundBetsTable, round: tableRoundsTable })
    .from(tableRoundBetsTable)
    .innerJoin(
      tableRoundsTable,
      eq(tableRoundBetsTable.roundId, tableRoundsTable.id),
    )
    .where(
      and(
        eq(tableRoundBetsTable.gameCode, L7_GAME),
        eq(tableRoundBetsTable.userId, userId),
      ),
    )
    .orderBy(desc(tableRoundBetsTable.createdAt))
    .limit(30);
  return rows.map(({ slip, round }) => ({
    roundId: round.id,
    card: slip.status === "settled" ? (round.outcome as L7Card) : null,
    bets: slip.bets as L7Bet[],
    totalStake: String(slip.totalStake),
    payoutAmount: String(slip.payoutAmount),
    status: slip.status,
    createdAt: slip.createdAt.toISOString(),
  }));
}

export async function verifyL7Live(id: string) {
  const [round] = await db
    .select()
    .from(tableRoundsTable)
    .where(
      and(eq(tableRoundsTable.id, id), eq(tableRoundsTable.gameCode, L7_GAME)),
    )
    .limit(1);
  if (!round) throw notFound("Round not found.");
  if (round.phase !== "settled")
    throw badRequest("Verification is available after settlement.");
  const derived = deriveL7Card(round.serverSeed, round.clientSeed, round.nonce);
  return {
    roundId: id,
    serverSeed: round.serverSeed,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    card: round.outcome,
    derived,
    version: (round.config as RoundConfigSnapshot).lucky7CardVersion,
    verified:
      sha256Hex(round.serverSeed) === round.serverSeedHash &&
      JSON.stringify(derived) === JSON.stringify(round.outcome),
  };
}
