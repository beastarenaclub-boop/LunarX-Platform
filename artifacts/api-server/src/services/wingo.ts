import { randomBytes, randomInt } from "node:crypto";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, wingoRoundsTable as rounds, wingoBetsTable as bets } from "@workspace/db";
import { DURATIONS, PAYOUT_VERSION, commitmentFor, multiplierFor } from "../../../3d-game/wingo-server/rules.mjs";
import { badRequest, conflict } from "../lib/errors";
import { logger } from "../lib/logger";
import { ensureWallet, getBalance, getBalanceByUser, postEntry, publishWalletBalance, type TxClient } from "./wallet";

const durationSchema = z.number().int().refine(value => DURATIONS.includes(value), "Choose a supported round duration.");
const betSchema = z.object({
  duration: durationSchema,
  period: z.string().regex(/^\d+-\d+$/),
  pick: z.string().regex(/^(green|red|violet|big|small|[0-9])$/),
  stake: z.number().int().min(100).max(1_000_000).multipleOf(100),
  request: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/),
  payoutVersion: z.number().int().min(1).max(PAYOUT_VERSION).optional(),
}).strict();
type BetInput = z.infer<typeof betSchema>;
const periodFor = (duration: number, time: number) => `${duration}-${Math.floor(time / (duration * 1000))}`;

async function serverTime(tx: TxClient) {
  const { rows } = await tx.execute<{ now: string }>(sql`select (extract(epoch from clock_timestamp()) * 1000)::bigint::text as now`);
  return Number(rows[0].now);
}

/** One transaction lock coordinates requests, settlement and multiple API workers. */
async function lock(tx: TxClient) {
  await tx.execute(sql`select pg_advisory_xact_lock(73482107)`);
}

async function advance(tx: TxClient, now: number, changed: Set<string>) {
  const overdue = await tx.select().from(rounds)
    .where(and(eq(rounds.settled, false), lte(rounds.ends, now)))
    .orderBy(asc(rounds.ends), asc(rounds.period));
  for (const round of overdue) {
    const slips = await tx.select().from(bets)
      .where(and(eq(bets.period, round.period), isNull(bets.payout)))
      .orderBy(asc(bets.userId), asc(bets.id));
    for (const slip of slips) {
      const payout = Math.round(slip.stake * multiplierFor(slip.pick, round.number, round.payoutVersion));
      if (payout > 0) {
        await postEntry({ userId: slip.userId, scope: "wingo", type: "win", amount: BigInt(payout),
          refType: "wingo_payout", refId: slip.id, memo: `Win Go ${round.duration}s return` }, tx);
        changed.add(slip.userId);
      }
      await tx.update(bets).set({ payout }).where(eq(bets.id, slip.id));
    }
    await tx.update(rounds).set({ settled: true }).where(eq(rounds.period, round.period));
  }
  for (const duration of DURATIONS) {
    const period = periodFor(duration, now);
    const [existing] = await tx.select({ period: rounds.period }).from(rounds).where(eq(rounds.period, period));
    if (existing) continue;
    const start = Math.floor(now / (duration * 1000)) * duration * 1000;
    const number = randomInt(10);
    const secret = randomBytes(32).toString("hex");
    await tx.insert(rounds).values({ period, duration, start, ends: start + duration * 1000,
      number, secret, payoutVersion: PAYOUT_VERSION, commitment: commitmentFor(period, number, secret) });
  }
}

async function snapshot(tx: TxClient, userId: string, walletId: string, duration: number, now: number) {
  const [round] = await tx.select({ period: rounds.period, duration: rounds.duration, start: rounds.start,
    ends: rounds.ends, payoutVersion: rounds.payoutVersion, commitment: rounds.commitment }).from(rounds).where(eq(rounds.period, periodFor(duration, now)));
  const history = await tx.select({ period: rounds.period, number: rounds.number, ends: rounds.ends,
    commitment: rounds.commitment, secret: rounds.secret }).from(rounds)
    .where(and(eq(rounds.duration, duration), eq(rounds.settled, true)))
    .orderBy(desc(rounds.ends)).limit(100);
  const myBets = await tx.select({ id: bets.id, period: bets.period, pick: bets.pick, stake: bets.stake,
    payout: bets.payout, created: bets.created, duration: rounds.duration,
    number: sql<number | null>`case when ${rounds.settled} then ${rounds.number} else null end`,
  }).from(bets).innerJoin(rounds, eq(bets.period, rounds.period))
    .where(eq(bets.userId, userId)).orderBy(desc(bets.created), desc(bets.id)).limit(100);
  const [summary] = await tx.select({
    played: sql<number>`count(*) filter (where ${bets.payout} is not null)::int`,
    won: sql<number>`count(*) filter (where ${bets.payout} > 0)::int`,
    profit: sql<number>`coalesce(sum(${bets.payout} - ${bets.stake}), 0)::float8`,
    pending: sql<number>`count(*) filter (where ${bets.payout} is null)::int`,
  }).from(bets).where(eq(bets.userId, userId));
  return {
    mode: "wallet" as const, serverTime: now,
    player: { id: userId.slice(0, 8), balance: Number(await getBalance(walletId, tx)) },
    round, history, bets: myBets,
    summary: { played: summary.played, won: summary.won, profit: summary.profit },
    pending: summary.pending, lockSeconds: 5, minStake: 100, maxStake: 1_000_000,
  };
}

async function notify(changed: Set<string>) {
  for (const userId of changed) {
    try {
      const { balance } = await getBalanceByUser(userId);
      publishWalletBalance({ userId, scope: "wingo", balance, entryType: "adjustment", amount: 0n });
    } catch (error) {
      logger.error({ error, userId }, "Win Go wallet notification failed");
    }
  }
}

async function table(userId: string, duration: number, input?: BetInput) {
  const wallet = await ensureWallet(userId);
  const changed = new Set<string>();
  const result = await db.transaction(async tx => {
    await lock(tx);
    const now = await serverTime(tx);
    await advance(tx, now, changed);
    if (input) {
      const [existing] = await tx.select().from(bets)
        .where(and(eq(bets.userId, userId), eq(bets.request, input.request)));
      if (existing) {
        if (existing.period !== input.period || existing.pick !== input.pick || existing.stake !== input.stake
          || !existing.period.startsWith(`${duration}-`)) {
          throw conflict("This request was already used for a different prediction.");
        }
      } else {
        if (input.period !== periodFor(duration, now))
          throw conflict("A new round has started. Please select your prediction again.");
        const [round] = await tx.select().from(rounds).where(eq(rounds.period, input.period));
        if (round.settled || now >= round.ends - 5000)
          throw conflict("Predictions are locked for this round. The next round starts shortly.");
        if (round.payoutVersion >= 3 && input.payoutVersion !== round.payoutVersion)
          throw conflict("The game rates have changed. Refresh Colour Trading before placing your bet.");
        const [bet] = await tx.insert(bets).values({ userId, period: input.period, pick: input.pick,
          stake: input.stake, request: input.request, created: now }).returning();
        try {
          await postEntry({ userId, scope: "wingo", type: "bet", amount: -BigInt(input.stake),
            refType: "wingo_bet", refId: bet.id, memo: `Win Go ${duration}s prediction` }, tx);
        } catch (error) {
          if ((error as Error).message === "INSUFFICIENT_FUNDS")
            throw badRequest("You do not have enough wallet balance for this prediction.");
          throw error;
        }
        // A wait for another game's wallet debit must never allow a late prediction.
        if (await serverTime(tx) >= round.ends - 5000)
          throw conflict("Predictions are locked for this round. The next round starts shortly.");
        changed.add(userId);
      }
    }
    return snapshot(tx, userId, wallet.id, duration, now);
  });
  await notify(changed);
  return result;
}

export function wingoState(userId: string, duration: unknown = 30) {
  return table(userId, durationSchema.parse(duration));
}
export function placeWingoBet(userId: string, input: unknown) {
  const parsed = betSchema.parse(input);
  return table(userId, parsed.duration, parsed);
}

/** Recover persisted predictions even when no player has Win Go open. */
export async function tickWingo() {
  const changed = new Set<string>();
  await db.transaction(async tx => {
    await lock(tx);
    await advance(tx, await serverTime(tx), changed);
  });
  await notify(changed);
}

export function startWingoEngine() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await tickWingo(); }
    catch (error) { logger.error({ error }, "Win Go settlement failed"); }
    finally { busy = false; }
  };
  void tick();
  const timer = setInterval(tick, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
