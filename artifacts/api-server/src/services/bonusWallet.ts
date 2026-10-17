import {
  db,
  bonusLedgerTable,
  bonusWageringTable,
  bonusEventsTable,
  promotionSettingsTable,
  type BonusLedgerType,
  type BonusEventType,
} from "@workspace/db";
import { and, eq, sql, desc, lt, or } from "drizzle-orm";
import { bus } from "../realtime/eventBus";
import { logger } from "../lib/logger";

export const BONUS_GAMES = ["lunar", "mines", "plinko", "dice"] as const;
export type BonusGameCode = (typeof BONUS_GAMES)[number];

export function isBonusEligibleGame(code: string): code is BonusGameCode {
  return (BONUS_GAMES as readonly string[]).includes(code);
}

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

const SETTINGS_ID = "singleton";

// Default tier ladder per Task #102:
//   < ₹5,000           → no bonus
//   ₹5,000  – ₹9,999   → ₹1,000 bonus
//   ₹10,000            → ₹2,000 bonus
//   > ₹10,000          → ₹2,500 bonus
const DEFAULT_TIERS = [
  { minPaise: "500000", maxPaise: "999999", bonusPaise: "100000" },
  { minPaise: "1000000", maxPaise: "1000000", bonusPaise: "200000" },
  { minPaise: "1000001", maxPaise: null, bonusPaise: "250000" },
];

export interface DepositTier {
  minPaise: string;
  maxPaise: string | null;
  bonusPaise: string;
}

export interface PromotionSettingsView {
  enabled: boolean;
  signupBonusPaise: string;
  depositTiers: DepositTier[];
  referrerRewardPaise: string;
  referrerMinDepositPaise: string;
  wageringMultiplier: number;
  updatedAt: string;
  updatedBy: string | null;
}

export async function getPromotionSettings(): Promise<PromotionSettingsView> {
  const rows = await db
    .select()
    .from(promotionSettingsTable)
    .where(eq(promotionSettingsTable.id, SETTINGS_ID))
    .limit(1);
  let row = rows[0];
  if (!row) {
    const [created] = await db
      .insert(promotionSettingsTable)
      .values({
        id: SETTINGS_ID,
        depositTiers: DEFAULT_TIERS as unknown as object,
      })
      .onConflictDoNothing({ target: promotionSettingsTable.id })
      .returning();
    if (created) {
      row = created;
    } else {
      const reselect = await db
        .select()
        .from(promotionSettingsTable)
        .where(eq(promotionSettingsTable.id, SETTINGS_ID))
        .limit(1);
      row = reselect[0]!;
    }
  }
  const tiers = Array.isArray(row.depositTiers)
    ? (row.depositTiers as DepositTier[])
    : DEFAULT_TIERS;
  return {
    enabled: row.enabled,
    signupBonusPaise: row.signupBonusPaise.toString(),
    depositTiers: tiers,
    referrerRewardPaise: row.referrerRewardPaise.toString(),
    referrerMinDepositPaise: row.referrerMinDepositPaise.toString(),
    wageringMultiplier: row.wageringMultiplier,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

export interface UpdatePromotionSettingsInput {
  enabled?: boolean;
  signupBonusPaise?: string;
  depositTiers?: DepositTier[];
  referrerRewardPaise?: string;
  referrerMinDepositPaise?: string;
  wageringMultiplier?: number;
  updatedBy: string;
}

export async function updatePromotionSettings(
  input: UpdatePromotionSettingsInput,
): Promise<PromotionSettingsView> {
  await getPromotionSettings(); // ensure row
  if (input.depositTiers) {
    // Validate: every tier must have valid bigint strings; sorted by minPaise.
    const tiers = [...input.depositTiers].sort(
      (a, b) => Number(BigInt(a.minPaise) - BigInt(b.minPaise)) || 0,
    );
    for (const t of tiers) {
      BigInt(t.minPaise);
      BigInt(t.bonusPaise);
      if (t.maxPaise !== null) BigInt(t.maxPaise);
    }
    input.depositTiers = tiers;
  }
  await db
    .update(promotionSettingsTable)
    .set({
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.signupBonusPaise !== undefined
        ? { signupBonusPaise: BigInt(input.signupBonusPaise) }
        : {}),
      ...(input.depositTiers !== undefined
        ? { depositTiers: input.depositTiers as unknown as object }
        : {}),
      ...(input.referrerRewardPaise !== undefined
        ? { referrerRewardPaise: BigInt(input.referrerRewardPaise) }
        : {}),
      ...(input.referrerMinDepositPaise !== undefined
        ? {
            referrerMinDepositPaise: BigInt(input.referrerMinDepositPaise),
          }
        : {}),
      ...(input.wageringMultiplier !== undefined
        ? { wageringMultiplier: input.wageringMultiplier }
        : {}),
      updatedBy: input.updatedBy,
      updatedAt: new Date(),
    })
    .where(eq(promotionSettingsTable.id, SETTINGS_ID));
  await recordBonusEvent({
    type: "settings_updated",
    userId: null,
    metadata: { updatedBy: input.updatedBy },
  });
  return await getPromotionSettings();
}

export function matchDepositTier(
  amountPaise: bigint,
  tiers: DepositTier[],
): DepositTier | null {
  let best: DepositTier | null = null;
  for (const t of tiers) {
    const min = BigInt(t.minPaise);
    if (amountPaise < min) continue;
    if (t.maxPaise !== null) {
      const max = BigInt(t.maxPaise);
      if (amountPaise > max) continue;
    }
    if (!best || BigInt(t.minPaise) >= BigInt(best.minPaise)) {
      best = t;
    }
  }
  return best;
}

/**
 * Acquire a per-user serialization lock for the bonus wallet. We use the
 * `bonus_wagering` row keyed by userId as the canonical lock target —
 * every mutating bonus operation (debit, credit, refund, conversion,
 * revoke) calls this first, mirroring the wallet-row `FOR UPDATE`
 * pattern used in `wallet.postEntryCore`. This serialises concurrent
 * bonus mutations for the same user and prevents:
 *   - double-spend via concurrent debits both reading the same SUM,
 *   - wagering miscounts when issuance and bets race,
 *   - premature conversion when issuance and conversion race.
 *
 * The wagering row is created on first use so the FOR UPDATE always
 * has a row to lock.
 */
async function lockBonusUser(tx: TxClient, userId: string): Promise<void> {
  await tx
    .insert(bonusWageringTable)
    .values({
      userId,
      totalIssued: 0n,
      requiredWager: 0n,
      wageredSoFar: 0n,
    })
    .onConflictDoNothing({ target: bonusWageringTable.userId });
  await tx
    .select({ userId: bonusWageringTable.userId })
    .from(bonusWageringTable)
    .where(eq(bonusWageringTable.userId, userId))
    .for("update")
    .limit(1);
}

async function getBalanceTx(
  tx: TxClient,
  userId: string,
): Promise<bigint> {
  const rows = await tx
    .select({
      total: sql<string>`COALESCE(SUM(${bonusLedgerTable.amount}), 0)::text`,
    })
    .from(bonusLedgerTable)
    .where(eq(bonusLedgerTable.userId, userId));
  return BigInt(rows[0]?.total ?? "0");
}

export async function getBonusBalance(userId: string): Promise<bigint> {
  return await getBalanceTx(db as unknown as TxClient, userId);
}

export interface BonusEventInput {
  type: BonusEventType;
  userId: string | null;
  amount?: bigint;
  ip?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordBonusEvent(input: BonusEventInput): Promise<void> {
  try {
    await db.insert(bonusEventsTable).values({
      type: input.type,
      userId: input.userId,
      amount: input.amount ?? 0n,
      ip: input.ip ?? null,
      metadata: (input.metadata ?? null) as object | null,
    });
    bus.publish({
      topic: "admin:bonus-events",
      type: "bump",
      eventType: input.type,
      userId: input.userId,
      amount: (input.amount ?? 0n).toString(),
      ts: Date.now(),
    });
    // Notify the admin panel that aggregate metrics changed so it can
    // refetch analytics without polling.
    bus.publish({
      topic: "admin:bonus-metrics",
      type: "bump",
      reason: input.type,
      ts: Date.now(),
    });
  } catch (err) {
    logger.warn({ err, input }, "Failed to record bonus event");
  }
}

/**
 * Maximum signed BIGINT value Postgres can store. `bonus_wagering.total_issued`,
 * `required_wager`, `bonus_ledger.amount` and `balance_after` are all bigint
 * columns; any operation that would push them past this ceiling will be
 * rejected by the database with `value "..." is out of range for type bigint`.
 *
 * We check projected values up front so the credit path can fail fast with a
 * typed error (`BonusCreditOverflowError`) instead of relying on Postgres to
 * throw mid-transaction. This keeps logs clean and avoids a wasted round-trip
 * for an already-doomed write.
 */
export const BONUS_BIGINT_CEILING = 9223372036854775807n;

export class BonusCreditOverflowError extends Error {
  readonly code = "BONUS_CREDIT_OVERFLOW";
  readonly field: "balance" | "total_issued" | "required_wager";
  readonly projected: bigint;
  constructor(
    field: "balance" | "total_issued" | "required_wager",
    projected: bigint,
  ) {
    super(`BONUS_CREDIT_OVERFLOW: ${field} would exceed bigint ceiling`);
    this.field = field;
    this.projected = projected;
  }
}

interface CreditInput {
  userId: string;
  type: BonusLedgerType;
  amount: bigint;
  refType?: string | null;
  refId?: string | null;
  memo?: string | null;
  metadata?: Record<string, unknown> | null;
  createdBy?: string | null;
  countTowardsIssued?: boolean;
}

interface CreditResult {
  ledgerId: string;
  balance: bigint;
  alreadyApplied: boolean;
}

export async function creditBonus(
  input: CreditInput,
): Promise<CreditResult> {
  if (input.amount <= 0n) throw new Error("INVALID_AMOUNT");
  const result = await db.transaction(async (tx) => {
    await lockBonusUser(tx, input.userId);
    // Idempotency check for credit types using the partial unique index keys.
    if (
      input.refType &&
      input.refId &&
      ["signup", "deposit_tier", "referral"].includes(input.type)
    ) {
      const existing = await tx
        .select({
          id: bonusLedgerTable.id,
          balanceAfter: bonusLedgerTable.balanceAfter,
        })
        .from(bonusLedgerTable)
        .where(
          and(
            eq(bonusLedgerTable.refType, input.refType),
            eq(bonusLedgerTable.refId, input.refId),
            eq(bonusLedgerTable.type, input.type),
          ),
        )
        .limit(1);
      if (existing[0]) {
        return {
          ledgerId: existing[0].id,
          balance: existing[0].balanceAfter,
          alreadyApplied: true,
        };
      }
    }
    const current = await getBalanceTx(tx, input.userId);
    const next = current + input.amount;
    if (next > BONUS_BIGINT_CEILING) {
      throw new BonusCreditOverflowError("balance", next);
    }
    if (input.countTowardsIssued !== false) {
      // Pre-flight bigint ceiling check on bonus_wagering counters so we
      // surface a typed error instead of a generic Postgres "value out of
      // range" mid-transaction.
      const wagerRows = await tx
        .select({
          totalIssued: bonusWageringTable.totalIssued,
          requiredWager: bonusWageringTable.requiredWager,
        })
        .from(bonusWageringTable)
        .where(eq(bonusWageringTable.userId, input.userId))
        .limit(1);
      const settings = await tx
        .select()
        .from(promotionSettingsTable)
        .where(eq(promotionSettingsTable.id, SETTINGS_ID))
        .limit(1);
      const wager = settings[0]?.wageringMultiplier ?? 1;
      const requiredAdd = input.amount * BigInt(wager);
      const projectedIssued = (wagerRows[0]?.totalIssued ?? 0n) + input.amount;
      const projectedRequired =
        (wagerRows[0]?.requiredWager ?? 0n) + requiredAdd;
      if (projectedIssued > BONUS_BIGINT_CEILING) {
        throw new BonusCreditOverflowError("total_issued", projectedIssued);
      }
      if (projectedRequired > BONUS_BIGINT_CEILING) {
        throw new BonusCreditOverflowError("required_wager", projectedRequired);
      }
      const [entry] = await tx
        .insert(bonusLedgerTable)
        .values({
          userId: input.userId,
          type: input.type,
          amount: input.amount,
          balanceAfter: next,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          memo: input.memo ?? null,
          metadata: (input.metadata ?? null) as object | null,
          createdBy: input.createdBy ?? null,
        })
        .returning();
      await tx
        .insert(bonusWageringTable)
        .values({
          userId: input.userId,
          totalIssued: input.amount,
          requiredWager: requiredAdd,
          wageredSoFar: 0n,
        })
        .onConflictDoUpdate({
          target: bonusWageringTable.userId,
          set: {
            totalIssued: sql`${bonusWageringTable.totalIssued} + ${input.amount}`,
            requiredWager: sql`${bonusWageringTable.requiredWager} + ${requiredAdd}`,
            updatedAt: new Date(),
          },
        });
      return { ledgerId: entry!.id, balance: next, alreadyApplied: false };
    }
    const [entry] = await tx
      .insert(bonusLedgerTable)
      .values({
        userId: input.userId,
        type: input.type,
        amount: input.amount,
        balanceAfter: next,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        memo: input.memo ?? null,
        metadata: (input.metadata ?? null) as object | null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return { ledgerId: entry!.id, balance: next, alreadyApplied: false };
  });
  if (!result.alreadyApplied) {
    publishBonusBalance(input.userId, result.balance, input.type, input.amount);
  }
  return result;
}

export function publishBonusBalance(
  userId: string,
  balance: bigint,
  entryType: BonusLedgerType,
  amount: bigint,
): void {
  try {
    bus.publish({
      topic: `bonus:${userId}`,
      type: "balance",
      balance: balance.toString(),
      entryType,
      amount: amount.toString(),
      ts: Date.now(),
    });
  } catch {
    /* ignore */
  }
}

export interface DebitForBetInput {
  userId: string;
  amount: bigint;
  betId: string;
  gameCode: string;
}

export async function debitForBet(input: DebitForBetInput): Promise<bigint> {
  if (input.amount <= 0n) throw new Error("INVALID_AMOUNT");
  if (!isBonusEligibleGame(input.gameCode)) {
    throw new Error("BONUS_NOT_ALLOWED_FOR_GAME");
  }
  const result = await db.transaction(async (tx) => {
    await lockBonusUser(tx, input.userId);
    const current = await getBalanceTx(tx, input.userId);
    if (current < input.amount) throw new Error("INSUFFICIENT_BONUS_FUNDS");
    const next = current - input.amount;
    const [entry] = await tx
      .insert(bonusLedgerTable)
      .values({
        userId: input.userId,
        type: "bet",
        amount: -input.amount,
        balanceAfter: next,
        refType: "bet",
        refId: input.betId,
        memo: `Bonus bet on ${input.gameCode}`,
      })
      .returning();
    // Track wagering progress
    await tx
      .insert(bonusWageringTable)
      .values({
        userId: input.userId,
        totalIssued: 0n,
        requiredWager: 0n,
        wageredSoFar: input.amount,
      })
      .onConflictDoUpdate({
        target: bonusWageringTable.userId,
        set: {
          wageredSoFar: sql`${bonusWageringTable.wageredSoFar} + ${input.amount}`,
          updatedAt: new Date(),
        },
      });
    return { entryId: entry!.id, next };
  });
  publishBonusBalance(input.userId, result.next, "bet", -input.amount);
  recordBonusEvent({
    type: "bonus_bet_placed",
    userId: input.userId,
    amount: input.amount,
    metadata: { betId: input.betId, gameCode: input.gameCode },
  }).catch(() => {});
  return result.next;
}

export interface CreditForWinInput {
  userId: string;
  amount: bigint;
  betId: string;
  gameCode: string;
}

export async function creditForWin(input: CreditForWinInput): Promise<bigint> {
  if (input.amount <= 0n) return await getBonusBalance(input.userId);
  const result = await db.transaction(async (tx) => {
    await lockBonusUser(tx, input.userId);
    const current = await getBalanceTx(tx, input.userId);
    const next = current + input.amount;
    await tx.insert(bonusLedgerTable).values({
      userId: input.userId,
      type: "win",
      amount: input.amount,
      balanceAfter: next,
      refType: "bet",
      refId: input.betId,
      memo: `Bonus win on ${input.gameCode}`,
    });
    return next;
  });
  publishBonusBalance(input.userId, result, "win", input.amount);
  recordBonusEvent({
    type: "bonus_win_credited",
    userId: input.userId,
    amount: input.amount,
    metadata: { betId: input.betId, gameCode: input.gameCode },
  }).catch(() => {});
  return result;
}

export interface RefundForBetInput {
  userId: string;
  amount: bigint;
  betId: string;
}

export async function refundForBet(input: RefundForBetInput): Promise<bigint> {
  if (input.amount <= 0n) return await getBonusBalance(input.userId);
  const result = await db.transaction(async (tx) => {
    await lockBonusUser(tx, input.userId);
    const current = await getBalanceTx(tx, input.userId);
    const next = current + input.amount;
    await tx.insert(bonusLedgerTable).values({
      userId: input.userId,
      type: "win",
      amount: input.amount,
      balanceAfter: next,
      refType: "refund",
      refId: input.betId,
      memo: `Bonus bet refund`,
    });
    // Reverse the wagering credit recorded at debit time
    await tx
      .update(bonusWageringTable)
      .set({
        wageredSoFar: sql`GREATEST(0, ${bonusWageringTable.wageredSoFar} - ${input.amount})`,
        updatedAt: new Date(),
      })
      .where(eq(bonusWageringTable.userId, input.userId));
    return next;
  });
  publishBonusBalance(input.userId, result, "win", input.amount);
  return result;
}

export interface WageringStatus {
  totalIssued: string;
  requiredWager: string;
  wageredSoFar: string;
  remaining: string;
  complete: boolean;
}

export async function getWageringStatus(
  userId: string,
): Promise<WageringStatus> {
  const rows = await db
    .select()
    .from(bonusWageringTable)
    .where(eq(bonusWageringTable.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return {
      totalIssued: "0",
      requiredWager: "0",
      wageredSoFar: "0",
      remaining: "0",
      complete: true,
    };
  }
  const remaining =
    row.requiredWager > row.wageredSoFar
      ? row.requiredWager - row.wageredSoFar
      : 0n;
  return {
    totalIssued: row.totalIssued.toString(),
    requiredWager: row.requiredWager.toString(),
    wageredSoFar: row.wageredSoFar.toString(),
    remaining: remaining.toString(),
    complete: remaining === 0n && row.totalIssued > 0n,
  };
}

/**
 * If the user has met their wagering requirement and has a positive bonus
 * balance, convert the remaining bonus to cash via the cash wallet. Idempotent:
 * resets wagering tracker after conversion.
 *
 * The bonus debit AND the cash credit happen in the SAME database
 * transaction. If the cash credit fails (e.g. INSUFFICIENT_FUNDS guard
 * tripped, deadlock, etc.) the bonus debit rolls back and funds remain
 * intact. The caller's `postEntryToCash` MUST honour the supplied `tx`
 * so this atomicity guarantee holds.
 */
export async function convertBonusToCashIfReady(
  userId: string,
  postEntryToCash: (
    input: {
      userId: string;
      type: "bonus";
      amount: bigint;
      refType: string;
      refId: string;
      memo: string;
    },
    tx: TxClient,
  ) => Promise<void>,
): Promise<{ converted: bigint } | null> {
  // Cheap pre-check to avoid acquiring a write lock when nothing to do.
  const preStatus = await getWageringStatus(userId);
  if (!preStatus.complete) return null;
  const preBalance = await getBonusBalance(userId);
  if (preBalance <= 0n) return null;
  // Single transaction: bonus debit + cash credit + wagering reset.
  // Re-evaluate completion + balance INSIDE the lock so a concurrent
  // bonus issuance (which raises requiredWager) cannot let a stale
  // pre-check sneak through and convert prematurely.
  const refId = `${userId}_${Date.now()}`;
  let convertedAmount = 0n;
  await db.transaction(async (tx) => {
    await lockBonusUser(tx, userId);
    const wageringRows = await tx
      .select()
      .from(bonusWageringTable)
      .where(eq(bonusWageringTable.userId, userId))
      .limit(1);
    const w = wageringRows[0];
    const stillComplete =
      !!w &&
      w.totalIssued > 0n &&
      w.wageredSoFar >= w.requiredWager;
    if (!stillComplete) return; // Race: requirement raised under us.
    const current = await getBalanceTx(tx, userId);
    if (current <= 0n) return; // Race: someone already converted.
    convertedAmount = current;
    const next = 0n;
    await tx.insert(bonusLedgerTable).values({
      userId,
      type: "conversion_out",
      amount: -current,
      balanceAfter: next,
      refType: "conversion",
      refId,
      memo: `Bonus → Cash conversion`,
    });
    // Cash credit MUST be inside the same tx. If this throws the whole
    // conversion (including the bonus debit above) rolls back atomically.
    await postEntryToCash(
      {
        userId,
        type: "bonus",
        amount: current,
        refType: "bonus_conversion",
        refId,
        memo: `Bonus wagering met — credited to cash`,
      },
      tx,
    );
    // Reset wagering tracker
    await tx
      .update(bonusWageringTable)
      .set({
        totalIssued: 0n,
        requiredWager: 0n,
        wageredSoFar: 0n,
        lastConvertedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bonusWageringTable.userId, userId));
  });
  if (convertedAmount <= 0n) return null;
  publishBonusBalance(userId, 0n, "conversion_out", -convertedAmount);
  recordBonusEvent({
    type: "bonus_converted_to_cash",
    userId,
    amount: convertedAmount,
    metadata: { refId },
  }).catch(() => {});
  return { converted: convertedAmount };
}

export interface RevokeInput {
  userId: string;
  reason: string;
  actorId: string;
}

export async function revokeBonus(input: RevokeInput): Promise<bigint> {
  const result = await db.transaction(async (tx) => {
    await lockBonusUser(tx, input.userId);
    const current = await getBalanceTx(tx, input.userId);
    if (current <= 0n) return 0n;
    await tx.insert(bonusLedgerTable).values({
      userId: input.userId,
      type: "revoke",
      amount: -current,
      balanceAfter: 0n,
      refType: "revoke",
      refId: input.actorId,
      memo: input.reason,
      createdBy: input.actorId,
    });
    await tx
      .update(bonusWageringTable)
      .set({
        totalIssued: 0n,
        requiredWager: 0n,
        wageredSoFar: 0n,
        updatedAt: new Date(),
      })
      .where(eq(bonusWageringTable.userId, input.userId));
    return current;
  });
  if (result > 0n) {
    publishBonusBalance(input.userId, 0n, "revoke", -result);
    await recordBonusEvent({
      type: "bonus_revoked",
      userId: input.userId,
      amount: result,
      metadata: { reason: input.reason, actorId: input.actorId },
    });
  }
  return result;
}

export interface ListLedgerInput {
  userId: string;
  limit: number;
  cursor?: string | null;
}

function encodeCursor(d: Date, id: string): string {
  return Buffer.from(`${d.toISOString()}|${id}`).toString("base64url");
}
function decodeCursor(c: string): { d: Date; id: string } | null {
  try {
    const raw = Buffer.from(c, "base64url").toString("utf8");
    const sep = raw.indexOf("|");
    if (sep < 0) return null;
    const d = new Date(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (Number.isNaN(d.getTime()) || !id) return null;
    return { d, id };
  } catch {
    return null;
  }
}

export async function listLedger(input: ListLedgerInput) {
  const conds = [eq(bonusLedgerTable.userId, input.userId)];
  if (input.cursor) {
    const dc = decodeCursor(input.cursor);
    if (dc) {
      conds.push(
        or(
          lt(bonusLedgerTable.createdAt, dc.d),
          and(
            eq(bonusLedgerTable.createdAt, dc.d),
            lt(bonusLedgerTable.id, dc.id),
          ),
        )!,
      );
    }
  }
  const rows = await db
    .select()
    .from(bonusLedgerTable)
    .where(and(...conds))
    .orderBy(desc(bonusLedgerTable.createdAt), desc(bonusLedgerTable.id))
    .limit(input.limit + 1);
  const entries = rows.slice(0, input.limit);
  const last = entries[entries.length - 1];
  const nextCursor =
    rows.length > input.limit && last
      ? encodeCursor(last.createdAt, last.id)
      : null;
  return { entries, nextCursor };
}
