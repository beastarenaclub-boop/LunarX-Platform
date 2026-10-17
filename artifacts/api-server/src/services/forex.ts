import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, forexMarketTable as markets, forexTradesTable as trades, type ForexMarketState } from "@workspace/db";
import { MARKETS, ROUND_MS, ORDER_MS, MAX_STAKE, closingPrice, outcomeFor, quoteAt, quoteTrail } from "../../../../lib/forex/market.mjs";
import type { ForexState, RoundResult } from "../../../../lib/forex/store.mjs";
import { badRequest, conflict } from "../lib/errors";
import { logger } from "../lib/logger";
import { ensureWallet, getBalance, getBalanceByUser, postEntry, publishWalletBalance, type TxClient } from "./wallet";

const tradeSchema = z.object({
  asset: z.string().refine(id => MARKETS.some(m => m.id === id), "Choose a valid asset."),
  side: z.enum(["buy", "sell"]),
  amount: z.number().int().min(10).max(MAX_STAKE).multipleOf(10), // API amounts are rupees
  roundId: z.number().int().nonnegative(),
  requestId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/),
}).strict();
type TradeInput = z.infer<typeof tradeSchema>;

async function serverTime(tx: TxClient) {
  const { rows } = await tx.execute<{ now: string }>(sql`select (extract(epoch from clock_timestamp()) * 1000)::bigint::text as now`);
  return Number(rows[0].now);
}
async function lock(tx: TxClient) {
  await tx.execute(sql`select pg_advisory_xact_lock(73482108)`);
}

function initial(now: number): ForexMarketState {
  const start = Math.floor(now / ROUND_MS) * ROUND_MS;
  const assets: ForexMarketState["assets"] = {};
  for (const [index, market] of MARKETS.entries()) {
    const values = Array.from({ length: 49 }, (_, i) => market.seed * (1 +
      (Math.sin(i * 0.52 + index) * 0.8 + Math.cos(i * 0.21 + index) * 0.7) * market.volatility));
    const offset = market.seed - values[48];
    assets[market.id] = { open: market.seed, candles: values.slice(1).map((v, i) => {
      const open = values[i] + offset, close = v + offset;
      return { time: start - (48 - i) * ROUND_MS, open, close,
        high: Math.max(open, close) + market.seed * market.volatility * 0.15,
        low: Math.min(open, close) - market.seed * market.volatility * 0.15, volume: 0, warmup: true };
    }) };
  }
  return { roundId: Math.floor(start / ROUND_MS), start, assets, results: [], economicsVersion: 2, outcomeSeed: randomBytes(32).toString("hex") };
}

async function pools(tx: TxClient, roundId: number) {
  const rows = await tx.select({ asset: trades.asset, volume: sql<number>`sum(${trades.amount})::float8 / 100`,
    orders: sql<number>`count(*)::int` }).from(trades).where(eq(trades.roundId, roundId)).groupBy(trades.asset);
  const [people] = await tx.select({ count: sql<number>`count(distinct ${trades.userId})::int` })
    .from(trades).where(eq(trades.roundId, roundId));
  const volumes = Object.fromEntries(MARKETS.map(m => [m.id, 0]));
  let total = 0, orders = 0;
  for (const row of rows) { volumes[row.asset] = row.volume; total += row.volume; orders += row.orders; }
  return { volumes, total, orders, participants: people.count };
}

async function advance(tx: TxClient, now: number, changed: Set<string>) {
  const [row] = await tx.select().from(markets).where(eq(markets.id, 1));
  if (!row) {
    const state = initial(now);
    await tx.insert(markets).values({ id: 1, data: state });
    return state;
  }
  const state = row.data;
  if (now < state.start + ROUND_MS) return state;
  const pool = await pools(tx, state.roundId);
  const result: RoundResult = { economicsVersion: state.economicsVersion, outcomeSeed: state.outcomeSeed, roundId: state.roundId, time: state.start + ROUND_MS,
    total: pool.total, average: pool.total / MARKETS.length, assets: {} };
  for (const market of MARKETS) {
    const asset = state.assets[market.id], volume = pool.volumes[market.id];
    const direction = state.economicsVersion === 2
      ? (createHmac("sha256", state.outcomeSeed!).update(`${state.roundId}:${market.id}`).digest()[0] < 128 ? "up" : "down")
      : outcomeFor(volume, pool.total);
    const close = state.economicsVersion === 2 ? closingPrice(market, asset.open, direction === "up" ? 0 : 1, 1) : closingPrice(market, asset.open, volume, pool.total);
    const prices = Array.from({ length: 61 }, (_, s) => quoteAt(market, asset.open, close, s * 1000));
    asset.candles = [...asset.candles, { time: state.start, open: asset.open, close,
      high: Math.max(...prices), low: Math.min(...prices), volume, warmup: false }].slice(-100);
    result.assets[market.id] = { volume, direction, open: asset.open, close };
    asset.open = close;
  }
  // Stable wallet lock order, and only funded open trades can ever pay out.
  const pending = await tx.select().from(trades)
    .where(and(eq(trades.roundId, state.roundId), eq(trades.status, "open")))
    .orderBy(asc(trades.userId), asc(trades.id));
  for (const trade of pending) {
    const { direction, close } = result.assets[trade.asset];
    const status = direction === "flat" ? "refund" : (trade.side === "buy") === (direction === "up") ? "won" : "lost";
    const payout = status === "refund" ? trade.amount : status === "won" ? trade.amount * (state.economicsVersion === 2 ? 17 : 19) / 10 : 0;
    if (payout > 0) {
      await postEntry({ userId: trade.userId, scope: "forex-trading", type: status === "refund" ? "refund" : "win",
        amount: BigInt(payout), refType: "forex_payout", refId: trade.id,
        memo: `Forex ${trade.asset} ${status === "refund" ? "flat refund" : "prediction return"}` }, tx);
      changed.add(trade.userId);
    }
    await tx.update(trades).set({ status, payout, closePrice: close, settled: result.time }).where(eq(trades.id, trade.id));
  }
  state.results = [result, ...state.results].slice(0, 30);
  // Recover the old funded round before skipping empty downtime.
  state.start = Math.floor(now / ROUND_MS) * ROUND_MS;
  state.roundId = Math.floor(state.start / ROUND_MS);
  state.economicsVersion = 2;
  state.outcomeSeed = randomBytes(32).toString("hex");
  await tx.update(markets).set({ data: state }).where(eq(markets.id, 1));
  return state;
}

async function snapshot(tx: TxClient, userId: string, walletId: string, state: ForexMarketState, now: number): Promise<ForexState> {
  const pool = await pools(tx, state.roundId);
  const elapsed = Math.max(0, Math.min(ROUND_MS, now - state.start));
  const assets = MARKETS.map(market => {
    const asset = state.assets[market.id], volume = pool.volumes[market.id];
    const target = closingPrice(market, asset.open, volume, pool.total);
    const price = quoteAt(market, asset.open, target, elapsed);
    const trail = Array.from({ length: Math.floor(elapsed / 1000) + 1 }, (_, i) => quoteAt(market, asset.open, target, i * 1000));
    return { ...market, open: asset.open, price, volume, direction: state.economicsVersion === 2 ? "flat" as const : outcomeFor(volume, pool.total),
      ticks: quoteTrail(market, asset.candles, asset.open, target, state.start, elapsed),
      candles: [...asset.candles, { time: state.start, open: asset.open, close: price,
        high: Math.max(price, ...trail), low: Math.min(price, ...trail), volume, warmup: false }] };
  });
  const slips = await tx.select().from(trades).where(eq(trades.userId, userId))
    .orderBy(desc(trades.opened), desc(trades.id)).limit(100);
  const [stats] = await tx.select({ settled: sql<number>`count(*) filter (where ${trades.status} != 'open')::int`,
    wins: sql<number>`count(*) filter (where ${trades.status} = 'won')::int`,
    profit: sql<number>`coalesce(sum(${trades.payout} - ${trades.amount}) filter (where ${trades.status} != 'open'), 0)::float8 / 100`,
  }).from(trades).where(eq(trades.userId, userId));
  return { mode: "wallet", currency: "INR", serverTime: now,
    round: { economicsVersion: state.economicsVersion ?? 1, returnMultiplier: state.economicsVersion === 2 ? 1.7 : 1.9, commitment: state.outcomeSeed ? createHash("sha256").update(state.outcomeSeed).digest("hex") : undefined, id: state.roundId, start: state.start, lockAt: state.start + ORDER_MS,
      endAt: state.start + ROUND_MS, phase: elapsed < ORDER_MS ? "open" : "locked" },
    assets, pool: { total: pool.total, average: pool.total / MARKETS.length, orders: pool.orders, participants: pool.participants },
    account: { balance: Number(await getBalance(walletId, tx)) / 100, ...stats },
    trades: slips.map(({ id, roundId, asset, side, amount, status, payout, opened, openPrice, closePrice }) =>
      ({ id, roundId, asset, side, amount: amount / 100, status, payout: payout / 100, opened, openPrice, closePrice })),
    results: state.results };
}

async function notify(changed: Set<string>) {
  for (const userId of changed) {
    try {
      const { balance } = await getBalanceByUser(userId);
      publishWalletBalance({ userId, scope: "forex-trading", balance, entryType: "adjustment", amount: 0n });
    } catch (error) { logger.error({ error, userId }, "Forex wallet notification failed"); }
  }
}

async function table(userId: string, input?: TradeInput) {
  const wallet = await ensureWallet(userId);
  const changed = new Set<string>();
  const result = await db.transaction(async tx => {
    await lock(tx);
    const now = await serverTime(tx);
    const state = await advance(tx, now, changed);
    if (input) {
      const [existing] = await tx.select().from(trades)
        .where(and(eq(trades.userId, userId), eq(trades.requestId, input.requestId)));
      if (existing) {
        if (existing.asset !== input.asset || existing.side !== input.side || existing.amount !== input.amount * 100 || existing.roundId !== input.roundId)
          throw conflict("Request ID already used for another trade.");
      } else {
        if (input.roundId !== state.roundId || now >= state.start + ORDER_MS)
          throw conflict("Orders are locked. Wait for the next round.");
        const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(trades)
          .where(and(eq(trades.userId, userId), eq(trades.roundId, state.roundId)));
        if (count.n >= 30) throw badRequest("Maximum 30 orders per round.");
        const [trade] = await tx.insert(trades).values({ userId, requestId: input.requestId, roundId: state.roundId,
          asset: input.asset, side: input.side, amount: input.amount * 100, opened: now,
          openPrice: state.assets[input.asset].open }).returning();
        try {
          await postEntry({ userId, scope: "forex-trading", type: "bet", amount: -BigInt(trade.amount),
            refType: "forex_bet", refId: trade.id, memo: `Forex ${input.asset} ${input.side.toUpperCase()}` }, tx);
        } catch (error) {
          if ((error as Error).message === "INSUFFICIENT_FUNDS") throw badRequest("Not enough wallet balance. Open Wallet to add funds.");
          throw error;
        }
        // A wallet lock held by another game cannot admit a prediction past cutoff.
        if (await serverTime(tx) >= state.start + ORDER_MS)
          throw conflict("Orders are locked. Wait for the next round.");
        changed.add(userId);
      }
    }
    return snapshot(tx, userId, wallet.id, state, await serverTime(tx));
  });
  await notify(changed);
  return result;
}

export function forexState(userId: string) { return table(userId); }
export function placeForexTrade(userId: string, input: unknown) { return table(userId, tradeSchema.parse(input)); }
export async function tickForex() {
  const changed = new Set<string>();
  await db.transaction(async tx => { await lock(tx); await advance(tx, await serverTime(tx), changed); });
  await notify(changed);
}
export function startForexEngine() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await tickForex(); }
    catch (error) { logger.error({ error }, "Forex settlement failed"); }
    finally { busy = false; }
  };
  void tick();
  const timer = setInterval(tick, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
