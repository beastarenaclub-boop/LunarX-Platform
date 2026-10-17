import { and, desc, eq, sql } from "drizzle-orm";
import { db, betsTable, tableRoundsTable, tableRoundBetsTable, type TableRound } from "@workspace/db";
import { normalizeSevenBets, sevenPayout, type SevenBet, type CollectionRound } from "@workspace/api-zod/instant-collection";
import { badRequest, conflict } from "../lib/errors";
import { requireGameConfig } from "./rtp";
import { postEntry, publishWalletBalance } from "./wallet";
import type { RoundConfigSnapshot } from "./tableRounds";

export const SEVEN_CODE = "7up7down";
export type SevenOutcome = { dice: number[]; total: number };

/** One explicit slip per player/round. The round lock and ledger share a transaction. */
export async function placeSevenLive(userId: string, roundId: string, rawBets: SevenBet[]) {
  const stake = rawBets.reduce((sum, b) => sum + BigInt(b.amount), 0n);
  let bets: SevenBet[];
  try { bets = normalizeSevenBets(rawBets, stake); } catch (e) { throw badRequest((e as Error).message); }
  const config = await requireGameConfig(SEVEN_CODE);
  let balance: bigint | undefined;
  const accepted = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`seven-live:${roundId}:${userId}`}, 0))`);
    const [prior] = await tx.select().from(tableRoundBetsTable).where(and(eq(tableRoundBetsTable.roundId, roundId), eq(tableRoundBetsTable.userId, userId), eq(tableRoundBetsTable.gameCode, SEVEN_CODE))).limit(1);
    if (prior) {
      if (JSON.stringify(prior.bets) !== JSON.stringify(bets)) throw conflict("Your bet is already confirmed for this round.");
      return { slipId: prior.id, roundId, totalStake: prior.totalStake.toString(), status: prior.status };
    }
    const [round] = await tx.select().from(tableRoundsTable).where(and(eq(tableRoundsTable.id, roundId), eq(tableRoundsTable.gameCode, SEVEN_CODE))).for("update");
    if (!round || round.phase !== "betting" || round.bettingEndsAt.getTime() <= Date.now()) throw badRequest("Betting is closed. Choose your chips for the next round.");
    const cfg = round.config as RoundConfigSnapshot;
    if (!config.enabled) throw badRequest("This table is paused.");
    if (stake < BigInt(cfg.minStakePaise) || stake > BigInt(cfg.maxStakePaise) || stake <= 0n) throw badRequest("Your total bet is outside the table limits.");
    const [bet] = await tx.insert(betsTable).values({ userId, gameCode: SEVEN_CODE, roundId, stakeAmount: stake, status: "placed", metadata: { version: 2, sevenLive: true, bets, settlementMode: "house_edge" } }).returning();
    try {
      const debit = await postEntry({ userId, type: "bet", amount: -stake, refType: "bet", refId: bet.id, memo: "7 Up 7 Down table bet" }, tx);
      balance = debit.entry.balanceAfter;
    } catch (e) { if ((e as Error).message === "INSUFFICIENT_FUNDS") throw badRequest("Insufficient wallet balance."); throw e; }
    const [slip] = await tx.insert(tableRoundBetsTable).values({ roundId, gameCode: SEVEN_CODE, userId, betId: bet.id, bets, totalStake: stake }).returning();
    if (round.bettingEndsAt.getTime() <= Date.now()) throw badRequest("Betting closed before your bet was accepted. No money was taken.");
    await tx.update(tableRoundsTable).set({ totalStake: sql`${tableRoundsTable.totalStake} + ${stake}`, playerCount: sql`${tableRoundsTable.playerCount} + 1` }).where(eq(tableRoundsTable.id, roundId));
    return { slipId: slip.id, roundId, totalStake: stake.toString(), status: "pending" };
  });
  if (balance !== undefined) publishWalletBalance({ userId, balance, amount: -stake, entryType: "bet" });
  return accepted;
}

/** Exact paise credit, bet status and slip status commit together; restart/retry safe. */
export async function settleSevenLive(round: TableRound) {
  const outcome = round.outcome as SevenOutcome;
  if (!outcome?.dice || outcome.dice.length !== 2) throw new Error("OUTCOME_MISSING");
  const cfg = round.config as RoundConfigSnapshot;
  const slips = await db.select({ id: tableRoundBetsTable.id }).from(tableRoundBetsTable).where(and(eq(tableRoundBetsTable.roundId, round.id), eq(tableRoundBetsTable.status, "pending")));
  for (const { id } of slips) {
    const wallet = await db.transaction(async tx => {
      const [slip] = await tx.select().from(tableRoundBetsTable).where(eq(tableRoundBetsTable.id, id)).for("update");
      if (!slip || slip.status !== "pending") return null;
      const [bet] = await tx.select().from(betsTable).where(eq(betsTable.id, slip.betId)).for("update");
      if (!bet || bet.status !== "placed") throw new Error("SEVEN_SLIP_STATE_MISMATCH");
      const payout = sevenPayout(slip.bets as SevenBet[], outcome.dice, 1 - cfg.houseEdge, cfg.maxMultiplier);
      let balance: bigint | undefined;
      if (payout > 0n) {
        const credit = await postEntry({ userId: slip.userId, type: "win", amount: payout, refType: "bet", refId: bet.id, memo: `7 Up 7 Down · total ${outcome.total}` }, tx);
        balance = credit.entry.balanceAfter;
      }
      await tx.update(betsTable).set({ status: payout > 0n ? "won" : "lost", payoutAmount: payout, multiplier: Number(payout) / Number(slip.totalStake), settledAt: new Date() }).where(eq(betsTable.id, bet.id));
      await tx.update(tableRoundBetsTable).set({ status: "settled", payoutAmount: payout, auditRoundId: round.id }).where(eq(tableRoundBetsTable.id, slip.id));
      return balance === undefined ? null : { userId: slip.userId, balance, amount: payout, entryType: "win" as const };
    });
    if (wallet) publishWalletBalance(wallet);
  }
  await db.update(tableRoundsTable).set({ totalPayout: sql`(select coalesce(sum(${tableRoundBetsTable.payoutAmount}), 0) from ${tableRoundBetsTable} where ${tableRoundBetsTable.roundId} = ${round.id} and ${tableRoundBetsTable.status} = 'settled')` }).where(eq(tableRoundsTable.id, round.id));
}

export async function sevenLiveHistory(userId: string): Promise<CollectionRound[]> {
  const rows = await db.select({ slip: tableRoundBetsTable, round: tableRoundsTable }).from(tableRoundBetsTable).innerJoin(tableRoundsTable, eq(tableRoundBetsTable.roundId, tableRoundsTable.id)).where(and(eq(tableRoundBetsTable.gameCode, SEVEN_CODE), eq(tableRoundBetsTable.userId, userId), eq(tableRoundBetsTable.status, "settled"))).orderBy(desc(tableRoundBetsTable.createdAt)).limit(20);
  return rows.map(({ slip, round }) => {
    const cfg = round.config as RoundConfigSnapshot;
    return { id: round.id, gameCode: SEVEN_CODE, requestId: slip.id, status: slip.payoutAmount > 0n ? "won" : "lost", stakeAmount: slip.totalStake.toString(), payoutAmount: slip.payoutAmount.toString(), cashoutAmount: slip.payoutAmount.toString(), multiplier: Number(slip.payoutAmount) / Number(slip.totalStake), step: 0, options: { difficulty: "easy", mines: 3, choice: "up", bets: slip.bets as SevenBet[] }, outcome: (round.outcome as SevenOutcome).dice, revealed: [], hazards: null, serverSeed: round.serverSeed, serverSeedHash: round.serverSeedHash, clientSeed: round.clientSeed, createdAt: slip.createdAt.toISOString(), rtp: 1 - cfg.houseEdge, maxMultiplier: cfg.maxMultiplier };
  });
}
