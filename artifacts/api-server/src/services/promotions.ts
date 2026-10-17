import {
  db,
  signupBonusClaimsTable,
  referralsTable,
  usersTable,
  paymentRequestsTable,
  bonusEventsTable,
} from "@workspace/db";
import { and, eq, sql, desc } from "drizzle-orm";
import {
  creditBonus,
  matchDepositTier,
  getPromotionSettings,
  recordBonusEvent,
  BonusCreditOverflowError,
} from "./bonusWallet";
import { logger } from "../lib/logger";
import { createNotification } from "./notifications";
import { bus } from "../realtime/eventBus";

/**
 * Signup bonus + referral linkage.
 *
 * Idempotent per userId via unique index on signup_bonus_claims.user_id.
 * IP and emailNormalized are deduped via partial unique indexes — if either
 * has already been used to claim a granted signup bonus, we record a
 * blocked claim and do NOT credit.
 */
export async function applySignupBonusAndReferral(input: {
  userId: string;
  email: string;
  emailNormalized: string;
  ip: string | null;
  referredBy: string | null;
}): Promise<{ granted: boolean; blockedReason: string | null }> {
  const settings = await getPromotionSettings();

  // Always create the referral row first (if a code linked the user) so the
  // referrer can see the signup even when the bonus is blocked.
  if (input.referredBy) {
    try {
      const referrerRows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.referralCode, input.referredBy))
        .limit(1);
      const referrerId = referrerRows[0]?.id;
      if (referrerId && referrerId !== input.userId) {
        await db
          .insert(referralsTable)
          .values({
            referrerId,
            refereeId: input.userId,
            referralCode: input.referredBy,
            status: "signed_up",
            rewardPaise: 0n,
          })
          .onConflictDoNothing({ target: referralsTable.refereeId });
        await recordBonusEvent({
          type: "referral_signed_up",
          userId: input.userId,
          metadata: { referrerId, code: input.referredBy },
        });
        // Push a bonus-topic event to the referrer so their Promotions page
        // (subscribed to `bonus:{referrerId}`) re-fetches the referral list
        // immediately. We reuse the BonusEvent shape (`type:"balance"`) since
        // the client just invalidates queries on any push.
        try {
          bus.publish({
            topic: `bonus:${referrerId}`,
            type: "balance",
            balance: "0",
            entryType: "referral",
            amount: "0",
            ts: Date.now(),
          });
        } catch {
          /* best-effort */
        }
      }
    } catch (err) {
      logger.warn({ err }, "Failed to create referral row");
    }
  }

  if (!settings.enabled) {
    return { granted: false, blockedReason: "promotions_disabled" };
  }

  const amount = BigInt(settings.signupBonusPaise);
  if (amount <= 0n) {
    return { granted: false, blockedReason: "amount_zero" };
  }

  // Determine block status by checking existing granted claims.
  let blockedReason: string | null = null;
  if (input.ip) {
    const ipDup = await db
      .select({ id: signupBonusClaimsTable.id })
      .from(signupBonusClaimsTable)
      .where(
        and(
          eq(signupBonusClaimsTable.ip, input.ip),
          eq(signupBonusClaimsTable.granted, true),
        ),
      )
      .limit(1);
    if (ipDup[0]) blockedReason = "duplicate_ip";
  }
  if (!blockedReason) {
    const emailDup = await db
      .select({ id: signupBonusClaimsTable.id })
      .from(signupBonusClaimsTable)
      .where(
        and(
          eq(signupBonusClaimsTable.emailNormalized, input.emailNormalized),
          eq(signupBonusClaimsTable.granted, true),
        ),
      )
      .limit(1);
    if (emailDup[0]) blockedReason = "duplicate_email";
  }

  // Insert claim row (granted or blocked). Unique on user_id makes it idempotent.
  try {
    await db
      .insert(signupBonusClaimsTable)
      .values({
        userId: input.userId,
        ip: input.ip,
        emailNormalized: input.emailNormalized,
        granted: !blockedReason,
        blockedReason,
        amount: blockedReason ? 0n : amount,
      })
      .onConflictDoNothing({ target: signupBonusClaimsTable.userId });
  } catch (err) {
    // Race on partial unique IP/email index → another claim won. Treat as blocked.
    logger.info({ err }, "Signup bonus claim race");
    blockedReason = blockedReason ?? "duplicate_concurrent";
  }

  if (blockedReason) {
    await recordBonusEvent({
      type:
        blockedReason === "duplicate_ip"
          ? "signup_blocked_ip"
          : "signup_blocked_email",
      userId: input.userId,
      ip: input.ip,
      metadata: { reason: blockedReason },
    });
    return { granted: false, blockedReason };
  }

  try {
    await creditBonus({
      userId: input.userId,
      type: "signup",
      amount,
      refType: "signup",
      refId: input.userId,
      memo: "Signup welcome bonus",
    });
    await recordBonusEvent({
      type: "signup_granted",
      userId: input.userId,
      amount,
      ip: input.ip,
    });
    await createNotification({
      userId: input.userId,
      type: "bonus_issued",
      title: "Welcome bonus credited",
      message: `₹${(Number(amount) / 100).toFixed(2)} bonus credited. Use it on Lunar, Mines, Plinko or Dice.`,
      linkUrl: "/promotions",
    });
    return { granted: true, blockedReason: null };
  } catch (err) {
    logger.error({ err, userId: input.userId }, "Failed to credit signup bonus");
    return { granted: false, blockedReason: "credit_failed" };
  }
}

/**
 * Apply deposit-tier bonus + referrer reward when a deposit is approved.
 * Both are idempotent per paymentRequestId via the bonus_ledger partial
 * unique index on (refType, refId, type).
 */
export async function applyDepositBonus(input: {
  paymentRequestId: string;
  userId: string;
  amountPaise: bigint;
}): Promise<{ tierBonus: bigint; referralReward: bigint }> {
  const settings = await getPromotionSettings();
  if (!settings.enabled) return { tierBonus: 0n, referralReward: 0n };

  let tierBonus = 0n;
  const tier = matchDepositTier(input.amountPaise, settings.depositTiers);
  if (tier) {
    const amt = BigInt(tier.bonusPaise);
    if (amt > 0n) {
      try {
        const result = await creditBonus({
          userId: input.userId,
          type: "deposit_tier",
          amount: amt,
          refType: "deposit",
          refId: input.paymentRequestId,
          memo: `Deposit bonus (₹${(Number(BigInt(tier.minPaise)) / 100).toFixed(0)}+ tier)`,
          metadata: {
            depositAmount: input.amountPaise.toString(),
            tier: { ...tier },
          },
        });
        if (!result.alreadyApplied) {
          tierBonus = amt;
          await recordBonusEvent({
            type: "deposit_bonus_granted",
            userId: input.userId,
            amount: amt,
            metadata: {
              paymentRequestId: input.paymentRequestId,
              depositAmount: input.amountPaise.toString(),
              tierMin: tier.minPaise,
              tierMax: tier.maxPaise,
              tierBonus: tier.bonusPaise,
            },
          });
          await createNotification({
            userId: input.userId,
            type: "bonus_issued",
            title: "Deposit bonus credited",
            message: `₹${(Number(amt) / 100).toFixed(2)} bonus credited for your deposit.`,
            linkUrl: "/promotions",
          });
        }
      } catch (err) {
        const isOverflow = err instanceof BonusCreditOverflowError;
        logger.error(
          { err, paymentRequestId: input.paymentRequestId, overflow: isOverflow },
          "Failed to credit deposit bonus",
        );
        await recordBonusEvent({
          type: isOverflow ? "bonus_credit_overflow" : "bonus_credit_failed",
          userId: input.userId,
          amount: amt,
          metadata: {
            kind: "deposit_tier",
            paymentRequestId: input.paymentRequestId,
            error: err instanceof Error ? err.message : String(err),
            ...(isOverflow
              ? {
                  overflowField: err.field,
                  projected: err.projected.toString(),
                }
              : {}),
          },
        });
      }
    }
  }

  // Referral reward: triggered when a referee makes their first deposit
  // ≥ referrerMinDepositPaise. Marks referral as 'qualified'. Idempotent
  // via referrals.refereeId unique + bonus_ledger partial unique index.
  let referralReward = 0n;
  if (input.amountPaise >= BigInt(settings.referrerMinDepositPaise)) {
    try {
      const refRows = await db
        .select()
        .from(referralsTable)
        .where(eq(referralsTable.refereeId, input.userId))
        .limit(1);
      const ref = refRows[0];
      if (ref && ref.status === "signed_up") {
        const reward = BigInt(settings.referrerRewardPaise);
        if (reward > 0n) {
          const credit = await creditBonus({
            userId: ref.referrerId,
            type: "referral",
            amount: reward,
            refType: "referral",
            refId: ref.id,
            memo: `Referral reward — referee qualified`,
            metadata: {
              refereeId: input.userId,
              paymentRequestId: input.paymentRequestId,
            },
          });
          if (!credit.alreadyApplied) {
            referralReward = reward;
            await db
              .update(referralsTable)
              .set({
                status: "qualified",
                qualifyingDepositId: input.paymentRequestId,
                rewardLedgerId: credit.ledgerId,
                rewardPaise: reward,
                qualifiedAt: new Date(),
              })
              .where(eq(referralsTable.id, ref.id));
            await recordBonusEvent({
              type: "referral_qualified",
              userId: ref.referrerId,
              amount: reward,
              metadata: {
                refereeId: input.userId,
                paymentRequestId: input.paymentRequestId,
              },
            });
            await createNotification({
              userId: ref.referrerId,
              type: "bonus_issued",
              title: "Referral reward credited",
              message: `Your referee made a qualifying deposit. ₹${(Number(reward) / 100).toFixed(2)} bonus credited.`,
              linkUrl: "/promotions",
            });
          }
        }
      }
    } catch (err) {
      const isOverflow = err instanceof BonusCreditOverflowError;
      logger.error(
        { err, userId: input.userId, overflow: isOverflow },
        "Failed to apply referral reward",
      );
      await recordBonusEvent({
        type: isOverflow ? "bonus_credit_overflow" : "bonus_credit_failed",
        userId: input.userId,
        amount: BigInt(settings.referrerRewardPaise),
        metadata: {
          kind: "referral",
          paymentRequestId: input.paymentRequestId,
          error: err instanceof Error ? err.message : String(err),
          ...(isOverflow
            ? {
                overflowField: err.field,
                projected: err.projected.toString(),
              }
            : {}),
        },
      });
    }
  }

  return { tierBonus, referralReward };
}

export interface ReferralSummary {
  referralCode: string | null;
  totalReferred: number;
  qualifiedCount: number;
  totalEarnedPaise: string;
  recent: Array<{
    refereeId: string;
    refereeEmail: string;
    status: "signed_up" | "qualified";
    rewardPaise: string;
    createdAt: string;
    qualifiedAt: string | null;
  }>;
}

export async function getReferralSummary(userId: string): Promise<ReferralSummary> {
  const userRows = await db
    .select({ referralCode: usersTable.referralCode })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const code = userRows[0]?.referralCode ?? null;

  const refs = await db
    .select({
      id: referralsTable.id,
      refereeId: referralsTable.refereeId,
      status: referralsTable.status,
      createdAt: referralsTable.createdAt,
      qualifiedAt: referralsTable.qualifiedAt,
      rewardLedgerId: referralsTable.rewardLedgerId,
      rewardPaise: referralsTable.rewardPaise,
      refereeEmail: usersTable.email,
    })
    .from(referralsTable)
    .leftJoin(usersTable, eq(usersTable.id, referralsTable.refereeId))
    .where(eq(referralsTable.referrerId, userId))
    .orderBy(desc(referralsTable.createdAt))
    .limit(50);

  let qualifiedCount = 0;
  let totalEarned = 0n;
  for (const r of refs) {
    if (r.status === "qualified") {
      qualifiedCount++;
      totalEarned += r.rewardPaise ?? 0n;
    }
  }

  return {
    referralCode: code,
    totalReferred: refs.length,
    qualifiedCount,
    totalEarnedPaise: totalEarned.toString(),
    recent: refs.slice(0, 10).map((r) => ({
      refereeId: r.refereeId,
      refereeEmail: maskEmail(r.refereeEmail ?? ""),
      status: r.status,
      rewardPaise:
        r.status === "qualified" ? (r.rewardPaise ?? 0n).toString() : "0",
      createdAt: r.createdAt.toISOString(),
      qualifiedAt: r.qualifiedAt ? r.qualifiedAt.toISOString() : null,
    })),
  };
}

function maskEmail(email: string): string {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const head = local.slice(0, Math.max(1, Math.min(2, local.length - 1)));
  return `${head}***@${domain}`;
}

export interface PromotionAnalytics {
  windowDays: number;
  totals: {
    signupGranted: number;
    signupBlocked: number;
    depositBonusGranted: number;
    referralQualified: number;
    bonusBets: number;
    bonusWins: number;
    converted: number;
    revoked: number;
  };
  totalIssuedPaise: string;
  totalConvertedPaise: string;
  totalRevokedPaise: string;
  /** Issued split by bonus source (count + amount). */
  issuedByType: Array<{ type: string; count: number; amountPaise: string }>;
  /** Per-day funnel for the selected window. */
  funnel: Array<{
    date: string;
    invited: number;
    signedUp: number;
    qualified: number;
    grantedAmountPaise: string;
    convertedAmountPaise: string;
  }>;
  /** Top 10 referrers by qualified-referee count in the window. */
  topReferrers: Array<{
    referrerId: string;
    referrerEmail: string | null;
    qualifiedCount: number;
    totalRewardPaise: string;
  }>;
  /** Recharge-tier distribution: how many deposit-bonuses were granted at each tier band. */
  tierDistribution: Array<{
    label: string;
    count: number;
    amountPaise: string;
  }>;
  /** Legacy field kept for backwards compatibility with older clients. */
  recentDays: Array<{ date: string; granted: number; amountPaise: string }>;
}

const ALLOWED_WINDOWS = new Set([7, 30, 90]);

export async function getPromotionAnalytics(
  windowDays = 30,
): Promise<PromotionAnalytics> {
  const w = ALLOWED_WINDOWS.has(windowDays) ? windowDays : 30;
  const sinceLiteral = sql.raw(`'${w} days'`);

  const rows = await db
    .select({
      type: bonusEventsTable.type,
      count: sql<string>`COUNT(*)::text`,
      sum: sql<string>`COALESCE(SUM(${bonusEventsTable.amount}), 0)::text`,
    })
    .from(bonusEventsTable)
    .where(sql`${bonusEventsTable.createdAt} >= NOW() - INTERVAL ${sinceLiteral}`)
    .groupBy(bonusEventsTable.type);

  const map = new Map<string, { count: number; sum: bigint }>();
  for (const r of rows) {
    map.set(r.type, { count: Number(r.count), sum: BigInt(r.sum) });
  }
  const get = (k: string) => map.get(k) ?? { count: 0, sum: 0n };

  const grantedTotal =
    get("signup_granted").sum +
    get("deposit_bonus_granted").sum +
    get("referral_qualified").sum;

  const issuedByType = [
    { type: "signup", ...get("signup_granted") },
    { type: "deposit_tier", ...get("deposit_bonus_granted") },
    { type: "referral", ...get("referral_qualified") },
  ].map((e) => ({
    type: e.type,
    count: e.count,
    amountPaise: e.sum.toString(),
  }));

  // Per-day funnel: invited (referral_signed_up) + qualified (referral_qualified)
  // + granted (any source) + converted (bonus_converted_to_cash). For invited
  // and signedUp we treat referral_signed_up as both because the signup creates
  // the row immediately on referee registration.
  const funnelRows = await db.execute<{
    d: Date | string;
    invited: number;
    signed_up: number;
    qualified: number;
    granted_amount: string;
    converted_amount: string;
  }>(sql`
    SELECT
      date_trunc('day', created_at)::date AS d,
      COUNT(*) FILTER (WHERE type = 'referral_signed_up')::int AS invited,
      COUNT(*) FILTER (WHERE type = 'signup_granted')::int       AS signed_up,
      COUNT(*) FILTER (WHERE type = 'referral_qualified')::int   AS qualified,
      COALESCE(SUM(amount) FILTER (WHERE type IN ('signup_granted','deposit_bonus_granted','referral_qualified')), 0)::text AS granted_amount,
      COALESCE(SUM(amount) FILTER (WHERE type = 'bonus_converted_to_cash'), 0)::text AS converted_amount
    FROM bonus_events
    WHERE created_at >= NOW() - INTERVAL ${sinceLiteral}
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT ${w}
  `);
  const funnel = (funnelRows.rows as Array<{
    d: Date | string;
    invited: number;
    signed_up: number;
    qualified: number;
    granted_amount: string;
    converted_amount: string;
  }>).map((r) => ({
    date: typeof r.d === "string" ? r.d : new Date(r.d).toISOString().slice(0, 10),
    invited: Number(r.invited),
    signedUp: Number(r.signed_up),
    qualified: Number(r.qualified),
    grantedAmountPaise: r.granted_amount,
    convertedAmountPaise: r.converted_amount,
  }));

  // Top referrers leaderboard: qualified referrals in the window.
  // Sum the per-row stored reward (rewardPaise) so historical referrals
  // are not retroactively re-priced when settings change.
  const referrerRows = await db.execute<{
    referrer_id: string;
    email: string | null;
    qualified_count: number;
    total_reward: string;
  }>(sql`
    SELECT
      r.referrer_id,
      u.email,
      COUNT(*)::int AS qualified_count,
      COALESCE(SUM(r.reward_paise), 0)::text AS total_reward
    FROM referrals r
    LEFT JOIN users u ON u.id = r.referrer_id
    WHERE r.status = 'qualified'
      AND r.qualified_at IS NOT NULL
      AND r.qualified_at >= NOW() - INTERVAL ${sinceLiteral}
    GROUP BY r.referrer_id, u.email
    ORDER BY qualified_count DESC
    LIMIT 10
  `);
  const topReferrers = (referrerRows.rows as Array<{
    referrer_id: string;
    email: string | null;
    qualified_count: number;
    total_reward: string;
  }>).map((r) => ({
    referrerId: r.referrer_id,
    referrerEmail: r.email ? maskEmail(r.email) : null,
    qualifiedCount: Number(r.qualified_count),
    totalRewardPaise: r.total_reward,
  }));

  // Recharge-tier distribution over the window. We bucket by the tier the
  // bonus was granted at, derived from the metadata.tierMin/tierMax fields
  // recorded at grant time. For events missing metadata we bucket as "other".
  const tierRows = await db.execute<{
    label: string;
    count: number;
    sum: string;
  }>(sql`
    SELECT
      CASE
        WHEN (metadata->>'tierMin') IS NULL THEN 'other'
        WHEN (metadata->>'tierMax') IS NULL THEN '≥ ₹' || ((metadata->>'tierMin')::bigint / 100)
        ELSE '₹' || ((metadata->>'tierMin')::bigint / 100) || '–₹' || ((metadata->>'tierMax')::bigint / 100)
      END AS label,
      COUNT(*)::int AS count,
      COALESCE(SUM(amount), 0)::text AS sum
    FROM bonus_events
    WHERE type = 'deposit_bonus_granted'
      AND created_at >= NOW() - INTERVAL ${sinceLiteral}
    GROUP BY 1
    ORDER BY count DESC
    LIMIT 20
  `);
  const tierDistribution = (tierRows.rows as Array<{
    label: string;
    count: number;
    sum: string;
  }>).map((r) => ({
    label: r.label,
    count: Number(r.count),
    amountPaise: r.sum,
  }));

  return {
    windowDays: w,
    totals: {
      signupGranted: get("signup_granted").count,
      signupBlocked:
        get("signup_blocked_ip").count + get("signup_blocked_email").count,
      depositBonusGranted: get("deposit_bonus_granted").count,
      referralQualified: get("referral_qualified").count,
      bonusBets: get("bonus_bet_placed").count,
      bonusWins: get("bonus_win_credited").count,
      converted: get("bonus_converted_to_cash").count,
      revoked: get("bonus_revoked").count,
    },
    totalIssuedPaise: grantedTotal.toString(),
    totalConvertedPaise: get("bonus_converted_to_cash").sum.toString(),
    totalRevokedPaise: get("bonus_revoked").sum.toString(),
    issuedByType,
    funnel,
    topReferrers,
    tierDistribution,
    recentDays: funnel.map((f) => ({
      date: f.date,
      granted: f.signedUp + f.qualified,
      amountPaise: f.grantedAmountPaise,
    })),
  };
}

export interface ListBonusEventsInput {
  type?: string;
  userId?: string;
  /** ISO datetime — inclusive lower bound on createdAt. */
  from?: string;
  /** ISO datetime — exclusive upper bound on createdAt. */
  to?: string;
  limit: number;
  offset: number;
}

export async function listBonusEvents(input: ListBonusEventsInput) {
  const conds = [];
  if (input.type) conds.push(eq(bonusEventsTable.type, input.type as never));
  if (input.userId) conds.push(eq(bonusEventsTable.userId, input.userId));
  if (input.from) {
    const d = new Date(input.from);
    if (!isNaN(d.getTime())) {
      conds.push(sql`${bonusEventsTable.createdAt} >= ${d}`);
    }
  }
  if (input.to) {
    const d = new Date(input.to);
    if (!isNaN(d.getTime())) {
      conds.push(sql`${bonusEventsTable.createdAt} < ${d}`);
    }
  }
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select()
    .from(bonusEventsTable)
    .where(where)
    .orderBy(desc(bonusEventsTable.createdAt))
    .limit(input.limit + 1)
    .offset(input.offset);
  const entries = rows.slice(0, input.limit).map((r) => ({
    id: r.id,
    userId: r.userId,
    type: r.type,
    amount: r.amount.toString(),
    ip: r.ip,
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
  }));
  return {
    entries,
    hasMore: rows.length > input.limit,
  };
}
