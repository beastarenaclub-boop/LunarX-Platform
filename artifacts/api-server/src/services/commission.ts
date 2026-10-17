import {
  db,
  agentsTable,
  commissionsTable,
  betsTable,
  usersTable,
  withdrawalsTable,
} from "@workspace/db";
import { and, eq, gte, lt, sql, inArray } from "drizzle-orm";
import { bus } from "../realtime/eventBus";

export async function computeCommissions(dateStr: string): Promise<number> {
  const periodStart = new Date(dateStr);
  periodStart.setUTCHours(0, 0, 0, 0);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);

  const referredPlayers = await db
    .select({
      playerId: usersTable.id,
      referralCode: usersTable.referredBy,
    })
    .from(usersTable)
    .where(sql`${usersTable.referredBy} IS NOT NULL AND ${usersTable.channel} = 'b2b'`);

  if (referredPlayers.length === 0) return 0;

  const referralCodes = [
    ...new Set(referredPlayers.map((p) => p.referralCode!)),
  ];

  const agentUsers = await db
    .select({
      userId: usersTable.id,
      referralCode: usersTable.referralCode,
    })
    .from(usersTable)
    .where(inArray(usersTable.referralCode, referralCodes));

  const codeToUserId = new Map<string, string>();
  for (const au of agentUsers) {
    if (au.referralCode) codeToUserId.set(au.referralCode, au.userId);
  }

  const agentUserIds = [...new Set(codeToUserId.values())];
  if (agentUserIds.length === 0) return 0;

  const agents = await db
    .select()
    .from(agentsTable)
    .where(
      and(
        inArray(agentsTable.userId, agentUserIds),
        eq(agentsTable.status, "active"),
      ),
    );

  const userIdToAgent = new Map<string, typeof agents[0]>();
  for (const a of agents) {
    userIdToAgent.set(a.userId, a);
  }

  const playerToAgent = new Map<string, typeof agents[0]>();
  for (const rp of referredPlayers) {
    if (!rp.referralCode) continue;
    const agentUserId = codeToUserId.get(rp.referralCode);
    if (!agentUserId) continue;
    const agent = userIdToAgent.get(agentUserId);
    if (agent) playerToAgent.set(rp.playerId, agent);
  }

  const playerIds = [...playerToAgent.keys()];
  if (playerIds.length === 0) return 0;

  const betAggs = await db
    .select({
      userId: betsTable.userId,
      totalStake: sql<string>`COALESCE(SUM(${betsTable.stakeAmount}), 0)::text`,
      totalPayout: sql<string>`COALESCE(SUM(${betsTable.payoutAmount}), 0)::text`,
    })
    .from(betsTable)
    .where(
      and(
        inArray(betsTable.userId, playerIds),
        gte(betsTable.settledAt, periodStart),
        lt(betsTable.settledAt, periodEnd),
        inArray(betsTable.status, ["won", "lost", "cashed_out"]),
      ),
    )
    .groupBy(betsTable.userId);

  let created = 0;
  for (const agg of betAggs) {
    const agent = playerToAgent.get(agg.userId);
    if (!agent) continue;

    const grossStake = BigInt(agg.totalStake);
    const grossPayout = BigInt(agg.totalPayout);
    const netRevenue = grossStake - grossPayout;

    const commissionAmount =
      netRevenue > 0n
        ? (netRevenue * BigInt(agent.commissionRate)) / 100n
        : 0n;

    await db
      .insert(commissionsTable)
      .values({
        agentId: agent.id,
        playerId: agg.userId,
        periodDate: periodStart,
        grossStake,
        grossPayout,
        netRevenue,
        commissionRate: agent.commissionRate,
        commissionAmount,
        status: "settled",
      })
      .onConflictDoUpdate({
        target: [
          commissionsTable.agentId,
          commissionsTable.playerId,
          commissionsTable.periodDate,
        ],
        set: {
          grossStake,
          grossPayout,
          netRevenue,
          commissionRate: agent.commissionRate,
          commissionAmount,
          status: "settled",
        },
      });

    created++;
  }

  return created;
}

export async function accrueCommissionForBet(
  userId: string,
  settledAt: Date,
): Promise<void> {
  const userRows = await db
    .select({ referredBy: usersTable.referredBy, channel: usersTable.channel })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const referredBy = userRows[0]?.referredBy;
  if (!referredBy || userRows[0]?.channel !== "b2b") return;

  const agentUserRows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.referralCode, referredBy))
    .limit(1);

  if (!agentUserRows[0]) return;

  const agents = await db
    .select()
    .from(agentsTable)
    .where(
      and(
        eq(agentsTable.userId, agentUserRows[0].id),
        eq(agentsTable.status, "active"),
      ),
    )
    .limit(1);

  const agent = agents[0];
  if (!agent) return;

  const periodStart = new Date(settledAt);
  periodStart.setUTCHours(0, 0, 0, 0);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);

  const betAggs = await db
    .select({
      totalStake: sql<string>`COALESCE(SUM(${betsTable.stakeAmount}), 0)::text`,
      totalPayout: sql<string>`COALESCE(SUM(${betsTable.payoutAmount}), 0)::text`,
    })
    .from(betsTable)
    .where(
      and(
        eq(betsTable.userId, userId),
        gte(betsTable.settledAt, periodStart),
        lt(betsTable.settledAt, periodEnd),
        inArray(betsTable.status, ["won", "lost", "cashed_out"]),
      ),
    );

  const grossStake = BigInt(betAggs[0]?.totalStake ?? "0");
  const grossPayout = BigInt(betAggs[0]?.totalPayout ?? "0");
  const netRevenue = grossStake - grossPayout;
  const commissionAmount =
    netRevenue > 0n
      ? (netRevenue * BigInt(agent.commissionRate)) / 100n
      : 0n;

  await db
    .insert(commissionsTable)
    .values({
      agentId: agent.id,
      playerId: userId,
      periodDate: periodStart,
      grossStake,
      grossPayout,
      netRevenue,
      commissionRate: agent.commissionRate,
      commissionAmount,
      status: "settled",
    })
    .onConflictDoUpdate({
      target: [
        commissionsTable.agentId,
        commissionsTable.playerId,
        commissionsTable.periodDate,
      ],
      set: {
        grossStake,
        grossPayout,
        netRevenue,
        commissionRate: agent.commissionRate,
        commissionAmount,
        status: "settled",
      },
    });
  if (commissionAmount > 0n) {
    bus.publish({
      topic: `agent:${agent.userId}`,
      type: "commission",
      agentId: agent.id,
      deltaPaise: commissionAmount.toString(),
      ts: Date.now(),
    });
  }
}

export async function getAgentCommissionBalance(
  agentId: string,
  userId: string,
): Promise<bigint> {
  const [earnedRows, paidRows] = await Promise.all([
    db
      .select({
        total: sql<string>`COALESCE(SUM(${commissionsTable.commissionAmount}), 0)::text`,
      })
      .from(commissionsTable)
      .where(eq(commissionsTable.agentId, agentId)),
    db
      .select({
        total: sql<string>`COALESCE(SUM(${withdrawalsTable.amount}), 0)::text`,
      })
      .from(withdrawalsTable)
      .where(
        and(
          eq(withdrawalsTable.userId, userId),
          eq(withdrawalsTable.kind, "agent_commission"),
          inArray(withdrawalsTable.status, ["approved", "paid"]),
        ),
      ),
  ]);

  const earned = BigInt(earnedRows[0]?.total ?? "0");
  const paid = BigInt(paidRows[0]?.total ?? "0");
  return earned - paid;
}
