/**
 * The WINNER meter.
 *
 * NO MONEY MOVES THROUGH THIS FILE, and that is the design rather than an
 * omission. Settlement has already credited the wallet by the time anything
 * here runs; a meter row records only that the player has not yet acknowledged
 * the win, so the game screen can draw `Score = balance − uncollected` and hold
 * the amount in its own display until TAKE.
 *
 * Writing a ledger entry on take would pay the win a second time. The way that
 * is made impossible is structural: nothing in this file calls `placeBet`,
 * `cashOutBet`, `creditWallet` or anything else that can move a balance, and no
 * balance anywhere is derived from `pending_wins`. Keep it that way — a flag
 * would not be the same argument.
 */
import { db, pendingWinsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface PendingWinView {
  gameCode: string;
  amountPaise: string;
  roundId: string | null;
  lastWonAt: string;
}

/**
 * Arm the meter for a win that has just been credited.
 *
 * Additive: a second win on the same wheel before the player takes the first
 * accumulates rather than replacing, and `roundId` moves to the newest round
 * because that is the layout the screen holds on the chart.
 */
export async function creditPendingWin(args: {
  userId: string;
  gameCode: string;
  partnerId: string | null;
  amountPaise: bigint;
  roundId: string;
}): Promise<void> {
  if (args.amountPaise <= 0n) return;
  try {
    await db
      .insert(pendingWinsTable)
      .values({
        userId: args.userId,
        gameCode: args.gameCode,
        partnerId: args.partnerId,
        amountPaise: args.amountPaise,
        roundId: args.roundId,
        lastWonAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [pendingWinsTable.userId, pendingWinsTable.gameCode],
        set: {
          amountPaise: sql`${pendingWinsTable.amountPaise} + ${args.amountPaise}`,
          roundId: args.roundId,
          partnerId: args.partnerId,
          lastWonAt: new Date(),
        },
      });
  } catch (err) {
    // The player has been PAID. A meter that failed to arm is a display defect;
    // throwing here would fail a settlement that already moved money.
    logger.error({ err, ...args, amountPaise: args.amountPaise.toString() },
      "[pending-wins] could not arm the meter");
  }
}

export async function pendingWinFor(
  userId: string,
  gameCode: string,
): Promise<PendingWinView | null> {
  const rows = await db
    .select()
    .from(pendingWinsTable)
    .where(
      and(
        eq(pendingWinsTable.userId, userId),
        eq(pendingWinsTable.gameCode, gameCode),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.amountPaise <= 0n) return null;
  return {
    gameCode: row.gameCode,
    amountPaise: row.amountPaise.toString(),
    roundId: row.roundId,
    lastWonAt: row.lastWonAt.toISOString(),
  };
}

/** Every armed meter for a player, for the wallet summary. */
export async function pendingWinsForUser(userId: string): Promise<PendingWinView[]> {
  const rows = await db
    .select()
    .from(pendingWinsTable)
    .where(eq(pendingWinsTable.userId, userId));
  return rows
    .filter((r) => r.amountPaise > 0n)
    .map((r) => ({
      gameCode: r.gameCode,
      amountPaise: r.amountPaise.toString(),
      roundId: r.roundId,
      lastWonAt: r.lastWonAt.toISOString(),
    }));
}

/**
 * Collect the meter.
 *
 * NEVER ERRORS, and answers `0` rather than failing when there is nothing to
 * collect. The client reports the press, not the end of the drain animation, so
 * a press against an already-empty meter is ordinary — a double tap, a retry
 * after a dropped response, a second tab. An error there would put a scary
 * dialog in front of a player who did nothing wrong.
 *
 * A repeated `takeKey` answers with what THAT press took. "You already
 * collected 420" and "there was nothing to collect" are very different claims
 * and only one of them is true.
 */
export async function takePendingWin(args: {
  userId: string;
  gameCode: string;
  takeKey?: string;
}): Promise<{ takenPaise: string }> {
  const rows = await db
    .select()
    .from(pendingWinsTable)
    .where(
      and(
        eq(pendingWinsTable.userId, args.userId),
        eq(pendingWinsTable.gameCode, args.gameCode),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return { takenPaise: "0" };

  if (args.takeKey && row.lastTakeKey === args.takeKey) {
    return { takenPaise: row.lastTakeAmountPaise.toString() };
  }
  if (row.amountPaise <= 0n) return { takenPaise: "0" };

  // Claim it with a CAS on the amount we read, so two presses racing each other
  // cannot both report having taken it.
  const [updated] = await db
    .update(pendingWinsTable)
    .set({
      amountPaise: 0n,
      roundId: null,
      lastTakeAmountPaise: row.amountPaise,
      lastTakeKey: args.takeKey ?? null,
      lastTakenAt: new Date(),
    })
    .where(
      and(
        eq(pendingWinsTable.userId, args.userId),
        eq(pendingWinsTable.gameCode, args.gameCode),
        eq(pendingWinsTable.amountPaise, row.amountPaise),
      ),
    )
    .returning({ amount: pendingWinsTable.lastTakeAmountPaise });
  return { takenPaise: (updated?.amount ?? 0n).toString() };
}
