import { db, type User } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { networkIdentity } from "./network";
import {
  parseTransactionQuery,
  transactionConditions,
} from "./transactionFilters";
import { badRequest, forbidden } from "../lib/errors";

const options = z.object({
  method: z.enum(["all", "manual", "auto"]).default("all"),
  type: z.enum(["deposit", "withdrawal_request", "payout"]).optional(),
  status: z
    .enum([
      "pending",
      "gateway_pending",
      "approved",
      "rejected",
      "cancelled",
      "paid",
      "failed",
    ])
    .optional(),
  reconciliation: z
    .enum(["all", "matched", "pending", "needs_review", "request_only"])
    .default("all"),
  format: z.enum(["json", "csv"]).default("json"),
});

export type PaymentHistoryRow = {
  id: string;
  requestId: string;
  type: "deposit" | "withdrawal_request" | "payout";
  userId: string;
  email: string | null;
  masterId: string | null;
  masterName: string | null;
  agentId: string | null;
  agentName: string | null;
  amount: string;
  currency: string;
  status: string;
  method: string;
  reference: string | null;
  createdAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  reviewer: string | null;
  walletAmount: string;
  walletEntries: number;
  reconciliation: "matched" | "pending" | "needs_review" | "request_only";
};

// A read-only bridge over existing records. A legacy request and a payout are
// never matched by amount, timestamp or UTR alone: there is no reliable shared key.
export async function paymentHistory(
  user: User,
  query: unknown,
  customer = false,
) {
  const filter = parseTransactionQuery(query),
    extra = options.parse(query);
  const actor = customer ? null : await networkIdentity(user);
  if (customer && user.role !== "player")
    throw forbidden("Customer payment history requires a player account");
  if (actor && actor.role !== "admin" && filter.channel !== "b2b")
    throw forbidden();
  const parts: SQL[] = [sql`u.role='player'`, sql`p.currency='INR'`];
  if (extra.method !== "all") parts.push(sql`p.type='deposit' AND p.method=${extra.method}`);
  if (customer) parts.push(sql`u.id=${user.id}`);
  else {
    parts.push(sql`u.channel=${filter.channel}`);
    if (actor?.role === "master") parts.push(sql`a.parent_id=${actor.node.id}`);
    if (actor?.role === "agent") parts.push(sql`a.id=${actor.node.id}`);
    if (filter.nodeId)
      parts.push(sql`(a.id=${filter.nodeId} OR a.parent_id=${filter.nodeId})`);
    if (filter.userId) parts.push(sql`u.id=${filter.userId}`);
  }
  parts.push(
    ...transactionConditions(filter, {
      time: sql`p.created_at`,
      amount: sql`p.amount`,
      type: sql`p.type`,
      status: sql`p.status`,
      text: [
        sql`p.request_id`,
        sql`p.reference`,
        ...(customer
          ? []
          : [
              sql`u.id`,
              sql`u.email`,
              sql`u.display_name`,
              sql`a.name`,
              sql`m.name`,
            ]),
      ],
    }),
  );
  const where = sql.join(parts, sql` AND `),
    limit = extra.format === "csv" ? 10001 : filter.limit,
    offset = extra.format === "csv" ? 0 : filter.offset;
  const selected =
    extra.reconciliation === "all"
      ? sql`true`
      : sql`reconciliation=${extra.reconciliation}`;
  const result = await db.execute(sql`WITH payments AS (
    SELECT 'request:'||r.id AS id,r.id AS request_id,
      CASE WHEN r.kind='deposit' THEN 'deposit' ELSE 'withdrawal_request' END AS type,
      r.user_id,r.amount,r.currency,r.status::text,r.method::text,r.upi_ref AS reference,
      r.created_at,r.processed_at AS reviewed_at,NULL::timestamptz AS paid_at,r.processed_by AS reviewer_id,
      r.ledger_entry_id,
      CASE WHEN r.kind='deposit' THEN 'deposit' ELSE 'withdrawal' END AS ledger_ref_type
      FROM payment_requests r
    UNION ALL
    SELECT 'payout:'||w.id,w.id,'payout',w.user_id,w.amount,w.currency,w.status::text,w.method,w.utr,
      w.requested_at,w.reviewed_at,w.paid_at,w.reviewed_by,NULL::text,'withdrawal'
      FROM withdrawals w WHERE w.kind='player_withdrawal'
  ), scoped AS (
    SELECT p.*,u.email,a.id AS agent_id,a.name AS agent_name,m.id AS master_id,m.name AS master_name
      FROM payments p JOIN users u ON u.id=p.user_id
      LEFT JOIN network_nodes a ON a.id=u.b2b_agent_id AND a.kind='agent'
      LEFT JOIN network_nodes m ON m.id=a.parent_id AND m.kind='master'
      WHERE ${where}
  ), linked AS (
    SELECT p.*,COALESCE(w.amount,0)::text AS wallet_amount,COALESCE(w.entries,0)::int AS wallet_entries,
      COALESCE(w.bad_reference,false) AS bad_reference,
      (EXISTS(SELECT 1 FROM payment_requests sibling WHERE p.type='payout' AND sibling.kind='withdraw' AND sibling.id=p.request_id AND sibling.user_id=p.user_id)
      OR EXISTS(SELECT 1 FROM withdrawals sibling WHERE p.type='withdrawal_request' AND sibling.kind='player_withdrawal' AND sibling.id=p.request_id AND sibling.user_id=p.user_id)) AS ambiguous_id
    FROM scoped p LEFT JOIN LATERAL (
      SELECT sum(l.amount)::numeric AS amount,count(*) AS entries,
        bool_or(l.ref_type IS DISTINCT FROM p.ledger_ref_type OR l.ref_id IS DISTINCT FROM p.request_id) AS bad_reference
      FROM wallet_ledger l JOIN wallets wallet ON wallet.id=l.wallet_id AND wallet.currency=p.currency
      WHERE l.user_id=p.user_id AND (l.id=p.ledger_entry_id OR (l.ref_type=p.ledger_ref_type AND l.ref_id=p.request_id))
    ) w ON true
  ), assessed AS (
    SELECT *,CASE
      WHEN bad_reference OR ambiguous_id THEN 'needs_review'
      WHEN type='withdrawal_request' THEN CASE WHEN wallet_amount::numeric<>0 THEN 'needs_review' ELSE 'request_only' END
      WHEN type='deposit' AND status='approved' THEN CASE WHEN wallet_entries>0 AND wallet_amount::numeric=amount THEN 'matched' ELSE 'needs_review' END
      WHEN type='payout' AND status IN ('approved','paid') THEN CASE WHEN wallet_entries>0 AND wallet_amount::numeric=-amount THEN 'matched' ELSE 'needs_review' END
      WHEN wallet_amount::numeric<>0 THEN 'needs_review'
      WHEN status IN ('pending','gateway_pending') THEN 'pending'
      ELSE 'matched' END AS reconciliation
    FROM linked
  ), filtered AS MATERIALIZED (SELECT * FROM assessed WHERE ${selected})
  SELECT (SELECT count(*)::int FROM filtered) AS total,
    (SELECT jsonb_build_object(
      'approvedDeposits',COALESCE(sum(amount) FILTER(WHERE type='deposit' AND status='approved'),0)::text,
      'depositWalletCredits',(SELECT COALESCE(sum(l.amount),0)::text FROM wallet_ledger l JOIN wallets wallet ON wallet.id=l.wallet_id WHERE EXISTS(
        SELECT 1 FROM filtered p WHERE p.type='deposit' AND p.user_id=l.user_id AND wallet.currency=p.currency
          AND (l.id=p.ledger_entry_id OR (l.ref_type='deposit' AND l.ref_id=p.request_id))
      )),
      'recordedPaidWithdrawals',COALESCE(sum(amount) FILTER(WHERE type='payout' AND status='paid'),0)::text,
      'pending',count(*) FILTER(WHERE status IN ('pending','gateway_pending') OR (type IN ('withdrawal_request','payout') AND status='approved')),
      'needsReview',count(*) FILTER(WHERE reconciliation='needs_review'),
      'requestOnly',count(*) FILTER(WHERE type='withdrawal_request')
    ) FROM filtered) AS totals,
    COALESCE((SELECT jsonb_agg(row ORDER BY created_at DESC,id DESC) FROM (
      SELECT created_at,id,jsonb_build_object(
        'id',id,'requestId',request_id,'type',type,'userId',user_id,
        'email',CASE WHEN ${customer} THEN NULL ELSE email END,
        'masterId',CASE WHEN ${customer} THEN NULL ELSE master_id END,'masterName',CASE WHEN ${customer} THEN NULL ELSE master_name END,
        'agentId',CASE WHEN ${customer} THEN NULL ELSE agent_id END,'agentName',CASE WHEN ${customer} THEN NULL ELSE agent_name END,
        'amount',amount::text,'currency',currency,'status',status,'method',method,'reference',reference,
        'createdAt',created_at,'reviewedAt',reviewed_at,'paidAt',paid_at,
        'reviewer',CASE WHEN ${customer} THEN NULL ELSE reviewer_id END,
        'walletAmount',wallet_amount,'walletEntries',wallet_entries,'reconciliation',reconciliation
      ) AS row FROM filtered ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}
    ) page),'[]'::jsonb) AS items`);
  const row = result.rows[0]!;
  const total = Number(row.total);
  if (extra.format === "csv" && total > 10000)
    throw badRequest(
      "More than 10,000 records match. Narrow the dates or account before exporting.",
    );
  return {
    format: extra.format,
    total,
    items: row.items as PaymentHistoryRow[],
    totals: row.totals as {
      approvedDeposits: string;
      depositWalletCredits: string;
      recordedPaidWithdrawals: string;
      pending: number;
      needsReview: number;
      requestOnly: number;
    },
    range: {
      from: filter.from ?? null,
      to: filter.to ?? null,
      timezone: "Asia/Kolkata",
    },
    branchAttribution: customer ? null : "current_membership",
    bankVerified: false,
  };
}

// Quote every value and neutralize spreadsheet formulas in user supplied fields.
export function paymentHistoryCsv(
  items: PaymentHistoryRow[],
  customer = false,
) {
  const fields: (keyof PaymentHistoryRow)[] = [
    "id",
    "requestId",
    "type",
    "createdAt",
    ...(customer ? [] : (["email", "masterName", "agentName"] as const)),
    "amount",
    "currency",
    "status",
    "method",
    "reference",
    "walletAmount",
    "walletEntries",
    "reconciliation",
    "reviewedAt",
    "paidAt",
    ...(customer ? [] : (["reviewer"] as const)),
  ];
  const cell = (value: unknown) => {
    let s = String(value ?? "");
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      fields
        .map((f) =>
          f === "amount"
            ? "amountPaise"
            : f === "walletAmount"
              ? "walletAmountPaise"
              : f,
        )
        .join(","),
      ...items.map((item) => fields.map((f) => cell(item[f])).join(",")),
    ].join("\r\n")
  );
}
