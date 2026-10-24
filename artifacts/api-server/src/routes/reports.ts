import { playerBetRecords } from "../services/playerBetRecords";
import { Router } from "express";
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { badRequest } from "../lib/errors";

const router = Router();
export const reportKinds = [
  "accountstatement",
  "currentbets",
  "activity",
  "casinoresult",
  "livecasinoresult",
  "sportbookresult",
] as const;
const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
function day(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw badRequest("Enter a valid date.");
  return new Date(`${value}T00:00:00+05:30`);
}

router.get("/:kind", requireAuth, async (req, res, next) => {
  try {
    const kind = z.enum(reportKinds).parse(req.params.kind);
    const input = querySchema.parse(req.query);
    const from = day(input.from),
      to = day(input.to);
    if (from && to && from > to)
      throw badRequest("From date must be before the to date.");
    const filters: SQL[] = [];
    if (from) filters.push(sql`sort_at >= ${from.toISOString()}::timestamptz`);
    if (to)
      filters.push(
        sql`sort_at < ${new Date(to.getTime() + 86400000).toISOString()}::timestamptz`,
      );
    if (input.cursor) {
      let cursor: { at: string; id: string };
      try {
        cursor = z
          .object({ at: z.string().datetime(), id: z.string().min(1).max(150) })
          .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
      } catch {
        throw badRequest("Invalid report cursor.");
      }
      filters.push(
        sql`(sort_at, id) < (${cursor.at}::timestamptz, ${cursor.id})`,
      );
    }
    const uid = req.user!.id;
    let source: SQL;
    if (kind === "accountstatement") {
      source = sql`SELECT l.id, l.created_at AS at, l.type::text AS type, l.amount::text AS amount, l.balance_after::text AS balance, l.ref_id AS reference, l.memo
        FROM wallet_ledger l JOIN wallets w ON w.id = l.wallet_id WHERE l.user_id = ${uid} AND w.user_id = ${uid} AND w.scope = 'lunar'`;
    } else if (kind === "activity") {
      source = sql`SELECT id, created_at AS at, action, ip, user_agent AS device FROM audit_log WHERE actor_id = ${uid}`;
    } else {
      source = playerBetRecords(uid);
      const sport = sql`(game LIKE 'virtual-%' OR game IN ('horse-racing', 'bike-racing'))`;
      if (kind === "currentbets") filters.push(sql`status = 'placed'`);
      if (kind === "casinoresult")
        filters.push(sql`status <> 'placed' AND NOT ${sport}`);
      if (kind === "sportbookresult") filters.push(sport);
      if (kind === "livecasinoresult")
        filters.push(
          sql`game IN ('ludo','roulette','baccarat','blackjack','teen-patti','teen-patti-live','andar-bahar','andar-bahar-live','lucky-7','lucky-7-live','wheel-2-live','teen-patti-joker','7up7down','crazy-time','dragon-tiger','dragon-tiger-one-day','vegetable-bowl','rummy','poker-one-day','poker-20-20','poker-six-players')`,
        );
    }
    const result = await db.execute(
      sql`SELECT * FROM (SELECT records.*, date_trunc('milliseconds', at) AS sort_at FROM (${source}) records) normalized ${filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``} ORDER BY sort_at DESC, id DESC LIMIT ${input.limit + 1}`,
    );
    const rows = result.rows as Array<
      Record<string, unknown> & {
        id: string;
        at: Date | string;
        sort_at: Date | string;
      }
    >;
    const more = rows.length > input.limit;
    const items = rows
      .slice(0, input.limit)
      .map(({ sort_at, ...row }) => ({
        ...row,
        at: new Date(sort_at).toISOString(),
      }));
    const last = items.at(-1);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      items,
      nextCursor:
        more && last
          ? Buffer.from(JSON.stringify({ at: last.at, id: last.id })).toString(
              "base64url",
            )
          : null,
    });
  } catch (error) {
    next(error);
  }
});
export default router;
