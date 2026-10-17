import { DRAGON_TIGER_RETURNS } from "@workspace/api-zod/game-economics";
import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  dragonTigerPlayersTable as players,
  dragonTigerRoundsTable as rounds,
  dragonTigerBetsTable as bets,
} from "@workspace/db";
import { badRequest, conflict } from "../lib/errors";
import { logger } from "../lib/logger";
import { ensureWallet, getBalance, getBalanceByUser, postEntry, publishWalletBalance } from "./wallet";
import {
  BETTING_MS,
  DEALING_MS,
  RESULT_MS,
  drawDragonTiger,
  dragonTigerWinner,
  dragonTigerStake,
  dragonTigerPayoutPaise,
  type DragonTigerSpots,
} from "./dragonTigerMath";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The transaction lock also serializes multiple API workers and restart recovery. */
async function advance(tx: Tx, now: number, changed: Set<string>) {
  let [round] = await tx
    .select()
    .from(rounds)
    .orderBy(desc(rounds.id))
    .limit(1);
  if (round && !round.settledAt && now >= round.revealsAt.getTime()) {
    const winner = dragonTigerWinner(round.dragon, round.tiger);
    const slips = await tx
      .select()
      .from(bets)
      .where(eq(bets.roundId, round.id));
    for (const slip of slips) {
      if (slip.payout !== null) continue;
      const payoutPaise = dragonTigerPayoutPaise(slip.spots, winner, round);
      const payout = Number(payoutPaise) / 100;
      const net = (Number(payoutPaise - BigInt(slip.stake) * 100n) / 100).toFixed(2);
      if (payout > 0 && slip.walletFunded) {
        await postEntry({ userId: slip.userId, scope: "dragon-tiger", type: "win",
          amount: payoutPaise, refType: "dragon_tiger_payout", refId: String(slip.id) }, tx);
        changed.add(slip.userId);
      }
      await tx
        .update(players)
        .set({
          net: sql`${players.net} + ${net}::numeric`,
          played: sql`${players.played} + 1`,
          wins: sql`${players.wins} + ${payout > slip.stake ? 1 : 0}`,
        })
        .where(eq(players.userId, slip.userId));
      await tx.update(bets).set({ payout }).where(eq(bets.id, slip.id));
    }
    [round] = await tx
      .update(rounds)
      .set({ settledAt: new Date(now) })
      .where(eq(rounds.id, round.id))
      .returning();
  }
  if (!round || now >= round.endsAt.getTime()) {
    [round] = await tx
      .insert(rounds)
      .values({
        ...drawDragonTiger(),
        ...DRAGON_TIGER_RETURNS,
        closesAt: new Date(now + BETTING_MS),
        revealsAt: new Date(now + BETTING_MS + DEALING_MS),
        endsAt: new Date(now + BETTING_MS + DEALING_MS + RESULT_MS),
      })
      .returning();
  }
  return round;
}

async function snapshot(
  tx: Tx,
  round: typeof rounds.$inferSelect,
  userId: string,
  now: number,
  walletId: string,
) {
  const [player] = await tx
    .select()
    .from(players)
    .where(eq(players.userId, userId));
  const [myBet] = await tx
    .select()
    .from(bets)
    .where(and(eq(bets.roundId, round.id), eq(bets.userId, userId)));
  const ranking = await tx
    .select({
      userId: players.userId,
      name: usersTable.displayName,
      net: players.net,
      wins: players.wins,
      played: players.played,
    })
    .from(players)
    .innerJoin(usersTable, eq(usersTable.id, players.userId))
    .where(and(gt(players.played, 0), eq(usersTable.status, "active")))
    .orderBy(desc(players.net), desc(players.wins), asc(players.userId))
    .limit(10);
  const [{ ahead }] = await tx
    .select({ ahead: sql<number>`count(*)::int` })
    .from(players)
    .innerJoin(usersTable, eq(usersTable.id, players.userId))
    .where(
      and(
        gt(players.played, 0),
        eq(usersTable.status, "active"),
        sql`(
      ${players.net} > ${player.net} or
      (${players.net} = ${player.net} and ${players.wins} > ${player.wins}) or
      (${players.net} = ${player.net} and ${players.wins} = ${player.wins} and ${players.userId} < ${userId})
    )`,
      ),
    );
  const history = await tx
    .select()
    .from(rounds)
    .where(isNotNull(rounds.settledAt))
    .orderBy(desc(rounds.id))
    .limit(24);
  const [lastResult] = await tx
    .select({
      roundId: bets.roundId,
      stake: bets.stake,
      payout: bets.payout,
    })
    .from(bets)
    .where(and(eq(bets.userId, userId), isNotNull(bets.payout)))
    .orderBy(desc(bets.id))
    .limit(1);
  const [{ online }] = await tx
    .select({ online: sql<number>`count(*)::int` })
    .from(players)
    .where(gt(players.lastSeen, new Date(now - 45_000)));
  const phase =
    now < round.closesAt.getTime()
      ? "betting"
      : now < round.revealsAt.getTime()
        ? "dealing"
        : "result";
  return {
    serverNow: now,
    mode: "wallet" as const,
    online,
    round: {
      mainProfitPaisePerRupee: round.mainProfitPaisePerRupee,
      tieProfitPaisePerRupee: round.tieProfitPaisePerRupee,
      id: round.id,
      phase,
      closesAt: round.closesAt.getTime(),
      revealsAt: round.revealsAt.getTime(),
      endsAt: round.endsAt.getTime(),
      // No outcome or card data leaves the server until both cards are revealed.
      ...(phase === "result"
        ? {
            dragon: round.dragon % 52,
            tiger: round.tiger % 52,
            winner: dragonTigerWinner(round.dragon, round.tiger),
          }
        : {}),
    },
    player: {
      balance: Number(await getBalance(walletId, tx)) / 100,
      net: player.net,
      wins: player.wins,
      played: player.played,
      rank: player.played ? ahead + 1 : null,
    },
    myBet: myBet
      ? { spots: myBet.spots, stake: myBet.stake, payout: myBet.payout }
      : null,
    lastResult: lastResult ?? null,
    leaderboard: ranking.map((p, index) => ({
      ...p,
      name: p.name || "Player",
      rank: index + 1,
    })),
    history: history.map((r) => ({
      id: r.id,
      dragon: r.dragon % 52,
      tiger: r.tiger % 52,
      winner: dragonTigerWinner(r.dragon, r.tiger),
    })),
  };
}

export async function dragonTigerTable(
  userId: string,
  input?: { roundId: number; spots: DragonTigerSpots },
) {
  const wallet = await ensureWallet(userId);
  const changed = new Set<string>();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73482105)`);
    // Read the clock after acquiring the lock, so queued requests cannot bet late.
    const [{ nowMs }] = (
      await tx.execute<{ nowMs: string }>(
        sql`select (extract(epoch from clock_timestamp()) * 1000)::bigint::text as "nowMs"`,
      )
    ).rows;
    const now = Number(nowMs);
    await tx
      .insert(players)
      .values({ userId, lastSeen: new Date(now) })
      .onConflictDoUpdate({
        target: players.userId,
        set: { lastSeen: new Date(now) },
      });
    const round = await advance(tx, now, changed);
    if (input) {
      if (input.roundId !== round.id)
        throw conflict("The round changed. Place your bet in the new round.");
      const [existing] = await tx
        .select()
        .from(bets)
        .where(and(eq(bets.roundId, round.id), eq(bets.userId, userId)));
      if (existing) {
        // Retrying an acknowledged or interrupted identical request never debits twice.
        if (
          ["dragon", "tiger", "tie"].some(
            (side) =>
              existing.spots[side as keyof DragonTigerSpots] !==
              input.spots[side as keyof DragonTigerSpots],
          )
        )
          throw conflict("Your bet for this round is already confirmed.");
      } else {
        if (now >= round.closesAt.getTime())
          throw conflict("Betting is closed. Wait for the next round.");
        let stake: number;
        try {
          stake = dragonTigerStake(input.spots);
        } catch (error) {
          throw badRequest((error as Error).message);
        }
        try {
          await postEntry({ userId, scope: "dragon-tiger", type: "bet",
            amount: -BigInt(stake) * 100n, refType: "dragon_tiger_bet",
            refId: `${round.id}:${userId}` }, tx);
        } catch (error) {
          if ((error as Error).message === "INSUFFICIENT_FUNDS")
            throw badRequest("You do not have enough wallet balance.");
          throw error;
        }
        changed.add(userId);
        await tx
          .insert(bets)
          .values({ roundId: round.id, userId, spots: input.spots, stake });
      }
    }
    return snapshot(tx, round, userId, now, wallet.id);
  });
  for (const id of changed) {
    const { balance } = await getBalanceByUser(id);
    publishWalletBalance({ userId: id, balance, entryType: "adjustment", amount: 0n });
  }
  return result;
}

/** Settle confirmed bets even after their player leaves the game screen. */
export function startDragonTigerEngine() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const changed = new Set<string>();
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(73482105)`);
        await advance(tx, Date.now(), changed);
      });
      for (const userId of changed) {
        const { balance } = await getBalanceByUser(userId);
        publishWalletBalance({ userId, balance, entryType: "win", amount: 0n });
      }
    } catch (error) { logger.error({ error }, "Dragon Tiger settlement failed"); }
    finally { busy = false; }
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
