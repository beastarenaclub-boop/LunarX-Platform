import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, virtualSportsRoundsTable as rounds, virtualSportsBetsTable as bets } from "@workspace/db";
import { BET_MS, PLAY_MS, ROUND_MS, oddsFor, sportById } from "../../../../lib/virtual-sports/catalog.mjs";
import { FIXTURES, sportForFixture } from "../../../../lib/virtual-sports/fixtures.mjs";
import { makeMatch, type Round, type SportsState } from "../../../../lib/virtual-sports/store.mjs";
import { badRequest, conflict } from "../lib/errors";
import { logger } from "../lib/logger";
import { ensureWallet, getBalance, getBalanceByUser, postEntry, publishWalletBalance, type TxClient } from "./wallet";

const inputSchema = z.object({
  requestId: z.string().uuid(), roundId: z.string().min(1).max(150),
  sport: z.enum(["football", "cricket", "basketball", "tennis", "formula"]),
  choice: z.number().int().min(0).max(3), stake: z.number().int().min(10).max(5000),
}).strict().refine(v => v.choice < sportById(v.sport)!.selections.length, "Choose a valid outcome.");
type StoredRound = typeof rounds.$inferSelect;
async function clock(tx: TxClient) {
  const { rows } = await tx.execute<{ now: string }>(sql`select (extract(epoch from clock_timestamp()) * 1000)::bigint::text as now`);
  return Number(rows[0].now);
}
async function lock(tx: TxClient) { await tx.execute(sql`select pg_advisory_xact_lock(73482109)`); }
async function advance(tx: TxClient, now: number, changed: Set<string>) {
  const due = await tx.select().from(rounds).where(and(eq(rounds.settled, false), lte(rounds.starts, now - BET_MS - PLAY_MS)));
  const dueIds = new Map(due.map(r => [r.id, r]));
  if (due.length) {
    // Stable wallet order across the entire recovery batch.
    const pending = await tx.select({ bet: bets }).from(bets).innerJoin(rounds, eq(bets.roundId, rounds.id))
      .where(and(eq(bets.status, "pending"), eq(rounds.settled, false), lte(rounds.starts, now - BET_MS - PLAY_MS)))
      .orderBy(asc(bets.userId), asc(bets.id));
    for (const { bet } of pending) {
      const round = dueIds.get(bet.roundId)!;
      const won = bet.choice === round.data.winner, payout = won ? Math.floor(bet.amount * bet.oddsHundredths / 100) : 0;
      if (payout) {
        await postEntry({ userId: bet.userId, scope: "virtual-sports", type: "win", amount: BigInt(payout),
          refType: "virtual_sports_payout", refId: bet.id, memo: `${sportById(bet.sport)!.short} · ${sportForFixture(round.data.fixture).selections[bet.choice]}` }, tx);
        changed.add(bet.userId);
      }
      await tx.update(bets).set({ status: won ? "won" : "lost", payout }).where(eq(bets.id, bet.id));
    }
    for (const round of due) await tx.update(rounds).set({ settled: true }).where(eq(rounds.id, round.id));
  }
  const starts = Math.floor(now / ROUND_MS) * ROUND_MS;
  const current = await tx.select().from(rounds).where(eq(rounds.starts, starts)), existing = new Set(current.map(r => r.id));
  for (const fixture of FIXTURES) {
    const id = `${fixture.sport}-${fixture.id}-${starts}`;
    if (existing.has(id)) continue;
    const sport = sportForFixture(fixture);
    const [row] = await tx.insert(rounds).values({ id, sport: fixture.sport, starts,
      data: { ...makeMatch(sport), fixture, odds: oddsFor(sport) } }).returning();
    current.push(row);
  }
  return current;
}
function view(row: StoredRound, now: number): Round {
  const elapsed = now - row.starts, phase = elapsed < BET_MS ? "betting" : elapsed < BET_MS + PLAY_MS ? "live" : "result";
  const events = row.data.events.filter(e => e.at <= elapsed - BET_MS);
  return { id: row.id, sport: row.sport, fixture: row.data.fixture, starts: row.starts,
    closes: row.starts + BET_MS, ends: row.starts + BET_MS + PLAY_MS, next: row.starts + ROUND_MS,
    phase, odds: row.data.odds, events, score: events.at(-1)?.score ?? [0, 0],
    winner: phase === "result" ? row.data.winner : null, order: events.at(-1)?.order ?? [0, 1, 2, 3] };
}
async function snapshot(tx: TxClient, userId: string, walletId: string, current: StoredRound[], now: number): Promise<SportsState> {
  const slips = await tx.select({ bet: bets, round: rounds }).from(bets).innerJoin(rounds, eq(bets.roundId, rounds.id))
    .where(eq(bets.userId, userId)).orderBy(desc(bets.created), desc(bets.id)).limit(50);
  const results = await tx.select().from(rounds).where(eq(rounds.settled, true)).orderBy(desc(rounds.starts)).limit(100);
  const matches = current.map(r => view(r, now));
  return { mode: "wallet", currency: "INR", accountId: userId, serverTime: now,
    account: { balance: Number(await getBalance(walletId, tx)) / 100, refillAt: 0 },
    rounds: matches.filter(r => r.fixture?.id === "classic"), matches,
    bets: slips.map(({ bet, round }) => ({ id: bet.id, requestId: bet.requestId, roundId: bet.roundId,
      sport: bet.sport, choice: bet.choice, stake: bet.amount / 100, payout: bet.payout / 100,
      odds: bet.oddsHundredths / 100, status: bet.status, created: bet.created, fixture: round.data.fixture,
      selectionName: sportForFixture(round.data.fixture).selections[bet.choice] })),
    results: results.map(r => ({ id: r.id, sport: r.sport, winner: r.data.winner, score: r.data.score, fixture: r.data.fixture })) };
}
async function notify(changed: Set<string>) {
  for (const userId of changed) try {
    const { balance } = await getBalanceByUser(userId);
    publishWalletBalance({ userId, scope: "virtual-sports", balance, entryType: "adjustment", amount: 0n });
  } catch (error) { logger.error({ error, userId }, "Virtual sports wallet notification failed"); }
}
async function table(userId: string, input?: z.infer<typeof inputSchema>) {
  const wallet = await ensureWallet(userId), changed = new Set<string>();
  const result = await db.transaction(async tx => {
    await lock(tx);
    const now = await clock(tx), current = await advance(tx, now, changed);
    if (input) {
      const [prior] = await tx.select().from(bets).where(and(eq(bets.userId, userId), eq(bets.requestId, input.requestId)));
      if (prior) {
        if (prior.roundId !== input.roundId || prior.sport !== input.sport || prior.choice !== input.choice || prior.amount !== input.stake * 100)
          throw conflict("This request ID already belongs to a different bet.");
      } else {
        const round = current.find(r => r.id === input.roundId && r.sport === input.sport);
        if (!round || now < round.starts || now >= round.starts + BET_MS) throw conflict("Betting is closed for this match. Wait for the next round.");
        const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(bets).where(and(eq(bets.userId, userId), eq(bets.roundId, round.id)));
        if (count.n >= 30) throw badRequest("Maximum 30 bets per match.");
        const [bet] = await tx.insert(bets).values({ userId, requestId: input.requestId, roundId: round.id, sport: input.sport,
          choice: input.choice, amount: input.stake * 100, oddsHundredths: Math.round(round.data.odds[input.choice] * 100), created: now }).returning();
        try {
          await postEntry({ userId, scope: "virtual-sports", type: "bet", amount: -BigInt(bet.amount),
            refType: "virtual_sports_bet", refId: bet.id, memo: `${sportById(input.sport)!.short} · ${sportForFixture(round.data.fixture).selections[input.choice]}` }, tx);
        } catch (error) {
          if ((error as Error).message === "INSUFFICIENT_FUNDS") throw badRequest("Not enough wallet balance. Open Wallet to add funds.");
          throw error;
        }
        if (await clock(tx) >= round.starts + BET_MS) throw conflict("Betting is closed for this match. Wait for the next round.");
        changed.add(userId);
      }
    }
    return snapshot(tx, userId, wallet.id, current, await clock(tx));
  });
  await notify(changed);
  return result;
}
export function virtualSportsState(userId: string) { return table(userId); }
export async function placeVirtualSportsBet(userId: string, input: unknown) { return table(userId, inputSchema.parse(input)); }
export async function tickVirtualSports() {
  const changed = new Set<string>();
  await db.transaction(async tx => { await lock(tx); await advance(tx, await clock(tx), changed); });
  await notify(changed);
}
export function startVirtualSportsEngine() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await tickVirtualSports(); } catch (error) { logger.error({ error }, "Virtual sports settlement failed"); }
    finally { busy = false; }
  };
  void tick();
  const timer = setInterval(tick, 1000); timer.unref();
  return () => clearInterval(timer);
}
