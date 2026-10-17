import { Router, type IRouter } from "express";
import {
  db,
  agentsTable,
  commissionsTable,
  usersTable,
  betsTable,
  kycSubmissionsTable,
  walletLedgerTable,
  walletsTable,
  withdrawalsTable,
} from "@workspace/db";
import {
  and,
  desc,
  eq,
  gte,
  lt,
  ilike,
  sql,
  count,
  inArray,
} from "drizzle-orm";
import { requireRole } from "../middlewares/auth";
import { badRequest, notFound, forbidden } from "../lib/errors";
import { recordAuditFromReq } from "../lib/audit";
import { bus } from "../realtime/eventBus";
import { nanoid } from "nanoid";
import {
  computeCommissions,
  getAgentCommissionBalance,
} from "../services/commission";

const router: IRouter = Router();

const agentOnly = requireRole("agent");

router.use(agentOnly, async (req, _res, next) => {
  try {
    const agentRows = await db
      .select({ status: agentsTable.status })
      .from(agentsTable)
      .where(eq(agentsTable.userId, req.user!.id))
      .limit(1);
    if (!agentRows[0] || agentRows[0].status !== "active") {
      throw forbidden("Agent profile is inactive");
    }
    next();
  } catch (err) {
    next(err);
  }
});

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = parseInt(String(v ?? def), 10);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

router.get("/me", agentOnly, async (req, res, next) => {
  try {
    const agentRows = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.userId, req.user!.id))
      .limit(1);
    const agent = agentRows[0];
    if (!agent) throw notFound("Agent profile not found");

    const balance = await getAgentCommissionBalance(agent.id, req.user!.id);

    const [totalEarnedRows, playerCountRows, pendingPayoutRows] =
      await Promise.all([
        db
          .select({
            total: sql<string>`COALESCE(SUM(${commissionsTable.commissionAmount}), 0)::text`,
          })
          .from(commissionsTable)
          .where(eq(commissionsTable.agentId, agent.id)),
        db
          .select({ c: count() })
          .from(usersTable)
          .where(eq(usersTable.referredBy, req.user!.referralCode ?? "")),
        db
          .select({
            total: sql<string>`COALESCE(SUM(${withdrawalsTable.amount}), 0)::text`,
          })
          .from(withdrawalsTable)
          .where(
            and(
              eq(withdrawalsTable.userId, req.user!.id),
              eq(withdrawalsTable.kind, "agent_commission"),
              eq(withdrawalsTable.status, "pending"),
            ),
          ),
      ]);

    res.json({
      agent: {
        id: agent.id,
        userId: agent.userId,
        commissionRate: agent.commissionRate,
        upiId: agent.upiId,
        status: agent.status,
        createdAt: agent.createdAt.toISOString(),
      },
      referralCode: req.user!.referralCode,
      stats: {
        totalEarned: totalEarnedRows[0]?.total ?? "0",
        availableBalance: balance.toString(),
        pendingPayout: pendingPayoutRows[0]?.total ?? "0",
        playerCount: Number(playerCountRows[0]?.c ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/generate-referral-link", agentOnly, async (req, res, next) => {
  try {
    if (req.user!.referralCode) {
      res.json({ referralCode: req.user!.referralCode });
      return;
    }
    const code = nanoid(8).toUpperCase();
    await db
      .update(usersTable)
      .set({ referralCode: code, updatedAt: new Date() })
      .where(eq(usersTable.id, req.user!.id));
    req.user!.referralCode = code;
    res.json({ referralCode: code });
  } catch (err) {
    next(err);
  }
});

router.get("/players", agentOnly, async (req, res, next) => {
  try {
    const referralCode = req.user!.referralCode;
    if (!referralCode) {
      res.json({ players: [], total: 0 });
      return;
    }

    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const conds = [eq(usersTable.referredBy, referralCode)] as ReturnType<
      typeof eq
    >[];
    if (q) {
      const like = `%${q.toLowerCase()}%`;
      conds.push(
        ilike(usersTable.emailNormalized, like)!,
      );
    }

    const where = and(...conds);

    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          displayName: usersTable.displayName,
          status: usersTable.status,
          createdAt: usersTable.createdAt,
        })
        .from(usersTable)
        .where(where)
        .orderBy(desc(usersTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ c: count() }).from(usersTable).where(where),
    ]);

    const playerIds = rows.map((r) => r.id);

    let kycMap = new Map<string, string>();
    let statsMap = new Map<
      string,
      { deposits: string; bets: string; net: string }
    >();

    if (playerIds.length > 0) {
      const [kycRows, betStats, depositStats] = await Promise.all([
        db
          .select({
            userId: kycSubmissionsTable.userId,
            status: kycSubmissionsTable.status,
          })
          .from(kycSubmissionsTable)
          .where(inArray(kycSubmissionsTable.userId, playerIds)),
        db
          .select({
            userId: betsTable.userId,
            totalStake: sql<string>`COALESCE(SUM(${betsTable.stakeAmount}), 0)::text`,
            totalPayout: sql<string>`COALESCE(SUM(${betsTable.payoutAmount}), 0)::text`,
          })
          .from(betsTable)
          .where(inArray(betsTable.userId, playerIds))
          .groupBy(betsTable.userId),
        db
          .select({
            userId: walletLedgerTable.userId,
            totalDeposits: sql<string>`COALESCE(SUM(CASE WHEN ${walletLedgerTable.type} = 'deposit' THEN ${walletLedgerTable.amount} ELSE 0 END), 0)::text`,
          })
          .from(walletLedgerTable)
          .where(inArray(walletLedgerTable.userId, playerIds))
          .groupBy(walletLedgerTable.userId),
      ]);

      for (const k of kycRows) {
        kycMap.set(k.userId, k.status);
      }

      const betMap = new Map<string, { stake: string; payout: string }>();
      for (const b of betStats) {
        betMap.set(b.userId, {
          stake: b.totalStake,
          payout: b.totalPayout,
        });
      }

      const depMap = new Map<string, string>();
      for (const d of depositStats) {
        depMap.set(d.userId, d.totalDeposits);
      }

      for (const pid of playerIds) {
        const bet = betMap.get(pid) ?? { stake: "0", payout: "0" };
        const dep = depMap.get(pid) ?? "0";
        const net = (
          BigInt(bet.stake) - BigInt(bet.payout)
        ).toString();
        statsMap.set(pid, {
          deposits: dep,
          bets: bet.stake,
          net,
        });
      }
    }

    res.json({
      players: rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.displayName,
        status: r.status,
        kycStatus: kycMap.get(r.id) ?? "none",
        lifetimeDeposits: statsMap.get(r.id)?.deposits ?? "0",
        lifetimeBets: statsMap.get(r.id)?.bets ?? "0",
        lifetimeNet: statsMap.get(r.id)?.net ?? "0",
        signupDate: r.createdAt.toISOString(),
      })),
      total: Number(totalRow[0]?.c ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/commissions", agentOnly, async (req, res, next) => {
  try {
    const agentRows = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.userId, req.user!.id))
      .limit(1);
    const agent = agentRows[0];
    if (!agent) throw notFound("Agent profile not found");

    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);

    const conds = [eq(commissionsTable.agentId, agent.id)] as ReturnType<
      typeof eq
    >[];

    if (typeof req.query.from === "string" && req.query.from) {
      const d = new Date(req.query.from);
      if (!Number.isNaN(d.getTime()))
        conds.push(gte(commissionsTable.periodDate, d));
    }
    if (typeof req.query.to === "string" && req.query.to) {
      const d = new Date(req.query.to);
      if (!Number.isNaN(d.getTime())) {
        const nextDay = new Date(d);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        conds.push(lt(commissionsTable.periodDate, nextDay));
      }
    }

    const where = and(...conds);

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(commissionsTable)
        .where(where)
        .orderBy(desc(commissionsTable.periodDate))
        .limit(limit)
        .offset(offset),
      db.select({ c: count() }).from(commissionsTable).where(where),
    ]);

    const playerIds = [...new Set(rows.map((r) => r.playerId))];
    let playerMap = new Map<string, string>();
    if (playerIds.length > 0) {
      const players = await db
        .select({ id: usersTable.id, email: usersTable.email })
        .from(usersTable)
        .where(inArray(usersTable.id, playerIds));
      for (const p of players) {
        playerMap.set(p.id, p.email);
      }
    }

    res.json({
      commissions: rows.map((c) => ({
        id: c.id,
        agentId: c.agentId,
        playerId: c.playerId,
        playerEmail: playerMap.get(c.playerId) ?? "",
        periodDate: c.periodDate.toISOString(),
        grossStake: c.grossStake.toString(),
        grossPayout: c.grossPayout.toString(),
        netRevenue: c.netRevenue.toString(),
        commissionRate: c.commissionRate,
        commissionAmount: c.commissionAmount.toString(),
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
      total: Number(totalRow[0]?.c ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/commissions/summary", agentOnly, async (req, res, next) => {
  try {
    const agentRows = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.userId, req.user!.id))
      .limit(1);
    const agent = agentRows[0];
    if (!agent) throw notFound("Agent profile not found");

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);
    weekStart.setUTCHours(0, 0, 0, 0);

    const monthStart = new Date(now);
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [daily, weekly, monthly, allTime] = await Promise.all([
      db
        .select({
          total: sql<string>`COALESCE(SUM(${commissionsTable.commissionAmount}), 0)::text`,
        })
        .from(commissionsTable)
        .where(
          and(
            eq(commissionsTable.agentId, agent.id),
            gte(commissionsTable.periodDate, todayStart),
          ),
        ),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${commissionsTable.commissionAmount}), 0)::text`,
        })
        .from(commissionsTable)
        .where(
          and(
            eq(commissionsTable.agentId, agent.id),
            gte(commissionsTable.periodDate, weekStart),
          ),
        ),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${commissionsTable.commissionAmount}), 0)::text`,
        })
        .from(commissionsTable)
        .where(
          and(
            eq(commissionsTable.agentId, agent.id),
            gte(commissionsTable.periodDate, monthStart),
          ),
        ),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${commissionsTable.commissionAmount}), 0)::text`,
        })
        .from(commissionsTable)
        .where(eq(commissionsTable.agentId, agent.id)),
    ]);

    res.json({
      daily: daily[0]?.total ?? "0",
      weekly: weekly[0]?.total ?? "0",
      monthly: monthly[0]?.total ?? "0",
      allTime: allTime[0]?.total ?? "0",
    });
  } catch (err) {
    next(err);
  }
});

router.get("/analytics", agentOnly, async (req, res, next) => {
  try {
    const agentRows = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.userId, req.user!.id))
      .limit(1);
    const agent = agentRows[0];
    if (!agent) throw notFound("Agent profile not found");

    const days = clampInt(req.query.days, 30, 7, 90);

    const now = new Date();
    const rangeStart = new Date(now);
    rangeStart.setUTCHours(0, 0, 0, 0);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - (days - 1));

    const weeksBack = 12;
    const weekRangeStart = new Date(now);
    weekRangeStart.setUTCHours(0, 0, 0, 0);
    weekRangeStart.setUTCDate(weekRangeStart.getUTCDate() - weeksBack * 7);

    const referralCode = req.user!.referralCode;

    const [
      dailyCommissionRows,
      revenueBreakdownRows,
      weeklySignupRows,
      topPlayerRows,
    ] = await Promise.all([
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${commissionsTable.periodDate}), 'YYYY-MM-DD')`,
          amount: sql<string>`COALESCE(SUM(${commissionsTable.commissionAmount}), 0)::text`,
          stake: sql<string>`COALESCE(SUM(${commissionsTable.grossStake}), 0)::text`,
          payout: sql<string>`COALESCE(SUM(${commissionsTable.grossPayout}), 0)::text`,
        })
        .from(commissionsTable)
        .where(
          and(
            eq(commissionsTable.agentId, agent.id),
            gte(commissionsTable.periodDate, rangeStart),
          ),
        )
        .groupBy(sql`date_trunc('day', ${commissionsTable.periodDate})`)
        .orderBy(sql`date_trunc('day', ${commissionsTable.periodDate})`),
      db
        .select({
          totalStake: sql<string>`COALESCE(SUM(${commissionsTable.grossStake}), 0)::text`,
          totalPayout: sql<string>`COALESCE(SUM(${commissionsTable.grossPayout}), 0)::text`,
          totalNet: sql<string>`COALESCE(SUM(${commissionsTable.netRevenue}), 0)::text`,
          totalCommission: sql<string>`COALESCE(SUM(${commissionsTable.commissionAmount}), 0)::text`,
        })
        .from(commissionsTable)
        .where(eq(commissionsTable.agentId, agent.id)),
      referralCode
        ? db
            .select({
              week: sql<string>`to_char(date_trunc('week', ${usersTable.createdAt}), 'YYYY-MM-DD')`,
              count: sql<string>`COUNT(*)::text`,
            })
            .from(usersTable)
            .where(
              and(
                eq(usersTable.referredBy, referralCode),
                gte(usersTable.createdAt, weekRangeStart),
              ),
            )
            .groupBy(sql`date_trunc('week', ${usersTable.createdAt})`)
            .orderBy(sql`date_trunc('week', ${usersTable.createdAt})`)
        : Promise.resolve([] as { week: string; count: string }[]),
      db
        .select({
          playerId: commissionsTable.playerId,
          totalCommission: sql<string>`COALESCE(SUM(${commissionsTable.commissionAmount}), 0)::text`,
          totalNet: sql<string>`COALESCE(SUM(${commissionsTable.netRevenue}), 0)::text`,
        })
        .from(commissionsTable)
        .where(eq(commissionsTable.agentId, agent.id))
        .groupBy(commissionsTable.playerId)
        .orderBy(
          desc(
            sql`COALESCE(SUM(${commissionsTable.commissionAmount}), 0)`,
          ),
        )
        .limit(5),
    ]);

    const dayMap = new Map<string, { amount: string; stake: string; payout: string }>();
    for (const r of dailyCommissionRows) {
      dayMap.set(r.day, { amount: r.amount, stake: r.stake, payout: r.payout });
    }
    const commissionTrend: {
      date: string;
      commission: string;
      stake: string;
      payout: string;
    }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(rangeStart);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const v = dayMap.get(key);
      commissionTrend.push({
        date: key,
        commission: v?.amount ?? "0",
        stake: v?.stake ?? "0",
        payout: v?.payout ?? "0",
      });
    }

    const weekMap = new Map<string, string>();
    for (const r of weeklySignupRows) {
      weekMap.set(r.week, r.count);
    }
    const playerAcquisition: { weekStart: string; count: number }[] = [];
    const firstWeek = new Date(weekRangeStart);
    const dow = firstWeek.getUTCDay();
    const offsetToMonday = (dow + 6) % 7;
    firstWeek.setUTCDate(firstWeek.getUTCDate() - offsetToMonday);
    for (let i = 0; i < weeksBack; i++) {
      const d = new Date(firstWeek);
      d.setUTCDate(d.getUTCDate() + i * 7);
      const key = d.toISOString().slice(0, 10);
      playerAcquisition.push({
        weekStart: key,
        count: Number(weekMap.get(key) ?? 0),
      });
    }

    const topPlayerIds = topPlayerRows.map((r) => r.playerId);
    const playerEmailMap = new Map<string, string>();
    if (topPlayerIds.length > 0) {
      const players = await db
        .select({ id: usersTable.id, email: usersTable.email })
        .from(usersTable)
        .where(inArray(usersTable.id, topPlayerIds));
      for (const p of players) {
        playerEmailMap.set(p.id, p.email);
      }
    }
    const topPlayers = topPlayerRows.map((r) => ({
      playerId: r.playerId,
      playerEmail: playerEmailMap.get(r.playerId) ?? "",
      commission: r.totalCommission,
      netRevenue: r.totalNet,
    }));

    const breakdown = revenueBreakdownRows[0] ?? {
      totalStake: "0",
      totalPayout: "0",
      totalNet: "0",
      totalCommission: "0",
    };

    res.json({
      rangeDays: days,
      commissionTrend,
      playerAcquisition,
      topPlayers,
      revenueBreakdown: {
        totalStake: breakdown.totalStake,
        totalPayout: breakdown.totalPayout,
        netRevenue: breakdown.totalNet,
        totalCommission: breakdown.totalCommission,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/reports/players/csv",
  agentOnly,
  async (req, res, next) => {
    try {
      const referralCode = req.user!.referralCode;
      if (!referralCode) {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="players.csv"',
        );
        res.send("No referral code\n");
        return;
      }

      const conds = [eq(usersTable.referredBy, referralCode)] as ReturnType<
        typeof eq
      >[];
      if (typeof req.query.from === "string" && req.query.from) {
        const d = new Date(req.query.from);
        if (!Number.isNaN(d.getTime()))
          conds.push(gte(usersTable.createdAt, d));
      }
      if (typeof req.query.to === "string" && req.query.to) {
        const d = new Date(req.query.to);
        if (!Number.isNaN(d.getTime())) {
          const nextDay = new Date(d);
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          conds.push(lt(usersTable.createdAt, nextDay));
        }
      }

      const players = await db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          displayName: usersTable.displayName,
          status: usersTable.status,
          createdAt: usersTable.createdAt,
        })
        .from(usersTable)
        .where(and(...conds))
        .orderBy(desc(usersTable.createdAt));

      const playerIds = players.map((p) => p.id);
      let betMap = new Map<string, { stake: string; payout: string }>();
      let depMap = new Map<string, string>();

      if (playerIds.length > 0) {
        const [betStats, depositStats] = await Promise.all([
          db
            .select({
              userId: betsTable.userId,
              totalStake: sql<string>`COALESCE(SUM(${betsTable.stakeAmount}), 0)::text`,
              totalPayout: sql<string>`COALESCE(SUM(${betsTable.payoutAmount}), 0)::text`,
            })
            .from(betsTable)
            .where(inArray(betsTable.userId, playerIds))
            .groupBy(betsTable.userId),
          db
            .select({
              userId: walletLedgerTable.userId,
              totalDeposits: sql<string>`COALESCE(SUM(CASE WHEN ${walletLedgerTable.type} = 'deposit' THEN ${walletLedgerTable.amount} ELSE 0 END), 0)::text`,
            })
            .from(walletLedgerTable)
            .where(inArray(walletLedgerTable.userId, playerIds))
            .groupBy(walletLedgerTable.userId),
        ]);

        for (const b of betStats) {
          betMap.set(b.userId, { stake: b.totalStake, payout: b.totalPayout });
        }
        for (const d of depositStats) {
          depMap.set(d.userId, d.totalDeposits);
        }
      }

      const csvLines = [
        "Player ID,Email,Display Name,Status,Signup Date,Lifetime Deposits (paise),Lifetime Bets (paise),Lifetime Net (paise)",
      ];
      for (const p of players) {
        const bet = betMap.get(p.id) ?? { stake: "0", payout: "0" };
        const dep = depMap.get(p.id) ?? "0";
        const net = (BigInt(bet.stake) - BigInt(bet.payout)).toString();
        csvLines.push(
          [
            p.id,
            `"${(p.email ?? "").replace(/"/g, '""')}"`,
            `"${(p.displayName ?? "").replace(/"/g, '""')}"`,
            p.status,
            p.createdAt.toISOString(),
            dep,
            bet.stake,
            net,
          ].join(","),
        );
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="players.csv"',
      );
      res.send(csvLines.join("\n") + "\n");
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/reports/commissions/csv",
  agentOnly,
  async (req, res, next) => {
    try {
      const agentRows = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.userId, req.user!.id))
        .limit(1);
      const agent = agentRows[0];
      if (!agent) throw notFound("Agent profile not found");

      const conds = [eq(commissionsTable.agentId, agent.id)] as ReturnType<
        typeof eq
      >[];
      if (typeof req.query.from === "string" && req.query.from) {
        const d = new Date(req.query.from);
        if (!Number.isNaN(d.getTime()))
          conds.push(gte(commissionsTable.periodDate, d));
      }
      if (typeof req.query.to === "string" && req.query.to) {
        const d = new Date(req.query.to);
        if (!Number.isNaN(d.getTime())) {
          const nextDay = new Date(d);
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          conds.push(lt(commissionsTable.periodDate, nextDay));
        }
      }

      const rows = await db
        .select()
        .from(commissionsTable)
        .where(and(...conds))
        .orderBy(desc(commissionsTable.periodDate));

      const playerIds = [...new Set(rows.map((r) => r.playerId))];
      let playerMap = new Map<string, string>();
      if (playerIds.length > 0) {
        const players = await db
          .select({ id: usersTable.id, email: usersTable.email })
          .from(usersTable)
          .where(inArray(usersTable.id, playerIds));
        for (const p of players) {
          playerMap.set(p.id, p.email);
        }
      }

      const csvLines = [
        "Period Date,Player ID,Player Email,Gross Stake (paise),Gross Payout (paise),Net Revenue (paise),Commission Rate %,Commission Amount (paise)",
      ];
      for (const c of rows) {
        csvLines.push(
          [
            c.periodDate.toISOString().split("T")[0],
            c.playerId,
            `"${(playerMap.get(c.playerId) ?? "").replace(/"/g, '""')}"`,
            c.grossStake.toString(),
            c.grossPayout.toString(),
            c.netRevenue.toString(),
            c.commissionRate.toString(),
            c.commissionAmount.toString(),
          ].join(","),
        );
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="commissions.csv"',
      );
      res.send(csvLines.join("\n") + "\n");
    } catch (err) {
      next(err);
    }
  },
);

router.post("/payouts/request", agentOnly, async (req, res, next) => {
  try {
    const agentRows = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.userId, req.user!.id))
      .limit(1);
    const agent = agentRows[0];
    if (!agent) throw notFound("Agent profile not found");

    const body = req.body as { amount?: string; upiId?: string };
    if (!body.amount || !/^\d{1,18}$/.test(body.amount)) {
      throw badRequest("amount must be a positive integer string (paise)");
    }
    const amount = BigInt(body.amount);
    if (amount <= 0n) throw badRequest("Amount must be positive");

    const upiId = body.upiId || agent.upiId;
    if (!upiId) throw badRequest("UPI ID is required");

    const balance = await getAgentCommissionBalance(agent.id, req.user!.id);
    if (balance < amount) {
      throw badRequest("Insufficient commission balance");
    }

    const pendingRows = await db
      .select({ c: count() })
      .from(withdrawalsTable)
      .where(
        and(
          eq(withdrawalsTable.userId, req.user!.id),
          eq(withdrawalsTable.kind, "agent_commission"),
          eq(withdrawalsTable.status, "pending"),
        ),
      );
    if (Number(pendingRows[0]?.c ?? 0) > 0) {
      throw badRequest("You already have a pending payout request");
    }

    const [withdrawal] = await db
      .insert(withdrawalsTable)
      .values({
        userId: req.user!.id,
        amount,
        method: "upi",
        destination: upiId,
        kind: "agent_commission",
        status: "pending",
        metadata: { agentId: agent.id },
      })
      .returning();

    bus.publish({
      topic: "withdrawals:admin",
      type: "created",
      id: withdrawal!.id,
      userId: withdrawal!.userId,
      amount: withdrawal!.amount.toString(),
      status: "pending",
      ts: Date.now(),
    });
    bus.publish({
      topic: "admin:metrics",
      type: "bump",
      reason: "withdrawal_created",
      ts: Date.now(),
    });

    await recordAuditFromReq(req, {
      action: "agent_payout.request",
      targetType: "withdrawal",
      targetId: withdrawal!.id,
      after: {
        agentId: agent.id,
        amount: amount.toString(),
        upiId,
        kind: "agent_commission",
      },
    });

    res.json({
      id: withdrawal!.id,
      userId: withdrawal!.userId,
      amount: withdrawal!.amount.toString(),
      currency: withdrawal!.currency,
      method: withdrawal!.method,
      destination: withdrawal!.destination,
      kind: withdrawal!.kind,
      status: withdrawal!.status,
      requestedAt: withdrawal!.requestedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/payouts", agentOnly, async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(withdrawalsTable)
      .where(
        and(
          eq(withdrawalsTable.userId, req.user!.id),
          eq(withdrawalsTable.kind, "agent_commission"),
        ),
      )
      .orderBy(desc(withdrawalsTable.requestedAt))
      .limit(50);

    res.json(
      rows.map((w) => ({
        id: w.id,
        userId: w.userId,
        amount: w.amount.toString(),
        currency: w.currency,
        method: w.method,
        destination: w.destination,
        kind: w.kind,
        status: w.status,
        rejectionReason: w.rejectionReason,
        reviewedBy: w.reviewedBy,
        reviewedAt: w.reviewedAt ? w.reviewedAt.toISOString() : null,
        requestedAt: w.requestedAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
