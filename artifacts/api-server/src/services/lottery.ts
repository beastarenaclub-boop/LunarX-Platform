import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, lotterySettingsTable as settings, lotteryDrawsTable as draws, lotteryTicketsTable as tickets,
  betsTable, usersTable, gameConfigTable, auditLogTable, type LotterySettings } from "@workspace/db";
import { badRequest, conflict, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import { ensureWallet, getBalance, getBalanceByUser, postEntry, publishWalletBalance, type TxClient } from "./wallet";
import { LOTTERY_DEFAULTS, lotteryHash, lotteryPayout, lotteryPurchaseSchema, lotteryRequestSchema, lotteryResults, lotterySettingsSchema } from "./lotteryMath";

type TicketRow = typeof tickets.$inferSelect;
type DrawRow = typeof draws.$inferSelect;
const rupees = (amount: bigint) => Number(amount) / 100;
const publicDraw = ({ seed, ...draw }: DrawRow) => ({ ...draw, ...(draw.status === "settled" ? { seed } : {}) });
const publicTicket = (t: TicketRow, name?: string) => ({ id: t.id, seller_id: t.userId, seller_name: name,
  agent_id: null, draw_id: t.drawId, game: t.game, lines: t.lines, total: rupees(t.stake), payout: rupees(t.payout),
  commission: 0, status: t.status, customer: "", created: t.created, claimed: t.claimed, print_count: 0 });
async function clock(tx: TxClient) {
  const { rows } = await tx.execute<{ now: string }>(sql`select (extract(epoch from clock_timestamp()) * 1000)::bigint::text as now`);
  return Number(rows[0].now);
}
async function lock(tx: TxClient) { await tx.execute(sql`select pg_advisory_xact_lock(73482109)`); }
async function configuration(tx: TxClient) {
  await tx.insert(settings).values({ id: 1, value: LOTTERY_DEFAULTS }).onConflictDoNothing();
  const [row] = await tx.select().from(settings).where(eq(settings.id, 1));
  return row;
}
async function advance(tx: TxClient, now: number, changed: Set<string>) {
  const overdue = await tx.select().from(draws).where(and(eq(draws.status, "open"), lte(draws.ends, now))).orderBy(asc(draws.ends));
  for (const draw of overdue) {
    const results = lotteryResults(draw.seed);
    const slips = await tx.select().from(tickets).where(and(eq(tickets.drawId, draw.id), eq(tickets.status, "pending")))
      .orderBy(asc(tickets.userId), asc(tickets.id));
    for (const slip of slips) {
      const payout = lotteryPayout(slip.lines, slip.game, draw.config, results);
      if (payout > 0n) {
        await postEntry({ userId: slip.userId, scope: "lottery", type: "win", amount: payout,
          refType: "lottery_payout", refId: slip.id, memo: `Irland Lotto ${slip.game} prize`, metadata: { gameCode: "lottery", drawId: draw.id } }, tx);
        changed.add(slip.userId);
      }
      await tx.update(tickets).set({ payout, status: payout > 0n ? "claimed" : "lost", claimed: payout > 0n ? now : null }).where(eq(tickets.id, slip.id));
      await tx.update(betsTable).set({ payoutAmount: payout, status: payout > 0n ? "won" : "lost", settledAt: new Date(now),
        multiplier: Number(payout) / Number(slip.stake) }).where(eq(betsTable.id, slip.betId));
    }
    await tx.update(draws).set({ status: "settled", results }).where(eq(draws.id, draw.id));
    await tx.insert(auditLogTable).values({ action: "lottery.draw.settled", targetType: "lottery_draw", targetId: draw.id,
      after: { commitment: draw.commitment, ticketCount: slips.length } });
  }
  const { value } = await configuration(tx);
  const open = await tx.select({ ends: draws.ends }).from(draws).where(eq(draws.status, "open")).orderBy(desc(draws.ends));
  const step = value.interval * 60000;
  let end = open[0] ? open[0].ends + step : Math.floor(now / step) * step + step;
  for (let n = open.length; n < 8; n++, end += step) {
    const seed = randomBytes(32).toString("hex");
    await tx.insert(draws).values({ id: `IRLAND-${end}`, ends: end, closes: end - 10000,
      seed, commitment: lotteryHash(seed), config: value });
  }
}
async function notify(changed: Set<string>) {
  for (const userId of changed) {
    try {
      const { balance } = await getBalanceByUser(userId);
      publishWalletBalance({ userId, scope: "lottery", balance, entryType: "adjustment", amount: 0n });
    } catch (error) { logger.error({ error, userId }, "Lottery wallet notification failed"); }
  }
}
async function transaction<T>(fn: (tx: TxClient, now: number, changed: Set<string>) => Promise<T>) {
  const changed = new Set<string>();
  const result = await db.transaction(async tx => {
    await lock(tx);
    const now = await clock(tx);
    await advance(tx, now, changed);
    return fn(tx, now, changed);
  });
  await notify(changed);
  return result;
}
async function gamePolicy(tx: TxClient) {
  const [config] = await tx.select().from(gameConfigTable).where(eq(gameConfigTable.gameCode, "lottery")).for("share");
  if (!config) throw conflict("Lottery is being configured. Please retry shortly.");
  return config;
}
export async function lotteryState(userId: string) {
  const wallet = await ensureWallet(userId);
  return transaction(async (tx, now) => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) throw notFound("Account not found.");
    const policy = await gamePolicy(tx);
    const config = await configuration(tx);
    const mine = await tx.select().from(tickets).where(eq(tickets.userId, userId)).orderBy(desc(tickets.created), desc(tickets.id)).limit(200);
    const recent = await tx.select().from(draws).orderBy(desc(draws.ends)).limit(80);
    const missing = [...new Set(mine.map(t => t.drawId))].filter(id => !recent.some(d => d.id === id));
    const extra = missing.length ? await tx.select().from(draws).where(inArray(draws.id, missing)) : [];
    const [stats] = await tx.select({ sales: sql<string>`coalesce(sum(${tickets.stake}) filter (where ${tickets.status} <> 'cancelled'), 0)::text`,
      prizes: sql<string>`coalesce(sum(${tickets.payout}), 0)::text`, count: sql<number>`count(*)::int`,
      cancelled: sql<number>`count(*) filter (where ${tickets.status} = 'cancelled')::int` }).from(tickets).where(eq(tickets.userId, userId));
    return { mode: "wallet", serverTime: now,
      account: { id: user.id, name: user.displayName || user.email, role: "user", parent_id: null,
        balance: rupees(await getBalance(wallet.id, tx)), commission: 0, active: 1, created: user.createdAt.getTime() },
      settings: { ...config.value, salesEnabled: policy.enabled && config.value.salesEnabled,
        maxTicket: Math.min(config.value.maxTicket, rupees(policy.maxStakePaise)) },
      draws: [...recent, ...extra].sort((a, b) => a.ends - b.ends).map(publicDraw), tickets: mine.map(t => publicTicket(t)),
      accounts: [], ledger: [], complaints: [], audit: [],
      stats: { sales: rupees(BigInt(stats.sales)), prizes: rupees(BigInt(stats.prizes)), tickets: stats.count,
        cancelled: stats.cancelled, commission: 0, pendingClaims: 0 } };
  });
}
export async function buyLotteryTicket(userId: string, input: unknown, request: unknown) {
  const body = lotteryPurchaseSchema.parse(input);
  const key = lotteryRequestSchema.parse(request), hash = lotteryHash(JSON.stringify(body));
  return transaction(async (tx, now, changed) => {
    const [existing] = await tx.select().from(tickets).where(and(eq(tickets.userId, userId), eq(tickets.request, key)));
    if (existing) {
      if (existing.requestHash !== hash) throw conflict("This request was already used for another ticket.");
      return publicTicket(existing);
    }
    const policy = await gamePolicy(tx);
    const { value } = await configuration(tx);
    if (!policy.enabled || !value.salesEnabled) throw conflict("Lottery sales are paused.");
    const [draw] = await tx.select().from(draws).where(eq(draws.id, body.drawId));
    if (!draw || draw.status !== "open" || now >= draw.closes) throw conflict("This draw is closed. Choose the next draw.");
    const lines = body.lines.map(line => ({ ...line, unitPrice: draw.config.seriesPrices[line.series] }));
    const stake = lines.reduce((sum, line) => sum + BigInt(line.quantity) * BigInt(line.unitPrice) * 100n, 0n);
    const max = BigInt(Math.min(draw.config.maxTicket, value.maxTicket)) * 100n;
    if (stake > max || stake > policy.maxStakePaise || stake < policy.minStakePaise) throw badRequest("Ticket amount is outside the current lottery limit.");
    const id = `IRLAND-${nanoid(16)}`;
    await tx.insert(betsTable).values({ id, userId, gameCode: "lottery", roundId: draw.id, stakeAmount: stake,
      metadata: { ticketId: id, game: body.game, lines }, placedAt: new Date(now) });
    const [ticket] = await tx.insert(tickets).values({ id, betId: id, userId, drawId: draw.id, game: body.game, lines,
      stake, request: key, requestHash: hash, created: now }).returning();
    try {
      await postEntry({ userId, scope: "lottery", type: "bet", amount: -stake, refType: "lottery_ticket", refId: id,
        memo: `Irland Lotto ${body.game} ticket`, metadata: { gameCode: "lottery", drawId: draw.id } }, tx);
    } catch (error) {
      if ((error as Error).message === "INSUFFICIENT_FUNDS") throw badRequest("Wallet balance is too low for this ticket.");
      throw error;
    }
    // Another game's debit may hold the wallet lock until this draw has closed.
    if (await clock(tx) >= draw.closes) throw conflict("This draw is closed. Choose the next draw.");
    changed.add(userId);
    return publicTicket(ticket);
  });
}
export function cancelLotteryTicket(userId: string, id: string) {
  return transaction(async (tx, _now, changed) => {
    const [ticket] = await tx.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.userId, userId)));
    if (!ticket) throw notFound("Ticket not found.");
    if (ticket.status === "cancelled") return publicTicket(ticket);
    const [draw] = await tx.select().from(draws).where(eq(draws.id, ticket.drawId));
    if (ticket.status !== "pending" || await clock(tx) >= draw.closes) throw conflict("Only open-draw tickets can be cancelled.");
    await postEntry({ userId, scope: "lottery", type: "refund", amount: ticket.stake, refType: "lottery_refund", refId: id,
      memo: "Irland Lotto ticket cancelled", metadata: { gameCode: "lottery", drawId: draw.id } }, tx);
    if (await clock(tx) >= draw.closes) throw conflict("This draw has closed. Cancellation was not applied.");
    await tx.update(tickets).set({ status: "cancelled" }).where(eq(tickets.id, id));
    await tx.update(betsTable).set({ status: "voided", settledAt: new Date(), payoutAmount: 0n }).where(eq(betsTable.id, ticket.betId));
    await tx.insert(auditLogTable).values({ actorId: userId, action: "lottery.ticket.cancelled", targetType: "lottery_ticket", targetId: id });
    changed.add(userId);
    return publicTicket({ ...ticket, status: "cancelled" });
  });
}
export function lotteryAdminState(page = 1) {
  return transaction(async (tx, now) => {
    const config = await configuration(tx), policy = await gamePolicy(tx);
    const rows = await tx.select({ ticket: tickets, name: usersTable.displayName, email: usersTable.email }).from(tickets)
      .innerJoin(usersTable, eq(tickets.userId, usersTable.id)).orderBy(desc(tickets.created), desc(tickets.id)).limit(50).offset((page - 1) * 50);
    const recentDraws = await tx.select().from(draws).orderBy(desc(draws.ends)).limit(60);
    const [totals] = await tx.select({ count: sql<number>`count(*)::int`, pending: sql<number>`count(*) filter (where ${tickets.status} = 'pending')::int`,
      sales: sql<string>`coalesce(sum(${tickets.stake}) filter (where ${tickets.status} <> 'cancelled'), 0)::text`,
      prizes: sql<string>`coalesce(sum(${tickets.payout}), 0)::text`,
      refunds: sql<string>`coalesce(sum(${tickets.stake}) filter (where ${tickets.status} = 'cancelled'), 0)::text` }).from(tickets);
    return { serverTime: now, settings: config.value, version: config.version, enabled: policy.enabled,
      page, pages: Math.max(1, Math.ceil(totals.count / 50)), tickets: rows.map(r => publicTicket(r.ticket, r.name || r.email)),
      draws: recentDraws.map(publicDraw), totals: { ...totals, sales: rupees(BigInt(totals.sales)),
        prizes: rupees(BigInt(totals.prizes)), refunds: rupees(BigInt(totals.refunds)) } };
  });
}
export function updateLotterySettings(actorId: string, input: unknown) {
  const body = lotterySettingsSchema.parse(input);
  return transaction(async tx => {
    const before = await configuration(tx);
    if (before.version !== body.version) throw conflict("Settings changed in another session. Refresh before saving.");
    const value: LotterySettings = { ...before.value, interval: body.interval, maxTicket: body.maxTicket, salesEnabled: body.salesEnabled };
    await tx.update(settings).set({ value, version: before.version + 1 }).where(eq(settings.id, 1));
    await tx.insert(auditLogTable).values({ actorId, action: "lottery.settings.updated", targetType: "lottery_settings", targetId: "1", before: before.value, after: value });
    return { settings: value, version: before.version + 1 };
  });
}
export async function tickLottery() { await transaction(async () => undefined); }
export function startLotteryEngine() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await tickLottery(); } catch (error) { logger.error({ error }, "Lottery settlement failed"); }
    finally { busy = false; }
  };
  void tick();
  const timer = setInterval(tick, 1000); timer.unref();
  return () => clearInterval(timer);
}
