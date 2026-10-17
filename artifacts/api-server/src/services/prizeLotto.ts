import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  prizeSettingsTable as settings,
  prizeDrawsTable as draws,
  prizeTicketsTable as tickets,
  betsTable,
  auditLogTable,
} from "@workspace/db";
import {
  PRIZE_DEFAULTS,
  PRIZE_MULTIPLIER,
  prizePurchaseSchema,
  prizeRequestSchema,
  prizeSettingsUpdateSchema,
  prizeFulfillmentSchema,
  type PrizeState,
  type PrizeAdminState,
  type PrizeTicket,
  type PrizeDraw,
} from "@workspace/api-zod/prize-lotto";
import { badRequest, conflict, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  ensureWallet,
  getBalance,
  getBalanceByUser,
  postEntry,
  publishWalletBalance,
  type TxClient,
} from "./wallet";
import { prizeCommitment, prizeHash, prizeResult } from "./prizeLottoMath";

const rupees = (v: bigint | string) => Number(v) / 100;
const publicDraw = ({
  seed,
  ...draw
}: typeof draws.$inferSelect): PrizeDraw => ({
  ...draw,
  ...(draw.status === "settled" ? { seed } : {}),
});
const publicTicket = (
  t: typeof tickets.$inferSelect,
  owner = true,
): PrizeTicket => ({
  id: t.id,
  userId: t.userId,
  drawId: t.drawId,
  reward: t.reward,
  amount: rupees(t.stake),
  prize: rupees(t.prize),
  status: t.status,
  claimStatus: t.claimStatus,
  created: t.created,
  delivery: owner ? t.delivery : null,
});
async function clock(tx: TxClient) {
  const { rows } = await tx.execute<{ now: string }>(
    sql`select (extract(epoch from clock_timestamp())*1000)::bigint::text as now`,
  );
  return Number(rows[0].now);
}
async function configuration(tx: TxClient) {
  await tx
    .insert(settings)
    .values({ id: 1, value: PRIZE_DEFAULTS })
    .onConflictDoNothing();
  const [row] = await tx.select().from(settings).where(eq(settings.id, 1));
  return row;
}
async function advance(tx: TxClient, now: number, changed: Set<string>) {
  const overdue = await tx
    .select()
    .from(draws)
    .where(and(eq(draws.status, "open"), lte(draws.ends, now)))
    .orderBy(asc(draws.ends));
  for (const draw of overdue) {
    if (prizeCommitment(draw.seed, draw.id, draw.config) !== draw.commitment)
      throw new Error(`Prize draw commitment mismatch: ${draw.id}`);
    // Outcome depends only on the precommitted seed and rules. Stakes are never an input.
    const result = prizeResult(draw.seed, draw.id, draw.config.rtp);
    const slips = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.drawId, draw.id), eq(tickets.status, "pending")))
      .orderBy(asc(tickets.userId), asc(tickets.id));
    for (const slip of slips) {
      const won = result === slip.reward,
        prize = won ? slip.stake * BigInt(PRIZE_MULTIPLIER) : 0n;
      const cash = won && slip.reward === "cashback";
      if (cash) {
        await postEntry(
          {
            userId: slip.userId,
            scope: "prize-lotto",
            type: "win",
            amount: prize,
            refType: "prize_lotto_cashback",
            refId: slip.id,
            memo: "Prize Lotto cashback",
            metadata: { gameCode: "prize-lotto", drawId: draw.id },
          },
          tx,
        );
        changed.add(slip.userId);
      }
      await tx
        .update(tickets)
        .set({
          prize,
          status: won ? "won" : "lost",
          claimStatus: cash ? "credited" : won ? "available" : "none",
        })
        .where(eq(tickets.id, slip.id));
      await tx
        .update(betsTable)
        .set({
          status: won ? "won" : "lost",
          payoutAmount: cash ? prize : 0n,
          multiplier: won ? PRIZE_MULTIPLIER : 0,
          settledAt: new Date(now),
          metadata: {
            ticketId: slip.id,
            reward: slip.reward,
            rewardValuePaise: prize.toString(),
            fulfillment: cash ? "wallet" : won ? "voucher" : "none",
          },
        })
        .where(eq(betsTable.id, slip.betId));
    }
    await tx
      .update(draws)
      .set({ status: "settled", result })
      .where(eq(draws.id, draw.id));
    await tx
      .insert(auditLogTable)
      .values({
        action: "prize.draw.settled",
        targetType: "prize_draw",
        targetId: draw.id,
        after: { result, commitment: draw.commitment, tickets: slips.length },
      });
  }
  const { value } = await configuration(tx);
  const open = await tx
    .select()
    .from(draws)
    .where(eq(draws.status, "open"))
    .orderBy(desc(draws.ends));
  const step = value.intervalSeconds * 1000;
  let end = open[0]
    ? open[0].ends + step
    : Math.floor(now / step) * step + step;
  for (let n = open.length; n < 2; n++, end += step) {
    const id = `PRIZE-${end}`,
      seed = randomBytes(32).toString("hex");
    await tx
      .insert(draws)
      .values({
        id,
        ends: end,
        closes: end - 5000,
        seed,
        config: value,
        commitment: prizeCommitment(seed, id, value),
      });
  }
}
async function transaction<T>(
  fn: (tx: TxClient, now: number, changed: Set<string>) => Promise<T>,
) {
  const changed = new Set<string>();
  const value = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73482110)`);
    const now = await clock(tx);
    await advance(tx, now, changed);
    return fn(tx, now, changed);
  });
  for (const userId of changed) {
    try {
      const { balance } = await getBalanceByUser(userId);
      publishWalletBalance({
        userId,
        scope: "prize-lotto",
        balance,
        entryType: "adjustment",
        amount: 0n,
      });
    } catch (error) {
      logger.error({ error, userId }, "Prize Lotto wallet notification failed");
    }
  }
  return value;
}
export async function prizeState(
  userId: string,
  page = 1,
): Promise<PrizeState> {
  const wallet = await ensureWallet(userId);
  return transaction(async (tx, now) => {
    const { value } = await configuration(tx);
    const mine = await tx
      .select()
      .from(tickets)
      .where(eq(tickets.userId, userId))
      .orderBy(desc(tickets.created), desc(tickets.id))
      .limit(30)
      .offset((page - 1) * 30);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets)
      .where(eq(tickets.userId, userId));
    const recent = await tx
      .select()
      .from(draws)
      .orderBy(desc(draws.ends))
      .limit(32);
    const missing = [...new Set(mine.map((t) => t.drawId))].filter(
      (id) => !recent.some((d) => d.id === id),
    );
    const extra = missing.length
      ? await tx.select().from(draws).where(inArray(draws.id, missing))
      : [];
    return {
      serverTime: now,
      balance: rupees(await getBalance(wallet.id, tx)),
      salesEnabled: value.salesEnabled,
      maxTicket: value.maxTicket,
      draws: [...recent, ...extra].map(publicDraw),
      tickets: mine.map((t) => publicTicket(t)),
      ticketCount: count,
      page,
      pages: Math.max(1, Math.ceil(count / 30)),
    };
  });
}
export function buyPrizeTicket(
  userId: string,
  input: unknown,
  request: unknown,
) {
  const body = prizePurchaseSchema.parse(input),
    key = prizeRequestSchema.parse(request),
    hash = prizeHash(JSON.stringify(body));
  return transaction(async (tx, now, changed) => {
    const [existing] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.userId, userId), eq(tickets.request, key)));
    if (existing) {
      if (existing.requestHash !== hash)
        throw conflict("This request belongs to another ticket.");
      return publicTicket(existing);
    }
    const { value } = await configuration(tx);
    if (!value.salesEnabled) throw conflict("Ticket sales are paused.");
    const [draw] = await tx
      .select()
      .from(draws)
      .where(eq(draws.id, body.drawId));
    if (!draw || draw.status !== "open" || now >= draw.closes)
      throw conflict("This draw is closed. Please choose the next draw.");
    if (body.amount > Math.min(value.maxTicket, draw.config.maxTicket))
      throw badRequest("Ticket exceeds the current limit.");
    const stake = BigInt(body.amount) * 100n;
    const [{ total }] = await tx
      .select({ total: sql<string>`coalesce(sum(${tickets.stake}),0)::text` })
      .from(tickets)
      .where(
        and(
          eq(tickets.drawId, draw.id),
          eq(tickets.reward, body.reward),
          eq(tickets.status, "pending"),
        ),
      );
    if (
      (BigInt(total) + stake) * BigInt(PRIZE_MULTIPLIER) >
      BigInt(Math.min(value.maxLiability, draw.config.maxLiability)) * 100n
    )
      throw conflict(
        "This reward has reached its draw limit. Choose another reward or wait for the next draw.",
      );
    const id = `PL-${nanoid(16)}`;
    await tx
      .insert(betsTable)
      .values({
        id,
        userId,
        gameCode: "prize-lotto",
        roundId: draw.id,
        stakeAmount: stake,
        metadata: { ticketId: id, reward: body.reward },
        placedAt: new Date(now),
      });
    const [ticket] = await tx
      .insert(tickets)
      .values({
        id,
        betId: id,
        userId,
        drawId: draw.id,
        reward: body.reward,
        stake,
        request: key,
        requestHash: hash,
        created: now,
      })
      .returning();
    try {
      await postEntry(
        {
          userId,
          scope: "prize-lotto",
          type: "bet",
          amount: -stake,
          refType: "prize_lotto_ticket",
          refId: id,
          memo: `Prize Lotto ${body.reward} ticket`,
          metadata: { gameCode: "prize-lotto", drawId: draw.id },
        },
        tx,
      );
    } catch (error) {
      if ((error as Error).message === "INSUFFICIENT_FUNDS")
        throw badRequest("Insufficient wallet balance.");
      throw error;
    }
    if ((await clock(tx)) >= draw.closes)
      throw conflict(
        "This draw closed before payment completed. Your wallet was not charged.",
      );
    changed.add(userId);
    return publicTicket(ticket);
  });
}
export function cancelPrizeTicket(userId: string, id: string) {
  return transaction(async (tx, _now, changed) => {
    const [ticket] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, id), eq(tickets.userId, userId)));
    if (!ticket) throw notFound("Ticket not found.");
    if (ticket.status === "cancelled") return publicTicket(ticket);
    const [draw] = await tx
      .select()
      .from(draws)
      .where(eq(draws.id, ticket.drawId));
    if (ticket.status !== "pending" || (await clock(tx)) >= draw.closes)
      throw conflict("Cancellation closes five seconds before the draw.");
    await postEntry(
      {
        userId,
        scope: "prize-lotto",
        type: "refund",
        amount: ticket.stake,
        refType: "prize_lotto_refund",
        refId: id,
        memo: "Prize Lotto cancellation",
      },
      tx,
    );
    if ((await clock(tx)) >= draw.closes)
      throw conflict("Draw closed. Cancellation was not applied.");
    await tx
      .update(tickets)
      .set({ status: "cancelled" })
      .where(eq(tickets.id, id));
    await tx
      .update(betsTable)
      .set({ status: "voided", payoutAmount: 0n, settledAt: new Date() })
      .where(eq(betsTable.id, ticket.betId));
    changed.add(userId);
    return publicTicket({ ...ticket, status: "cancelled" });
  });
}
export function claimPrize(userId: string, id: string) {
  return transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, id), eq(tickets.userId, userId)));
    if (!ticket) throw notFound("Ticket not found.");
    if (
      ticket.claimStatus === "requested" ||
      ticket.claimStatus === "fulfilled"
    )
      return publicTicket(ticket);
    if (ticket.status !== "won" || ticket.claimStatus !== "available")
      throw conflict("This ticket has no voucher to claim.");
    await tx
      .update(tickets)
      .set({ claimStatus: "requested" })
      .where(eq(tickets.id, id));
    await tx
      .insert(auditLogTable)
      .values({
        actorId: userId,
        action: "prize.claim.requested",
        targetType: "prize_ticket",
        targetId: id,
      });
    return publicTicket({ ...ticket, claimStatus: "requested" });
  });
}
export function fulfillPrize(actorId: string, id: string, input: unknown) {
  const delivery = prizeFulfillmentSchema.parse(input);
  return transaction(async (tx, now) => {
    const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, id));
    if (!ticket) throw notFound("Ticket not found.");
    if (ticket.claimStatus === "fulfilled") {
      if (
        JSON.stringify(prizeFulfillmentSchema.parse(ticket.delivery)) !==
        JSON.stringify(delivery)
      )
        throw conflict("This voucher is already fulfilled.");
      return { ok: true };
    }
    if (ticket.claimStatus !== "requested")
      throw conflict("Player must request this voucher first.");
    if (Date.parse(delivery.expiresAt) <= now + 86400000)
      throw badRequest("Voucher must remain valid for at least 24 hours.");
    await tx
      .update(tickets)
      .set({ claimStatus: "fulfilled", delivery })
      .where(eq(tickets.id, id));
    // Codes are private to the owner; never copy them into audit logs or reports.
    await tx
      .insert(auditLogTable)
      .values({
        actorId,
        action: "prize.claim.fulfilled",
        targetType: "prize_ticket",
        targetId: id,
        after: {
          merchant: delivery.merchant,
          expiresAt: delivery.expiresAt,
          valuePaise: ticket.prize.toString(),
        },
      });
    return { ok: true };
  });
}
export function prizeAdminState(
  page = 1,
  claimsOnly = false,
): Promise<PrizeAdminState> {
  return transaction(async (tx, now) => {
    const config = await configuration(tx);
    const where = claimsOnly
      ? inArray(tickets.claimStatus, ["available", "requested"])
      : undefined;
    const rows = await tx
      .select()
      .from(tickets)
      .where(where)
      .orderBy(desc(tickets.created), desc(tickets.id))
      .limit(30)
      .offset((page - 1) * 30);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets)
      .where(where);
    const [totals] = await tx
      .select({
        sales: sql<string>`coalesce(sum(${tickets.stake}) filter(where ${tickets.status} <> 'cancelled'),0)::text`,
        prizes: sql<string>`coalesce(sum(${tickets.prize}),0)::text`,
        cashback: sql<string>`coalesce(sum(${tickets.prize}) filter(where ${tickets.claimStatus} = 'credited'),0)::text`,
        voucherLiability: sql<string>`coalesce(sum(${tickets.prize}) filter(where ${tickets.claimStatus} in ('available','requested')),0)::text`,
        refunds: sql<string>`coalesce(sum(${tickets.stake}) filter(where ${tickets.status} = 'cancelled'),0)::text`,
        pendingClaims: sql<number>`count(*) filter(where ${tickets.claimStatus} = 'requested')::int`,
      })
      .from(tickets);
    return {
      serverTime: now,
      settings: config.value,
      version: config.version,
      page,
      pages: Math.max(1, Math.ceil(count / 30)),
      tickets: rows.map((t) => publicTicket(t, false)),
      draws: (
        await tx.select().from(draws).orderBy(desc(draws.ends)).limit(32)
      ).map(publicDraw),
      totals: {
        sales: rupees(totals.sales),
        prizes: rupees(totals.prizes),
        cashback: rupees(totals.cashback),
        voucherLiability: rupees(totals.voucherLiability),
        refunds: rupees(totals.refunds),
        pendingClaims: totals.pendingClaims,
      },
    };
  });
}
export function updatePrizeSettings(actorId: string, input: unknown) {
  const body = prizeSettingsUpdateSchema.parse(input);
  return transaction(async (tx) => {
    const before = await configuration(tx);
    if (body.version !== before.version)
      throw conflict("Settings changed. Refresh before saving.");
    await tx
      .update(settings)
      .set({ value: body.settings, version: before.version + 1 })
      .where(eq(settings.id, 1));
    await tx
      .insert(auditLogTable)
      .values({
        actorId,
        action: "prize.settings.updated",
        targetType: "prize_settings",
        targetId: "1",
        before: before.value,
        after: body.settings,
      });
    return { settings: body.settings, version: before.version + 1 };
  });
}
export async function tickPrizeLotto() {
  await transaction(async () => undefined);
}
export function startPrizeLottoEngine() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await tickPrizeLotto();
    } catch (error) {
      logger.error({ error }, "Prize Lotto settlement failed");
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(tick, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
