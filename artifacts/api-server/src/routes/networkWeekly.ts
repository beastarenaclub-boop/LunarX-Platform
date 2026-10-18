import { Router, type IRouter } from "express";
import { db, auditLogTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { nanoid } from "nanoid";
import { networkIdentity } from "../services/network";
import { weeklyStatus } from "../services/networkWeekly";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import {parseTransactionQuery,transactionConditions,transactionPage} from '../services/transactionFilters';

const router: IRouter = Router();
router.get("/", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    if(actor.role==='agent')throw forbidden('Weekly commission accounts are available to the master and platform administrator');
    const masterId =
      actor.role === "admin"
        ? z.string().min(1).parse(req.query.masterId)
        : actor.node.kind === "master"
          ? actor.node.id
          : actor.node.parentId!;
    const status = await weeklyStatus(masterId);
    if (!status) throw notFound();
    const filter=parseTransactionQuery(req.query);
    const paymentParts=[sql`p.master_id=${masterId}`,...transactionConditions(filter,{time:sql`p.created_at`,amount:sql`p.amount`,status:sql`p.status`,text:[sql`p.id`,sql`p.reference`,sql`p.review_note`]})];
    const [weeks, payments] = await Promise.all([
      db.execute(sql`SELECT (date_trunc('week',l.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS start,
        (date_trunc('week',l.created_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')+interval '7 days' AS "end",
        sum(l.amount)::text AS commission, sum(l.gross_stake)::text AS stake, sum(l.gross_payout)::text AS payout
        FROM network_ledger l JOIN network_nodes n ON n.id=l.master_id
        WHERE l.master_id=${masterId} AND l.account_kind='company' AND l.created_at>=n.weekly_started_at
        GROUP BY 1 ORDER BY 1 DESC LIMIT 104`),
      transactionPage(sql`SELECT p.id,p.amount::text,p.reference,p.status,p.review_note,p.created_at,p.reviewed_at FROM network_weekly_payments p WHERE ${sql.join(paymentParts,sql` AND `)}`,filter),
    ]);
    res
      .set("Cache-Control", "no-store")
      .json({
        masterId,
        ...status,
        weeks: weeks.rows,
        payments: payments.items,
        paymentTotal:payments.total,
        paymentSummary:payments.summary,
      });
  } catch (e) {
    next(e);
  }
});
const paymentInput = z
  .object({
    masterId: z.string().min(1).max(100),
    amountPaise: z.string().regex(/^[1-9]\d{0,12}$/),
    reference: z.string().trim().min(3).max(200),
    requestId: z.string().min(16).max(100),
  })
  .strict();
router.post("/payments", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    const input = paymentInput.parse(req.body);
    if (
      actor.role !== "admin" &&
      !(actor.role === "master" && actor.node.id === input.masterId)
    )
      throw forbidden();
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestId},0))`,
      );
      const master = await tx.execute(
        sql`SELECT id FROM network_nodes WHERE id=${input.masterId} AND kind='master' FOR UPDATE`,
      );
      if (!master.rows[0]) throw notFound();
      const prior = await tx.execute(
        sql`SELECT * FROM network_weekly_payments WHERE request_id=${input.requestId}`,
      );
      if (prior.rows[0]) {
        const row = prior.rows[0];
        if (
          row.master_id !== input.masterId ||
          String(row.amount) !== input.amountPaise ||
          row.reference !== input.reference ||
          row.submitted_by !== req.user!.id
        )
          throw conflict("Request ID already used");
        return { id: row.id };
      }
      const total = await tx.execute(
        sql`SELECT network_weekly_due(${input.masterId},clock_timestamp(),false)::text AS due`,
      );
      const pending = await tx.execute(
        sql`SELECT COALESCE(sum(amount),0)::text AS amount FROM network_weekly_payments WHERE master_id=${input.masterId} AND status='pending'`,
      );
      if (
        BigInt(input.amountPaise) >
        BigInt(String(total.rows[0]!.due)) -
          BigInt(String(pending.rows[0]!.amount))
      )
        throw badRequest(
          "Amount exceeds unpaid closed-week commission, after pending payments",
        );
      const id = nanoid();
      await tx.execute(
        sql`INSERT INTO network_weekly_payments(id,master_id,amount,reference,request_id,submitted_by) VALUES(${id},${input.masterId},${input.amountPaise}::bigint,${input.reference},${input.requestId},${req.user!.id})`,
      );
      await tx
        .insert(auditLogTable)
        .values({
          actorId: req.user!.id,
          actorRole: req.user!.role,
          action: "network.weekly.submit",
          targetType: "network",
          targetId: id,
          after: input,
        });
      return { id };
    });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});
router.post("/payments/:id/review", async (req, res, next) => {
  try {
    if ((await networkIdentity(req.user!)).role !== "admin") throw forbidden();
    const input = z
      .object({
        status: z.enum(["confirmed", "rejected"]),
        note: z.string().trim().min(3).max(200),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      // All submissions/reviews serialize on the same master before the payment row.
      const found = await tx.execute(
        sql`SELECT master_id FROM network_weekly_payments WHERE id=${String(req.params.id)}`,
      );
      if (!found.rows[0]) throw notFound();
      await tx.execute(
        sql`SELECT id FROM network_nodes WHERE id=${String(found.rows[0].master_id)} FOR UPDATE`,
      );
      const result = await tx.execute(
        sql`SELECT * FROM network_weekly_payments WHERE id=${String(req.params.id)} FOR UPDATE`,
      );
      const p = result.rows[0]!;
      if (p.status !== "pending") {
        if (p.status === input.status) return;
        throw conflict("Payment already reviewed");
      }
      if (input.status === "confirmed") {
        const total = await tx.execute(
          sql`SELECT network_weekly_due(${String(p.master_id)},clock_timestamp(),false)::text AS due`,
        );
        if (BigInt(String(p.amount)) > BigInt(String(total.rows[0]!.due)))
          throw badRequest(
            "Payment exceeds outstanding commission. Reject this submission and enter the corrected amount.",
          );
      }
      await tx.execute(
        sql`UPDATE network_weekly_payments SET status=${input.status},reviewed_by=${req.user!.id},review_note=${input.note},reviewed_at=clock_timestamp() WHERE id=${String(p.id)}`,
      );
      await tx
        .insert(auditLogTable)
        .values({
          actorId: req.user!.id,
          actorRole: req.user!.role,
          action: "network.weekly.review",
          targetType: "network",
          targetId: String(p.id),
          after: input,
        });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
export default router;
