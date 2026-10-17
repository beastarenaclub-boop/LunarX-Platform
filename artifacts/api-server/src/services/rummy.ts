import { db, rummySessionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { initialTable, type Card } from "@workspace/api-zod/rummy";
import { rummySessionReducer, type RummySession, type Action } from "@workspace/api-zod/rummy-session";
import { ensureWallet, getBalance, getBalanceByUser, postEntry, publishWalletBalance } from "./wallet";
import { badRequest, conflict } from "../lib/errors";
import { logger } from "../lib/logger";

export async function rummyTable(userId: string, name: string, input?: { version: number; action: Action }) {
  const wallet = await ensureWallet(userId);
  let walletChanged = false;
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`rummy:${userId}`}, 0))`);
    const now = Date.now();
    const [saved] = await tx.select().from(rummySessionsTable).where(eq(rummySessionsTable.userId, userId));
    let state = (saved?.state as RummySession | undefined) ?? {
      table: initialTable(name), auto: null, autoPlay: false, notice: "",
    };
    let version = saved?.version ?? 0;
    let deadline = saved?.deadline ?? 0;
    state = { ...state, table: { ...state.table, balance: Number(await getBalance(wallet.id, tx)) / 100 } };
    if (input && input.version !== version) throw conflict("Table updated. Please try your action again.");
    const apply = async (action: Action) => {
      const previous = state;
      const next = rummySessionReducer(state, action);
      if (next === previous) return;
      if (next.table.round !== previous.table.round) {
        try {
          await postEntry({ userId, scope: "rummy", type: "bet", amount: -BigInt(next.table.stake) * 100n,
            refType: "rummy_bet", refId: `${userId}:${next.table.round}` }, tx);
        } catch (error) {
          if ((error as Error).message === "INSUFFICIENT_FUNDS") throw badRequest("Not enough wallet balance.");
          throw error;
        }
        walletChanged = true;
      }
      if (next.table.phase === "finished" && previous.table.phase !== "finished" && next.table.result!.payout > 0) {
        await postEntry({ userId, scope: "rummy", type: next.table.result!.winner === null ? "refund" : "win",
          amount: BigInt(next.table.result!.payout) * 100n, refType: "rummy_payout", refId: `${userId}:${next.table.round}` }, tx);
        walletChanged = true;
      }
      const t = next.table, p = previous.table;
      if (t.phase !== p.phase || t.round !== p.round || t.current !== p.current || t.step !== p.step || t.turns !== p.turns || next.autoPlay !== previous.autoPlay || !deadline) {
        deadline = now + (t.phase === "dealing" ? 2600 : t.phase === "finished" ? 6000 : t.current !== 0 || next.autoPlay ? 950 : 20000);
      }
      state = next;
      version++;
    };
    if (deadline && now >= deadline) {
      const phase = state.table.phase;
      if (phase === "dealing") await apply({ type: "dealt" });
      else if (phase === "playing") await apply({ type: "step" });
      else if (phase === "finished" && state.auto) await apply({ type: "auto-next" });
      // A queued action against the old turn must not apply to the new one.
      if (input && version !== input.version) input = undefined;
    }
    if (input) {
      if ((input.action.type === "start" || input.action.type === "auto-start") && input.action.stake > state.table.balance)
        throw badRequest("Not enough wallet balance.");
      await apply(input.action);
    }
    state.table.balance = Number(await getBalance(wallet.id, tx)) / 100;
    await tx.insert(rummySessionsTable).values({ userId, state, version, deadline })
      .onConflictDoUpdate({ target: rummySessionsTable.userId, set: { state, version, deadline } });
    // Hidden cards never leave the server until the hand finishes.
    const back = (_: Card, i: number): Card => ({ id: `hidden-${i}`, suit: "J", rank: 0 });
    return {
      ...state, version, deadline, serverNow: now,
      table: { ...state.table, stock: state.table.stock.map(back),
        players: state.table.players.map((player, i) => ({ ...player,
          hand: i === 0 || state.table.phase === "finished" ? player.hand : player.hand.map(back) })) },
    };
  });
  if (walletChanged) {
    const { balance } = await getBalanceByUser(userId);
    publishWalletBalance({ userId, balance, entryType: "adjustment", amount: 0n });
  }
  return result;
}

/** Persisted turn clocks continue through navigation and API restarts. */
export function startRummyEngine() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const due = await db.select({ userId: rummySessionsTable.userId }).from(rummySessionsTable)
        .where(sql`${rummySessionsTable.deadline} > 0 AND ${rummySessionsTable.deadline} <= ${Date.now()}
          AND ((${rummySessionsTable.state}->'table'->>'phase') IN ('dealing', 'playing')
            OR ((${rummySessionsTable.state}->'table'->>'phase') = 'finished' AND ${rummySessionsTable.state}->'auto' <> 'null'::jsonb))`)
        .limit(25);
      for (const { userId } of due) await rummyTable(userId, "You");
    } catch (error) { logger.error({ error }, "Rummy turn processing failed"); }
    finally { busy = false; }
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
