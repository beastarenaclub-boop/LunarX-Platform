import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { badRequest } from "../lib/errors";
import { networkReportRange } from "./networkReportRange";

const amount = z
  .string()
  .regex(/^\d{1,16}$/)
  .optional();
export const transactionQuery = z.object({
  period: z
    .enum(["all", "today", "yesterday", "weekly", "monthly", "custom"])
    .optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  q: z.string().trim().max(100).default(""),
  direction: z.enum(["all", "credit", "debit"]).default("all"),
  minAmount: amount,
  maxAmount: amount,
  type: z.string().max(50).optional(),
  status: z.string().max(40).optional(),
  game: z.string().max(80).optional(),
  accountKind: z.enum(["company", "master", "agent"]).optional(),
  nodeId: z.string().min(1).max(100).optional(),
  userId: z.string().min(1).max(100).optional(),
  channel: z.enum(["b2b", "b2c"]).default("b2b"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export function parseTransactionQuery(query: unknown) {
  const input = transactionQuery.parse(query);
  if (input.period && input.period !== "all") {
    const range = networkReportRange({ ...input, period: input.period });
    input.from = range.from;
    input.to = range.to;
  }
  if (input.from && input.to && input.from > input.to)
    throw badRequest("Start date must precede end date");
  if (
    input.minAmount &&
    input.maxAmount &&
    BigInt(input.minAmount) > BigInt(input.maxAmount)
  )
    throw badRequest("Minimum amount must not exceed maximum amount");
  return input;
}
export type TransactionQuery = ReturnType<typeof parseTransactionQuery>;
export function transactionConditions(
  input: TransactionQuery,
  columns: { time: SQL; amount?: SQL; text?: SQL[]; type?: SQL; status?: SQL },
) {
  const parts: SQL[] = [];
  if (input.from)
    parts.push(
      sql`${columns.time} >= (${input.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`,
    );
  if (input.to)
    parts.push(
      sql`${columns.time} < ((${input.to}::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
    );
  if (columns.amount) {
    if (input.direction === "credit") parts.push(sql`${columns.amount}>0`);
    if (input.direction === "debit") parts.push(sql`${columns.amount}<0`);
    if (input.minAmount)
      parts.push(
        sql`abs(${columns.amount}::numeric)>=${input.minAmount}::numeric`,
      );
    if (input.maxAmount)
      parts.push(
        sql`abs(${columns.amount}::numeric)<=${input.maxAmount}::numeric`,
      );
  }
  if (input.type && columns.type)
    parts.push(sql`${columns.type}=${input.type}`);
  if (input.status && columns.status)
    parts.push(sql`${columns.status}=${input.status}`);
  if (input.q && columns.text?.length) {
    const pattern = "%" + input.q.replace(/[\\%_]/g, "\\$&") + "%";
    parts.push(
      sql`(${sql.join(
        columns.text.map(
          (column) => sql`COALESCE(${column}::text,'') ILIKE ${pattern}`,
        ),
        sql` OR `,
      )})`,
    );
  }
  return parts;
}

// Counts and totals cover all matches, independently of the page limit.
// Source must expose unique id, created_at, and a string/numeric amount.
export async function transactionPage(source: SQL, input: TransactionQuery) {
  const result =
    await db.execute(sql`WITH filtered AS MATERIALIZED (${source}) SELECT
    (SELECT count(*)::int FROM filtered) AS total,
    (SELECT jsonb_build_object('credit',COALESCE(sum(amount::numeric) FILTER(WHERE amount::numeric>0),0)::text,
      'debit',COALESCE(-sum(amount::numeric) FILTER(WHERE amount::numeric<0),0)::text,
      'net',COALESCE(sum(amount::numeric),0)::text) FROM filtered) AS summary,
    COALESCE((SELECT jsonb_agg(row ORDER BY created_at DESC,id DESC) FROM
      (SELECT *,to_jsonb(filtered) AS row FROM filtered ORDER BY created_at DESC,id DESC LIMIT ${input.limit} OFFSET ${input.offset}) page),'[]'::jsonb) AS items`);
  const row = result.rows[0]!;
  return {
    total: Number(row.total),
    summary: row.summary as { credit: string; debit: string; net: string },
    items: row.items as Record<string, unknown>[],
    range: {
      from: input.from ?? null,
      to: input.to ?? null,
      timezone: "Asia/Kolkata",
    },
  };
}
