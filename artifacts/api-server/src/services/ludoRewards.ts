import { and, desc, eq, sql } from "drizzle-orm";
import { db, usersTable, walletsTable, walletLedgerTable } from "@workspace/db";
import { forbidden } from "../lib/errors";
import {
  ensureWallet,
  getBalanceByUser,
  postEntry,
  publishWalletBalance,
} from "./wallet";

export const LUDO_DAILY_PAISE = 10000n;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function rewardDay(tx: Tx) {
  const result = await tx.execute<{ day: string; resets: string }>(
    sql`select to_char(clock_timestamp() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day, (extract(epoch from ((date_trunc('day', clock_timestamp() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata'))*1000)::bigint::text as resets`,
  );
  return { day: result.rows[0].day, resetsAt: Number(result.rows[0].resets) };
}
async function eligible(tx: Tx, userId: string) {
  const [user] = await tx
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (
    !user ||
    user.status !== "active" ||
    user.role !== "player" ||
    user.migratedToUserId
  )
    throw forbidden(
      "An active player account is required to claim a daily reward",
    );
}
export async function ludoDailyReward(userId: string) {
  return db.transaction(async (tx) => {
    await eligible(tx, userId);
    const day = await rewardDay(tx);
    const [claim] = await tx
      .select({ id: walletLedgerTable.id })
      .from(walletLedgerTable)
      .where(
        and(
          eq(walletLedgerTable.userId, userId),
          eq(walletLedgerTable.refType, "ludo_daily"),
          eq(walletLedgerTable.refId, day.day),
        ),
      )
      .limit(1);
    const history = await tx
      .select({
        id: walletLedgerTable.id,
        day: walletLedgerTable.refId,
        amountPaise: walletLedgerTable.amount,
        at: walletLedgerTable.createdAt,
      })
      .from(walletLedgerTable)
      .where(
        and(
          eq(walletLedgerTable.userId, userId),
          eq(walletLedgerTable.refType, "ludo_daily"),
        ),
      )
      .orderBy(desc(walletLedgerTable.createdAt))
      .limit(7);
    return {
      ...day,
      amountPaise: String(LUDO_DAILY_PAISE),
      claimed: !!claim,
      history: history.map((x) => ({
        ...x,
        amountPaise: String(x.amountPaise),
        at: x.at.getTime(),
      })),
    };
  });
}
export async function claimLudoDailyReward(userId: string) {
  const wallet = await ensureWallet(userId);
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: walletsTable.id })
      .from(walletsTable)
      .where(eq(walletsTable.id, wallet.id))
      .for("update");
    await eligible(tx, userId);
    const { day } = await rewardDay(tx);
    const [existing] = await tx
      .select({ id: walletLedgerTable.id })
      .from(walletLedgerTable)
      .where(
        and(
          eq(walletLedgerTable.userId, userId),
          eq(walletLedgerTable.refType, "ludo_daily"),
          eq(walletLedgerTable.refId, day),
        ),
      )
      .limit(1);
    if (existing) return null;
    return postEntry(
      {
        userId,
        type: "bonus",
        amount: LUDO_DAILY_PAISE,
        refType: "ludo_daily",
        refId: day,
        memo: "Ludo daily reward · ₹100 · one claim per IST day",
      },
      tx,
    );
  });
  if (result)
    publishWalletBalance({
      userId,
      balance: result.entry.balanceAfter,
      entryType: "bonus",
      amount: LUDO_DAILY_PAISE,
    });
  return {
    ...(await ludoDailyReward(userId)),
    credited: !!result,
    balancePaise: String((await getBalanceByUser(userId)).balance),
  };
}
