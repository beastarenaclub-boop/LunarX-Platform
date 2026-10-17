import {
  db,
  freeBetGrantsTable,
  rainEventsTable,
  rainClaimsTable,
  type FreeBetGrant,
  type RainEvent,
} from "@workspace/db";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { bus } from "../realtime/eventBus";
import { logger } from "../lib/logger";

export interface GrantFreeBetsInput {
  userId: string;
  gameCode?: string;
  amountPaise: bigint;
  count: number;
  source?: "admin" | "rain";
  grantedBy?: string | null;
  expiresAt?: Date | null;
}

export async function grantFreeBets(input: GrantFreeBetsInput): Promise<FreeBetGrant> {
  if (input.amountPaise <= 0n) throw new Error("INVALID_AMOUNT");
  if (input.count <= 0 || input.count > 1000) throw new Error("INVALID_COUNT");
  const [grant] = await db
    .insert(freeBetGrantsTable)
    .values({
      userId: input.userId,
      gameCode: input.gameCode ?? "lunar",
      amountPaise: input.amountPaise,
      totalCount: input.count,
      remainingCount: input.count,
      source: input.source ?? "admin",
      grantedBy: input.grantedBy ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  publishFreeBetsChanged(input.userId);
  return grant!;
}

function activeGrantConds(userId: string, gameCode: string) {
  return and(
    eq(freeBetGrantsTable.userId, userId),
    eq(freeBetGrantsTable.gameCode, gameCode),
    gt(freeBetGrantsTable.remainingCount, 0),
    or(
      isNull(freeBetGrantsTable.expiresAt),
      gt(freeBetGrantsTable.expiresAt, new Date()),
    ),
  );
}

export async function listActiveGrants(
  userId: string,
  gameCode = "lunar",
): Promise<FreeBetGrant[]> {
  return db
    .select()
    .from(freeBetGrantsTable)
    .where(activeGrantConds(userId, gameCode))
    .orderBy(freeBetGrantsTable.createdAt);
}

/**
 * Atomically consume one free bet from the user's oldest active grant.
 * Returns the grant the bet was consumed from (with the stake amount to
 * use), or null if the user has no active free bets. The conditional
 * UPDATE ... WHERE remaining_count > 0 makes double-spends impossible even
 * under concurrent placements.
 */
export async function consumeFreeBet(
  userId: string,
  gameCode = "lunar",
): Promise<FreeBetGrant | null> {
  // Try oldest-first; loop a few times in case of races on the same grant.
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidates = await db
      .select()
      .from(freeBetGrantsTable)
      .where(activeGrantConds(userId, gameCode))
      .orderBy(freeBetGrantsTable.createdAt)
      .limit(1);
    const grant = candidates[0];
    if (!grant) return null;
    const [updated] = await db
      .update(freeBetGrantsTable)
      .set({ remainingCount: sql`${freeBetGrantsTable.remainingCount} - 1` })
      .where(
        and(
          eq(freeBetGrantsTable.id, grant.id),
          gt(freeBetGrantsTable.remainingCount, 0),
        ),
      )
      .returning();
    if (updated) {
      publishFreeBetsChanged(userId);
      return updated;
    }
    // Lost the race — re-select and try again.
  }
  return null;
}

/** Refund one free bet back to a grant (used when placement fails downstream). */
export async function refundFreeBet(grantId: string, userId: string): Promise<void> {
  await db
    .update(freeBetGrantsTable)
    .set({ remainingCount: sql`${freeBetGrantsTable.remainingCount} + 1` })
    .where(eq(freeBetGrantsTable.id, grantId));
  publishFreeBetsChanged(userId);
}

export async function freeBetsSummary(userId: string, gameCode = "lunar") {
  const grants = await listActiveGrants(userId, gameCode);
  let count = 0;
  for (const g of grants) count += g.remainingCount;
  // The stake of the next free bet = oldest grant's amount.
  const nextAmount = grants[0]?.amountPaise ?? 0n;
  return { count, nextAmountPaise: nextAmount, grants };
}

function publishFreeBetsChanged(userId: string) {
  bus.publish({
    topic: `free-bets:${userId}`,
    type: "changed",
    ts: Date.now(),
  });
}

// ---- Rain ------------------------------------------------------------------

export interface CreateRainInput {
  gameCode?: string;
  amountPaise: bigint;
  betsPerClaim?: number;
  maxClaims: number;
  message?: string | null;
  createdBy?: string | null;
  ttlMs?: number;
}

export async function createRainEvent(input: CreateRainInput): Promise<RainEvent> {
  if (input.amountPaise <= 0n) throw new Error("INVALID_AMOUNT");
  if (input.maxClaims <= 0 || input.maxClaims > 500) throw new Error("INVALID_MAX_CLAIMS");
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? 120_000));
  const [rain] = await db
    .insert(rainEventsTable)
    .values({
      gameCode: input.gameCode ?? "lunar",
      amountPaise: input.amountPaise,
      betsPerClaim: input.betsPerClaim ?? 1,
      maxClaims: input.maxClaims,
      message: input.message ?? null,
      createdBy: input.createdBy ?? null,
      expiresAt,
    })
    .returning();
  bus.publish({
    topic: "rain:lunar",
    type: "drop",
    id: rain!.id,
    gameCode: rain!.gameCode,
    amountPaise: rain!.amountPaise.toString(),
    betsPerClaim: rain!.betsPerClaim,
    maxClaims: rain!.maxClaims,
    claimedCount: 0,
    message: rain!.message,
    expiresAt: rain!.expiresAt.toISOString(),
    ts: Date.now(),
  });
  logger.info(
    { rainId: rain!.id, amount: rain!.amountPaise.toString(), maxClaims: rain!.maxClaims },
    "rain event created",
  );
  return rain!;
}

export async function activeRain(gameCode = "lunar"): Promise<RainEvent | null> {
  const rows = await db
    .select()
    .from(rainEventsTable)
    .where(
      and(
        eq(rainEventsTable.gameCode, gameCode),
        gt(rainEventsTable.expiresAt, new Date()),
        sql`${rainEventsTable.claimedCount} < ${rainEventsTable.maxClaims}`,
      ),
    )
    .orderBy(desc(rainEventsTable.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Claim a rain drop. First-come-first-served: the conditional UPDATE on
 * claimed_count < max_claims guarantees at most maxClaims winners, and the
 * unique (rain_id, user_id) index guarantees one claim per player.
 */
export async function claimRain(
  rainId: string,
  userId: string,
): Promise<{ grant: FreeBetGrant; rain: RainEvent }> {
  const rows = await db
    .select()
    .from(rainEventsTable)
    .where(eq(rainEventsTable.id, rainId))
    .limit(1);
  const rain = rows[0];
  if (!rain) throw new Error("RAIN_NOT_FOUND");
  if (rain.expiresAt.getTime() <= Date.now()) throw new Error("RAIN_EXPIRED");

  // All-or-nothing: claim reservation, slot count, and the grant are one
  // transaction so a mid-flight failure can never consume a claim slot (or
  // the player's one-claim-per-rain right) without delivering the grant.
  let claimUniqueViolation = false;
  let fullyClaimed = false;
  let grant: FreeBetGrant;
  let updated: RainEvent;
  try {
    const result = await db.transaction(async (tx) => {
      // Reserve the claim row first — unique index rejects double claims.
      // A violation aborts the whole transaction, rolling everything back.
      await tx.insert(rainClaimsTable).values({ rainId, userId });

      const [u] = await tx
        .update(rainEventsTable)
        .set({ claimedCount: sql`${rainEventsTable.claimedCount} + 1` })
        .where(
          and(
            eq(rainEventsTable.id, rainId),
            sql`${rainEventsTable.claimedCount} < ${rainEventsTable.maxClaims}`,
          ),
        )
        .returning();
      if (!u) {
        fullyClaimed = true;
        throw new Error("RAIN_FULLY_CLAIMED");
      }

      const [g] = await tx
        .insert(freeBetGrantsTable)
        .values({
          userId,
          gameCode: rain.gameCode,
          amountPaise: rain.amountPaise,
          totalCount: rain.betsPerClaim,
          remainingCount: rain.betsPerClaim,
          source: "rain",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning();
      await tx
        .update(rainClaimsTable)
        .set({ grantId: g!.id })
        .where(
          and(eq(rainClaimsTable.rainId, rainId), eq(rainClaimsTable.userId, userId)),
        );
      return { grant: g!, updated: u };
    });
    grant = result.grant;
    updated = result.updated;
  } catch (err) {
    if (fullyClaimed) throw new Error("RAIN_FULLY_CLAIMED");
    const code = (err as { code?: string })?.code;
    claimUniqueViolation =
      code === "23505" || /duplicate key|unique/i.test((err as Error)?.message ?? "");
    if (claimUniqueViolation) throw new Error("RAIN_ALREADY_CLAIMED");
    throw err;
  }

  publishFreeBetsChanged(userId);
  bus.publish({
    topic: "rain:lunar",
    type: "claimed",
    id: rain.id,
    gameCode: rain.gameCode,
    claimedCount: updated.claimedCount,
    maxClaims: rain.maxClaims,
    ts: Date.now(),
  });
  return { grant, rain: updated };
}

export async function listGrantsAdmin(input: {
  userId?: string | null;
  limit: number;
}) {
  const conds = input.userId ? [eq(freeBetGrantsTable.userId, input.userId)] : [];
  return db
    .select()
    .from(freeBetGrantsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(freeBetGrantsTable.createdAt))
    .limit(input.limit);
}
