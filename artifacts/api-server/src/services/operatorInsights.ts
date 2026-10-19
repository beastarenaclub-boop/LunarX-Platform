import { db, type User } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { forbidden, badRequest } from "../lib/errors";
import { networkIdentity } from "./network";
import {
  insightRange,
  rupeesToPaise,
  type InsightFilter,
} from "./operatorInsightFilters";
import { playerBetRecords } from "./playerBetRecords";

type Executor = Pick<typeof db, "execute">;
export const EXPORT_LIMIT = 50_000;
export async function insightScope(user: User, filter: InsightFilter) {
  const actor = await networkIdentity(user);
  if (actor.role !== "admin" && filter.channel === "b2c") throw forbidden();
  const channel = actor.role === "admin" ? filter.channel : "b2b";
  const visible =
    actor.role === "admin"
      ? sql`true`
      : actor.role === "master"
        ? sql`(id=${actor.node.id} OR parent_id=${actor.node.id})`
        : sql`id=${actor.node.id}`;
  const { rows: nodes } = await db.execute(
    sql`SELECT id,name,kind,parent_id AS "parentId" FROM network_nodes WHERE ${visible} ORDER BY lower(name),id`,
  );
  const selected = filter.nodeId
    ? nodes.find((n) => n.id === filter.nodeId)
    : null;
  if (filter.nodeId && !selected)
    throw forbidden("Account outside your reporting access");
  if (channel === "b2c" && selected)
    throw badRequest("Branch filters apply to B2B players");
  const parts = [
    sql`u.role='player' AND u.email NOT LIKE '%@demo.lunar.local'`,
  ];
  if (channel !== "all") parts.push(sql`u.channel=${channel}`);
  if (actor.role === "master") parts.push(sql`a.parent_id=${actor.node.id}`);
  if (actor.role === "agent") parts.push(sql`a.id=${actor.node.id}`);
  if (selected)
    parts.push(
      selected.kind === "master"
        ? sql`a.parent_id=${selected.id}`
        : sql`a.id=${selected.id}`,
    );
  if (filter.playerId) parts.push(sql`u.id=${filter.playerId}`);
  if (filter.search)
    parts.push(
      sql`strpos(lower(u.email || ' ' || COALESCE(u.display_name,'') || ' ' || u.id),lower(${filter.search}))>0`,
    );
  const players = sql`SELECT u.id,u.email,u.display_name AS name,u.status,u.channel,u.b2b_agent_id AS agent_id,a.parent_id AS master_id,
    a.name AS agent,m.name AS master,
    (u.status='active' AND (u.channel='b2c' OR (a.status='active' AND m.status='active' AND au.status='active' AND mu.status='active'))) AS can_play
    FROM users u LEFT JOIN network_nodes a ON a.id=u.b2b_agent_id LEFT JOIN network_nodes m ON m.id=a.parent_id
    LEFT JOIN users au ON au.id=a.user_id LEFT JOIN users mu ON mu.id=m.user_id WHERE ${sql.join(parts, sql` AND `)}`;
  return { actor, channel, nodes, players };
}
export type InsightScope = Awaited<ReturnType<typeof insightScope>>;
const start = (range: ReturnType<typeof insightRange>) =>
  sql`(${range.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`;
const end = (range: ReturnType<typeof insightRange>) =>
  sql`((${range.to}::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata')`;
const array = (value: unknown) => value as Record<string, unknown>[];

export async function livePlayers(scope: InsightScope, filter: InsightFilter) {
  const result =
    await db.execute(sql`WITH players AS MATERIALIZED (${scope.players}), activity AS (
    SELECT p.*,s.last_seen,s.sessions,COALESCE(b.bets,0) AS recent_bets FROM players p
    LEFT JOIN LATERAL (SELECT max(COALESCE(last_seen_at,created_at)) AS last_seen,count(*)::int AS sessions FROM sessions
      WHERE user_id=p.id AND revoked_at IS NULL AND expires_at>now()
        AND COALESCE(last_seen_at,created_at)>=now()-interval '2 minutes' AND p.can_play) s ON true
    LEFT JOIN LATERAL (SELECT count(*)::int AS bets FROM wallet_ledger WHERE user_id=p.id AND type='bet' AND amount<0
      AND created_at>=now()-interval '2 minutes' AND p.can_play) b ON true
  ) SELECT jsonb_build_object('totalPlayers',count(*),'online',count(*) FILTER(WHERE sessions>0),
      'betting',count(*) FILTER(WHERE recent_bets>0),'sessions',COALESCE(sum(sessions),0)) AS totals,
    (SELECT COALESCE(jsonb_agg(row),'[]'::jsonb) FROM (SELECT id,email,name,channel,agent,master,last_seen,sessions,recent_bets
      FROM activity WHERE sessions>0 ORDER BY last_seen DESC,id LIMIT ${filter.limit} OFFSET ${filter.offset}) row) AS items FROM activity`);
  return {
    ...result.rows[0],
    role: scope.actor.role,
    channel: scope.channel,
    nodes: scope.nodes,
    generatedAt: new Date().toISOString(),
    windowSeconds: 120,
  };
}

function accountsCte(scope: InsightScope, filter: InsightFilter) {
  const range = insightRange(filter);
  return sql`WITH players AS MATERIALIZED (${scope.players}), movements AS MATERIALIZED (
    SELECT l.* FROM wallet_ledger l JOIN players p ON p.id=l.user_id WHERE l.created_at<${end(range)}
  ), balances AS (
    SELECT p.id AS player_id,p.email,p.name,p.channel,p.agent,p.master,w.id AS wallet_id,w.scope,w.currency,
      COALESCE(sum(l.amount) FILTER(WHERE l.created_at<${start(range)}),0) AS opening,
      COALESCE(sum(l.amount) FILTER(WHERE l.created_at>=${start(range)} AND l.amount>0),0) AS credits,
      COALESCE(-sum(l.amount) FILTER(WHERE l.created_at>=${start(range)} AND l.amount<0),0) AS debits,
      COALESCE(sum(l.amount),0) AS closing,
      count(l.id) FILTER(WHERE l.created_at>=${start(range)})::int AS entries,
      COALESCE(sum(l.amount) FILTER(WHERE l.created_at>=${start(range)} AND l.type='deposit'),0) AS deposits,
      COALESCE(-sum(l.amount) FILTER(WHERE l.created_at>=${start(range)} AND l.type='withdraw'),0) AS withdrawals,
      COALESCE(-sum(l.amount) FILTER(WHERE l.created_at>=${start(range)} AND l.type='bet'),0) AS stakes,
      COALESCE(sum(l.amount) FILTER(WHERE l.created_at>=${start(range)} AND l.type='win'),0) AS wins,
      COALESCE(sum(l.amount) FILTER(WHERE l.created_at>=${start(range)} AND l.type='refund'),0) AS refunds,
      COALESCE(sum(l.amount) FILTER(WHERE l.created_at>=${start(range)} AND l.type IN ('adjustment','bonus','commission')),0) AS other
    FROM players p JOIN wallets w ON w.user_id=p.id LEFT JOIN movements l ON l.wallet_id=w.id
    GROUP BY p.id,p.email,p.name,p.channel,p.agent,p.master,w.id,w.scope,w.currency
  ), time_groups AS (
    SELECT wallet_id,created_at,sum(amount) AS amount,array_agg(balance_after) AS balances FROM movements GROUP BY wallet_id,created_at
  ), checked AS (
    SELECT *,sum(amount) OVER(PARTITION BY wallet_id ORDER BY created_at) AS expected FROM time_groups
  ), accounts AS (
    SELECT b.*,COALESCE(last.balance_after,0) AS recorded,
      COALESCE(last.balance_after,0)-b.closing AS difference,
      (SELECT count(*)::int FROM checked c WHERE c.wallet_id=b.wallet_id AND NOT c.expected=ANY(c.balances)) AS breaks
    FROM balances b LEFT JOIN LATERAL (
      SELECT balance_after FROM movements l WHERE l.wallet_id=b.wallet_id
      ORDER BY created_at DESC,(balance_after=b.closing) DESC,id DESC LIMIT 1
    ) last ON true
  ), selected AS (SELECT * FROM accounts WHERE ${filter.mismatchOnly === "true" ? sql`difference<>0 OR breaks>0` : sql`true`})`;
}
export async function accountReport(
  executor: Executor,
  scope: InsightScope,
  filter: InsightFilter,
  exporting = false,
) {
  const cte = accountsCte(scope, filter);
  const result = await executor.execute(sql`${cte} SELECT
    (SELECT jsonb_build_object('accounts',count(*),'opening',COALESCE(sum(opening),0)::text,'credits',COALESCE(sum(credits),0)::text,
      'debits',COALESCE(sum(debits),0)::text,'closing',COALESCE(sum(closing),0)::text,'difference',COALESCE(sum(difference),0)::text,
      'mismatches',count(*) FILTER(WHERE difference<>0 OR breaks>0), 'entries',COALESCE(sum(entries),0)) FROM selected) AS totals,
    (SELECT COALESCE(jsonb_agg(row),'[]'::jsonb) FROM (SELECT player_id,email,name,channel,agent,master,wallet_id,scope,currency,
      opening::text,credits::text,debits::text,closing::text,recorded::text,difference::text,entries,breaks,
      deposits::text,withdrawals::text,stakes::text,wins::text,refunds::text,other::text
      FROM selected ORDER BY abs(difference) DESC,breaks DESC,lower(email),wallet_id
      LIMIT ${exporting ? EXPORT_LIMIT + 1 : filter.limit} OFFSET ${exporting ? 0 : filter.offset}) row) AS items`);
  const data = result.rows[0]!;
  return {
    ...data,
    items: array(data.items),
    totals: data.totals as Record<string, string | number>,
    range: insightRange(filter),
    role: scope.actor.role,
    nodes: scope.nodes,
    generatedAt: new Date().toISOString(),
  };
}
export async function accountLedger(
  executor: Executor,
  scope: InsightScope,
  filter: InsightFilter,
  exporting = false,
) {
  const range = insightRange(filter);
  const result =
    await executor.execute(sql`${accountsCte(scope, filter)}, entries AS (
    SELECT l.id,l.created_at,p.email,p.player_id,p.wallet_id,p.scope,l.type,l.amount::text,l.balance_after::text,l.ref_type,l.ref_id,l.memo
    FROM selected p JOIN wallet_ledger l ON l.wallet_id=p.wallet_id WHERE l.created_at>=${start(range)} AND l.created_at<${end(range)}
  ) SELECT (SELECT count(*)::int FROM entries) AS total,
    (SELECT COALESCE(jsonb_agg(row),'[]'::jsonb) FROM (SELECT * FROM entries ORDER BY created_at DESC,id DESC
      LIMIT ${exporting ? EXPORT_LIMIT + 1 : filter.limit} OFFSET ${exporting ? 0 : filter.entriesOffset}) row) AS items`);
  return {
    total: Number(result.rows[0]!.total),
    items: array(result.rows[0]!.items),
  };
}
// Commission allocations are separate from player cash; combining the two double-counts revenue.
export async function commissionEntries(
  executor: Executor,
  scope: InsightScope,
  filter: InsightFilter,
) {
  const range = insightRange(filter);
  const allowed =
    scope.actor.role === "admin"
      ? sql`true`
      : sql`l.account_id=${scope.actor.node.id}`;
  const result =
    await executor.execute(sql`${accountsCte(scope, filter)} SELECT l.id::text,l.created_at,p.email,l.game_code,l.source,l.source_id,l.revision,
    l.account_id,l.account_kind,l.amount::text,l.gross_stake::text,l.gross_payout::text FROM network_ledger l JOIN players p ON p.id=l.user_id
    WHERE ${allowed} AND p.id IN (SELECT player_id FROM selected) AND l.created_at>=${start(range)} AND l.created_at<${end(range)} ORDER BY l.created_at,l.id LIMIT ${EXPORT_LIMIT + 1}`);
  return result.rows;
}

function bettingCte(scope: InsightScope, filter: InsightFilter) {
  const range = insightRange(filter);
  const conditions: SQL[] = [sql`b.at>=${start(range)} AND b.at<${end(range)}`];
  if (filter.game) conditions.push(sql`b.game=${filter.game}`);
  if (filter.roundId) conditions.push(sql`b.reference=${filter.roundId}`);
  if (filter.status) conditions.push(sql`b.status=${filter.status}`);
  if (filter.minStake)
    conditions.push(
      sql`b.stake::numeric>=${rupeesToPaise(filter.minStake).toString()}::numeric`,
    );
  if (filter.maxStake)
    conditions.push(
      sql`b.stake::numeric<=${rupeesToPaise(filter.maxStake).toString()}::numeric`,
    );
  return sql`WITH players AS MATERIALIZED (${scope.players}), filtered AS MATERIALIZED (
    SELECT p.id AS player_id,p.email,p.name,p.channel,p.agent,p.master,b.id,b.at,b.game,b.reference,b.stake::numeric AS stake,
      COALESCE(b.payout,'0')::numeric AS payout,b.status FROM players p CROSS JOIN LATERAL (${playerBetRecords(sql`p.id`)}) b
      WHERE ${sql.join(conditions, sql` AND `)}
  ), minutes AS (SELECT player_id,max(n)::int AS peak FROM (SELECT player_id,date_trunc('minute',at),count(*) AS n FROM filtered GROUP BY 1,2) x GROUP BY player_id),
  ranked AS (
    SELECT player_id,email,name,channel,agent,master,count(*)::int AS bets,sum(stake) AS stake,
      COALESCE(sum(stake) FILTER(WHERE status IN ('won','lost','cashed_out')),0) AS settled_stake,
      COALESCE(sum(payout) FILTER(WHERE status IN ('won','lost','cashed_out')),0) AS payout,
      COALESCE(sum(stake) FILTER(WHERE status='placed'),0) AS pending,
      count(*) FILTER(WHERE status='placed')::int AS pending_bets,
      count(*) FILTER(WHERE status IN ('won','lost','cashed_out'))::int AS settled,
      count(*) FILTER(WHERE status IN ('won','cashed_out'))::int AS wins,
      max(stake) AS largest,max(at) AS last_bet FROM filtered GROUP BY player_id,email,name,channel,agent,master
  ), reviewed AS (
    SELECT r.*,r.payout-r.settled_stake AS profit,m.peak,
      array_remove(ARRAY[
        CASE WHEN m.peak>=60 THEN '60+ bets in a minute; review automation or multi-bet play' END,
        CASE WHEN r.settled>=50 AND r.wins*100.0/NULLIF(r.settled,0)>=90 AND r.payout>=r.settled_stake*2
          THEN 'High return and win rate across 50+ settled bets; review outcomes' END,
        CASE WHEN (SELECT count(*) FROM fraud_flags f WHERE f.user_id=r.player_id AND NOT f.resolved)>0
          THEN 'Unresolved security flags; inspect evidence' END
      ],NULL) AS reasons FROM ranked r JOIN minutes m ON m.player_id=r.player_id
  ), selected AS (SELECT * FROM reviewed WHERE ${filter.reviewOnly === "true" ? sql`cardinality(reasons)>0` : sql`true`})`;
}
export async function bettingReport(
  executor: Executor,
  scope: InsightScope,
  filter: InsightFilter,
  exporting = false,
) {
  if (scope.actor.role !== "admin")
    throw forbidden("Bet investigation is admin-only");
  const order = {
    stake: sql`selected.stake DESC`,
    bets: sql`selected.bets DESC`,
    payout: sql`selected.payout DESC`,
    profit: sql`selected.profit DESC`,
    recent: sql`selected.last_bet DESC`,
    largest: sql`selected.largest DESC`,
  }[filter.sort];
  const result = await executor.execute(sql`${bettingCte(scope, filter)} SELECT
    (SELECT jsonb_build_object('players',count(*),'bets',COALESCE(sum(bets),0),'stake',COALESCE(sum(stake),0)::text,
      'settledStake',COALESCE(sum(settled_stake),0)::text,'payout',COALESCE(sum(payout),0)::text,
      'houseNet',COALESCE(sum(settled_stake-payout),0)::text,'pending',COALESCE(sum(pending),0)::text,
      'review',count(*) FILTER(WHERE cardinality(reasons)>0)) FROM selected) AS totals,
    (SELECT COALESCE(jsonb_agg(row),'[]'::jsonb) FROM (SELECT player_id,email,name,channel,agent,master,bets,stake::text,settled_stake::text,
      payout::text,profit::text,pending::text,pending_bets,settled,wins,largest::text,last_bet,peak,reasons
      FROM selected ORDER BY ${order},player_id LIMIT ${exporting ? EXPORT_LIMIT + 1 : filter.limit} OFFSET ${exporting ? 0 : filter.offset}) row) AS items,
    (SELECT COALESCE(jsonb_agg(DISTINCT game),'[]'::jsonb) FROM filtered) AS games`);
  const data = result.rows[0]!;
  return {
    ...data,
    items: array(data.items),
    totals: data.totals as Record<string, string | number>,
    range: insightRange(filter),
    role: scope.actor.role,
    nodes: scope.nodes,
    generatedAt: new Date().toISOString(),
  };
}
export async function bettingEntries(
  executor: Executor,
  scope: InsightScope,
  filter: InsightFilter,
  exporting = false,
) {
  if (scope.actor.role !== "admin")
    throw forbidden("Bet investigation is admin-only");
  const order =
    filter.sort === "largest" || filter.sort === "stake"
      ? sql`b.stake DESC`
      : filter.sort === "payout"
        ? sql`b.payout DESC`
        : sql`b.at DESC`;
  const result =
    await executor.execute(sql`${bettingCte(scope, filter)}, entries AS (SELECT b.* FROM filtered b JOIN selected s USING(player_id))
    SELECT (SELECT count(*)::int FROM entries) AS total,
      (SELECT COALESCE(jsonb_agg(row),'[]'::jsonb) FROM (SELECT b.id,b.player_id,b.email,b.at,b.game,b.reference,b.stake::text,b.payout::text,b.status
      FROM entries b ORDER BY ${order},b.at DESC,b.id LIMIT ${exporting ? EXPORT_LIMIT + 1 : filter.limit} OFFSET ${exporting ? 0 : filter.entriesOffset}) row) AS items`);
  return {
    total: Number(result.rows[0]!.total),
    items: array(result.rows[0]!.items),
  };
}
export async function bettingEvidence(
  executor: Executor,
  scope: InsightScope,
  filter: InsightFilter,
) {
  if (scope.actor.role !== "admin") throw forbidden();
  if (!filter.playerId) return [];
  const result =
    await executor.execute(sql`WITH players AS (${scope.players}) SELECT f.id,f.rule,f.severity,f.description,f.created_at,f.resolved
    FROM fraud_flags f JOIN players p ON p.id=f.user_id WHERE NOT f.resolved ORDER BY f.created_at DESC LIMIT 100`);
  return result.rows;
}
