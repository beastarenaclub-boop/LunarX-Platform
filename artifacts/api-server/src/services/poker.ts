import { and, desc, eq, isNull, isNotNull, lte, sql } from "drizzle-orm";
import {
  db,
  pokerRounds as rounds,
  pokerBets as bets,
  gameConfigTable,
} from "@workspace/db";
import {
  POKER_CONFIG,
  POKER_GAMES,
  type PokerGame,
  type PokerBetInput,
  type PokerTable,
} from "@workspace/api-zod/poker";
import { badRequest, conflict } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  ensureWallet,
  getBalance,
  getBalanceByUser,
  postEntry,
  publishWalletBalance,
} from "./wallet";
import {
  draw,
  lockSelections,
  payout,
  publicRound,
  outcome,
} from "./pokerMath";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const lockId = (game: PokerGame) => 73482120 + POKER_GAMES.indexOf(game);
const quoteId = (round: typeof rounds.$inferSelect) =>
  `${round.game}:${round.id}:v1`;
const slip = (b: typeof bets.$inferSelect) => ({
  id: b.id,
  requestId: b.requestId,
  roundId: b.roundId,
  selections: b.selections,
  stakePaise: String(b.stakePaise),
  payoutPaise: b.payoutPaise === null ? null : String(b.payoutPaise),
});
async function clock(tx: Tx) {
  const result = await tx.execute<{ now: string }>(
    sql`select (extract(epoch from clock_timestamp()) * 1000)::bigint::text as now`,
  );
  return Number(result.rows[0].now);
}
async function advance(
  tx: Tx,
  game: PokerGame,
  now: number,
  changed: Set<string>,
) {
  const due = await tx
    .select()
    .from(rounds)
    .where(
      and(
        eq(rounds.game, game),
        isNull(rounds.settledAt),
        lte(rounds.revealsAt, new Date(now)),
      ),
    )
    .orderBy(rounds.id);
  for (const round of due) {
    const pending = await tx
      .select()
      .from(bets)
      .where(and(eq(bets.roundId, round.id), isNull(bets.payoutPaise)))
      .orderBy(bets.userId, bets.id);
    for (const bet of pending) {
      const amount = payout(bet.selections, round.hands, round.board);
      if (amount > 0n) {
        await postEntry(
          {
            userId: bet.userId,
            scope: game,
            type: "win",
            amount,
            refType: "poker_win",
            refId: String(bet.id),
          },
          tx,
        );
        changed.add(bet.userId);
      }
      await tx
        .update(bets)
        .set({ payoutPaise: amount })
        .where(eq(bets.id, bet.id));
    }
    await tx
      .update(rounds)
      .set({ settledAt: new Date(now) })
      .where(eq(rounds.id, round.id));
  }
  let [round] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.game, game))
    .orderBy(desc(rounds.id))
    .limit(1);
  if (!round || now >= round.endsAt.getTime()) {
    const cards = draw(game);
    // Pricing takes time: start the betting clock after producing the quotes.
    const starts = await clock(tx),
      closes = starts + POKER_CONFIG.bettingMs[game];
    const reveals = closes + POKER_CONFIG.dealMs + 3 * POKER_CONFIG.streetMs;
    [round] = await tx
      .insert(rounds)
      .values({
        game,
        ...cards,
        closesAt: new Date(closes),
        revealsAt: new Date(reveals),
        endsAt: new Date(reveals + POKER_CONFIG.resultMs),
      })
      .returning();
  }
  return round;
}
async function publish(changed: Set<string>) {
  for (const userId of changed) {
    const { balance } = await getBalanceByUser(userId);
    publishWalletBalance({
      userId,
      balance,
      entryType: "adjustment",
      amount: 0n,
    });
  }
}
export async function pokerTable(
  userId: string,
  game: PokerGame,
  input?: PokerBetInput,
): Promise<PokerTable> {
  const wallet = await ensureWallet(userId),
    changed = new Set<string>();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${lockId(game)})`);
    const round = await advance(tx, game, await clock(tx), changed);
    const [config] = await tx
      .select({ enabled: gameConfigTable.enabled })
      .from(gameConfigTable)
      .where(eq(gameConfigTable.gameCode, game));
    const enabled = config?.enabled ?? true;
    if (input) {
      const [existing] = await tx
        .select()
        .from(bets)
        .where(
          and(eq(bets.userId, userId), eq(bets.requestId, input.requestId)),
        );
      if (existing) {
        const canonical = (items: { market: string; amountPaise: string }[]) =>
          JSON.stringify(
            items
              .map(({ market, amountPaise }) => ({ market, amountPaise }))
              .sort((a, b) => a.market.localeCompare(b.market)),
          );
        const [original] = await tx
          .select()
          .from(rounds)
          .where(eq(rounds.id, existing.roundId));
        if (
          existing.roundId !== input.roundId ||
          original.game !== game ||
          input.quoteId !== quoteId(original) ||
          canonical(existing.selections) !== canonical(input.selections)
        )
          throw conflict("This request already has a different confirmed bet.");
      } else {
        if (!enabled) throw conflict("This poker table is currently paused.");
        if (
          input.roundId !== round.id ||
          input.quoteId !== quoteId(round) ||
          (await clock(tx)) >= round.closesAt.getTime()
        )
          throw conflict(
            "Betting is closed for this round. Please use the current prices.",
          );
        const previous = await tx
          .select()
          .from(bets)
          .where(and(eq(bets.roundId, round.id), eq(bets.userId, userId)));
        let locked: ReturnType<typeof lockSelections>;
        try {
          locked = lockSelections(
            input.selections,
            round.quotes,
            previous.reduce((sum, b) => sum + b.stakePaise, 0n),
          );
        } catch (error) {
          throw badRequest((error as Error).message);
        }
        try {
          await postEntry(
            {
              userId,
              scope: game,
              type: "bet",
              amount: -locked.debit,
              refType: "poker_bet",
              refId: `${userId}:${input.requestId}`,
            },
            tx,
          );
        } catch (error) {
          if ((error as Error).message === "INSUFFICIENT_FUNDS")
            throw badRequest("Not enough balance in your shared wallet.");
          throw error;
        }
        // Wallet locking can cross the deadline. Roll back the entire debit.
        if ((await clock(tx)) >= round.closesAt.getTime())
          throw conflict("Betting closed before your bet reached the table.");
        await tx
          .insert(bets)
          .values({
            roundId: round.id,
            userId,
            requestId: input.requestId,
            selections: locked.selections,
            stakePaise: locked.debit,
          });
        changed.add(userId);
      }
    }
    const current = await tx
      .select()
      .from(bets)
      .where(and(eq(bets.roundId, round.id), eq(bets.userId, userId)))
      .orderBy(bets.id);
    const recent = await tx
      .select({ bet: bets })
      .from(bets)
      .innerJoin(rounds, eq(rounds.id, bets.roundId))
      .where(
        and(
          eq(bets.userId, userId),
          eq(rounds.game, game),
          isNotNull(bets.payoutPaise),
        ),
      )
      .orderBy(desc(bets.id))
      .limit(30);
    const history = await tx
      .select()
      .from(rounds)
      .where(and(eq(rounds.game, game), isNotNull(rounds.settledAt)))
      .orderBy(desc(rounds.id))
      .limit(24);
    const serverNow = await clock(tx);
    return {
      enabled,
      serverNow,
      balancePaise: String(await getBalance(wallet.id, tx)),
      round: publicRound(round, serverNow),
      quoteId: quoteId(round),
      quotes: round.quotes,
      slips: current.map(slip),
      recent: recent.map((r) => slip(r.bet)),
      history: history.map((r) => ({ id: r.id, ...outcome(r.hands, r.board) })),
    };
  });
  await publish(changed);
  return result;
}
export function startPokerEngine() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const game of POKER_GAMES) {
        const changed = new Set<string>();
        await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${lockId(game)})`);
          await advance(tx, game, await clock(tx), changed);
        });
        await publish(changed);
      }
    } catch (error) {
      logger.error({ error }, "Poker settlement failed; retrying");
    } finally {
      busy = false;
    }
  }, 500);
  timer.unref();
  return () => clearInterval(timer);
}
