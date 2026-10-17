import { and, desc, eq, isNull, isNotNull, lte, sql } from "drizzle-orm";
import {
  db,
  dragonTigerOneDayRounds as rounds,
  dragonTigerOneDayBets as bets,
} from "@workspace/db";
import {
  OD_GAME,
  OD_TIMING,
  type ODSelection,
  type ODStage,
  type ODTable,
} from "@workspace/api-zod/dragon-tiger-one-day";
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
  phaseAt,
  publicRound,
  quoteId,
  quotes,
  winner,
} from "./dragonTigerOneDayMath";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const LOCK = 73482106;
const serializeSlip = (bet: typeof bets.$inferSelect) => ({
  id: bet.id,
  roundId: bet.roundId,
  stage: bet.stage,
  selections: bet.selections,
  stakePaise: String(bet.stakePaise),
  payoutPaise: bet.payoutPaise === null ? null : String(bet.payoutPaise),
});
async function clock(tx: Tx) {
  const result = await tx.execute<{ now: string }>(
    sql`select (extract(epoch from clock_timestamp()) * 1000)::bigint::text as now`,
  );
  return Number(result.rows[0].now);
}
async function advance(tx: Tx, now: number, changed: Set<string>) {
  // Recover every unfinished round on restart, including players who left.
  const due = await tx
    .select()
    .from(rounds)
    .where(and(isNull(rounds.settledAt), lte(rounds.revealsAt, new Date(now))))
    .orderBy(rounds.id);
  for (const round of due) {
    const slips = await tx
      .select()
      .from(bets)
      .where(and(eq(bets.roundId, round.id), isNull(bets.payoutPaise)));
    for (const slip of slips) {
      const amount = payout(slip.selections, round.dragon, round.tiger);
      if (amount > 0n) {
        await postEntry(
          {
            userId: slip.userId,
            scope: OD_GAME,
            type: "win",
            amount,
            refType: "dt_one_day_win",
            refId: String(slip.id),
          },
          tx,
        );
        changed.add(slip.userId);
      }
      await tx
        .update(bets)
        .set({ payoutPaise: amount })
        .where(eq(bets.id, slip.id));
    }
    await tx
      .update(rounds)
      .set({ settledAt: new Date(now) })
      .where(eq(rounds.id, round.id));
  }
  let [round] = await tx
    .select()
    .from(rounds)
    .orderBy(desc(rounds.id))
    .limit(1);
  if (!round || now >= round.endsAt.getTime()) {
    const first = now + OD_TIMING.first,
      second = first + OD_TIMING.revealDragon;
    const closes = second + OD_TIMING.second,
      reveal = closes + OD_TIMING.revealTiger;
    [round] = await tx
      .insert(rounds)
      .values({
        ...draw(),
        firstClosesAt: new Date(first),
        secondOpensAt: new Date(second),
        secondClosesAt: new Date(closes),
        revealsAt: new Date(reveal),
        endsAt: new Date(reveal + OD_TIMING.result),
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
export async function oneDayTable(
  userId: string,
  input?: {
    roundId: number;
    stage: ODStage;
    quoteId: string;
    selections: ODSelection[];
  },
): Promise<ODTable> {
  const wallet = await ensureWallet(userId),
    changed = new Set<string>();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
    const now = await clock(tx),
      round = await advance(tx, now, changed);
    if (input) {
      // Idempotent retries remain valid after the round ends. They never debit again.
      const [existing] = await tx
        .select()
        .from(bets)
        .where(
          and(
            eq(bets.roundId, input.roundId),
            eq(bets.userId, userId),
            eq(bets.stage, input.stage),
          ),
        );
      if (existing) {
        const canonical = (items: ODSelection[]) =>
          JSON.stringify(
            items
              .map(({ market, amountPaise }) => ({ market, amountPaise }))
              .sort((a, b) => a.market.localeCompare(b.market)),
          );
        if (canonical(existing.selections) !== canonical(input.selections))
          throw conflict("Your bet for this chance is already confirmed.");
      } else {
        const phase = phaseAt(round, now).phase;
        if (
          input.roundId !== round.id ||
          phase !== input.stage ||
          input.quoteId !== quoteId(round.id, input.stage)
        )
          throw conflict(
            "This price window has closed. Select bets at the current bhav.",
          );
        const previous = await tx
          .select()
          .from(bets)
          .where(and(eq(bets.roundId, round.id), eq(bets.userId, userId)));
        if (
          input.stage === "second" &&
          !previous.some((b) => b.stage === "first")
        )
          throw conflict(
            "Place a first-chance bet to unlock the second chance.",
          );
        let locked: ReturnType<typeof lockSelections>;
        try {
          locked = lockSelections(
            input.selections,
            quotes(input.stage === "second" ? round.dragon : undefined).filter(
              (q) =>
                input.stage === "first"
                  ? q.side === "match"
                  : q.side !== "dragon",
            ),
            previous.reduce((sum, b) => sum + b.stakePaise, 0n),
          );
        } catch (error) {
          throw badRequest((error as Error).message);
        }
        try {
          await postEntry(
            {
              userId,
              scope: OD_GAME,
              type: "bet",
              amount: -locked.stake,
              refType: "dt_one_day_bet",
              refId: `${round.id}:${input.stage}:${userId}`,
            },
            tx,
          );
        } catch (error) {
          if ((error as Error).message === "INSUFFICIENT_FUNDS")
            throw badRequest("Not enough balance in your shared wallet.");
          throw error;
        }
        // A blocked wallet lock must not admit bets after the phase deadline.
        if (phaseAt(round, await clock(tx)).phase !== input.stage)
          throw conflict("Betting closed before your bet reached the table.");
        await tx.insert(bets).values({
          roundId: round.id,
          userId,
          stage: input.stage,
          selections: locked.selections,
          stakePaise: locked.stake,
        });
        changed.add(userId);
      }
    }
    const slips = await tx
      .select()
      .from(bets)
      .where(and(eq(bets.roundId, round.id), eq(bets.userId, userId)))
      .orderBy(bets.id);
    const recent = await tx
      .select()
      .from(bets)
      .where(and(eq(bets.userId, userId), isNotNull(bets.payoutPaise)))
      .orderBy(desc(bets.id))
      .limit(30);
    const history = await tx
      .select({ id: rounds.id, dragon: rounds.dragon, tiger: rounds.tiger })
      .from(rounds)
      .where(isNotNull(rounds.settledAt))
      .orderBy(desc(rounds.id))
      .limit(24);
    const balance = await getBalance(wallet.id, tx);
    const snapshotNow = await clock(tx);
    const visible = publicRound(round, snapshotNow);
    const stage: ODStage =
      visible.phase === "first" || visible.phase === "dragon-reveal"
        ? "first"
        : "second";
    const hasFirst = slips.some((s) => s.stage === "first");
    return {
      serverNow: snapshotNow,
      balancePaise: String(balance),
      round: visible,
      quoteId: quoteId(round.id, stage),
      quotes: quotes(stage === "second" ? round.dragon : undefined)
        .filter((q) =>
          stage === "first"
            ? q.side === "match"
            : hasFirst && q.side !== "dragon",
        )
        .map((q) => ({
          ...q,
          available:
            q.available &&
            !slips.some((s) => s.stage === stage) &&
            (visible.phase === "first" || visible.phase === "second"),
        })),
      slips: slips.map(serializeSlip),
      recent: recent.map(serializeSlip),
      history: history.map((r) => ({
        ...r,
        winner: winner(r.dragon, r.tiger),
      })),
    };
  });
  await publish(changed);
  return result;
}
export function startOneDayDragonTigerEngine() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const changed = new Set<string>();
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
        await advance(tx, await clock(tx), changed);
      });
      await publish(changed);
    } catch (error) {
      logger.error({ error }, "One Day Dragon Tiger settlement failed");
    } finally {
      busy = false;
    }
  }, 500);
  timer.unref();
  return () => clearInterval(timer);
}
