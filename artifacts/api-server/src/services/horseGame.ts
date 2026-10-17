import { db, betsTable, gameRoundsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  postEntry,
  publishWalletBalance,
  getBalanceByUser,
  type TxClient,
} from "./wallet";
import { generateSeed, requireGameConfig, sha256Hex } from "./rtp";
import {
  RACING_HORSES,
  RACING_VENUES,
  makeHorsePlan,
  horseOdds,
  type HorseSlip,
  type RacingReceipt,
} from "@workspace/api-zod/horse-racing-game";
import { badRequest, conflict } from "../lib/errors";

const code = "horse-racing";
interface RaceData {
  version: 2;
  requestId: string;
  fingerprint: string;
  plan: ReturnType<typeof makeHorsePlan>;
  startedAt: number;
  endsAt: number;
  bets: HorseSlip[];
  payout: string;
}
const isRace = (value: unknown): value is RaceData =>
  !!value &&
  typeof value === "object" &&
  (value as RaceData).version === 2 &&
  !!(value as RaceData).plan;
type Row = typeof betsTable.$inferSelect;
async function lock(tx: TxClient, userId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`horse-game:${userId}`}))`,
  );
}
function receipt(bet: Row): RacingReceipt {
  const m = bet.metadata as RaceData,
    finished = bet.status !== "placed";
  return {
    id: bet.id,
    requestId: m.requestId,
    venueId: m.plan.venueId,
    startedAt: m.startedAt,
    endsAt: m.endsAt,
    status: finished ? "finished" : "racing",
    plan: m.plan,
    bets: m.bets,
    totalStake: bet.stakeAmount.toString(),
    payoutAmount: finished ? bet.payoutAmount.toString() : "0",
    winnerId: finished ? m.plan.order[0] : null,
  };
}
export function validateHorseSlip(bets: HorseSlip[], min: bigint, max: bigint) {
  if (!Array.isArray(bets) || bets.length < 1 || bets.length > 8)
    throw badRequest("Choose at least one horse.");
  const ids = new Set<number>();
  let total = 0n;
  for (const bet of bets) {
    if (
      !RACING_HORSES.some((h) => h.id === bet.horseId) ||
      ids.has(bet.horseId)
    )
      throw badRequest("Invalid or duplicate horse.");
    if (!/^\d{1,18}$/.test(bet.amountPaise)) throw badRequest("Invalid stake.");
    const amount = BigInt(bet.amountPaise);
    if (amount < 100n || amount % 100n !== 0n)
      throw badRequest("Use whole rupee coins.");
    total += amount;
    ids.add(bet.horseId);
  }
  if (total < min || total > max)
    throw badRequest("Stake is outside the table limits.");
  return total;
}
async function settleDue(tx: TxClient, bet: Row, now: number) {
  const m = bet.metadata;
  if (!isRace(m) || bet.status !== "placed" || now < m.endsAt) return bet;
  const payout = BigInt(m.payout);
  if (payout > 0n)
    await postEntry(
      {
        userId: bet.userId,
        scope: code,
        type: "win",
        amount: payout,
        refType: "bet",
        refId: bet.id,
        memo: "Horse Racing winnings",
      },
      tx,
    );
  const [settled] = await tx
    .update(betsTable)
    .set({
      status: payout > 0n ? "won" : "lost",
      payoutAmount: payout,
      multiplier: Number(payout) / Number(bet.stakeAmount),
      settledAt: new Date(now),
    })
    .where(eq(betsTable.id, bet.id))
    .returning();
  await tx
    .update(gameRoundsTable)
    .set({ totalPayout: payout, crashPoint: m.plan.order[0] })
    .where(eq(gameRoundsTable.id, bet.roundId!));
  return settled;
}
export async function horseGameConfig() {
  const cfg = await requireGameConfig(code);
  return {
    enabled: cfg.enabled,
    minStakePaise: (cfg.minStakePaise > 100n
      ? cfg.minStakePaise
      : 100n
    ).toString(),
    maxStakePaise: cfg.maxStakePaise.toString(),
    horses: RACING_HORSES.map((h) => ({
      id: h.id,
      multiplier: horseOdds(h.probability, cfg.houseEdge, cfg.maxMultiplier),
    })),
  };
}
export async function horseGameState(userId: string, now = Date.now()) {
  let changed = false;
  const races = await db.transaction(async (tx) => {
    await lock(tx, userId);
    const rows = await tx
      .select()
      .from(betsTable)
      .where(
        and(
          eq(betsTable.userId, userId),
          eq(betsTable.gameCode, code),
          sql`${betsTable.metadata}->>'version' = '2'`,
        ),
      )
      .orderBy(desc(betsTable.placedAt))
      .limit(20);
    const out: RacingReceipt[] = [];
    for (const row of rows) {
      const next = await settleDue(tx, row, now);
      if (next.status !== row.status) changed = true;
      out.push(receipt(next));
    }
    return out;
  });
  const wallet = await getBalanceByUser(userId);
  if (changed)
    publishWalletBalance({
      userId,
      balance: wallet.balance,
      entryType: "win",
      amount: 0n,
    });
  return {
    serverNow: now,
    balance: wallet.balance.toString(),
    race: races[0] ?? null,
    history: races.filter((r) => r.status === "finished"),
  };
}
export async function startHorseGame(
  userId: string,
  input: { requestId: string; venueId: string; bets: HorseSlip[] },
  now = Date.now(),
) {
  const cfg = await requireGameConfig(code);
  if (!cfg.enabled)
    throw badRequest("Horse Racing is temporarily unavailable.");
  if (!RACING_VENUES.some((v) => v.id === input.venueId))
    throw badRequest("Unknown racecourse.");
  const total = validateHorseSlip(
    input.bets,
    cfg.minStakePaise > 100n ? cfg.minStakePaise : 100n,
    cfg.maxStakePaise,
  );
  const slip = input.bets
    .map((b) => ({ ...b, amountPaise: BigInt(b.amountPaise).toString() }))
    .sort((a, b) => a.horseId - b.horseId);
  const fingerprint = sha256Hex(
    JSON.stringify({ venueId: input.venueId, bets: slip }),
  );
  let posted = false,
    credited = false;
  const race = await db.transaction(async (tx) => {
    await lock(tx, userId);
    const [prior] = await tx
      .select()
      .from(betsTable)
      .where(
        and(
          eq(betsTable.userId, userId),
          eq(betsTable.gameCode, code),
          sql`${betsTable.metadata}->>'requestId' = ${input.requestId}`,
        ),
      )
      .limit(1);
    if (prior && isRace(prior.metadata)) {
      if (prior.metadata.fingerprint !== fingerprint)
        throw conflict("This request was already used for a different bet.");
      const next = await settleDue(tx, prior, now);
      credited = next.status !== prior.status;
      return receipt(next);
    }
    const active = await tx
      .select()
      .from(betsTable)
      .where(
        and(
          eq(betsTable.userId, userId),
          eq(betsTable.gameCode, code),
          eq(betsTable.status, "placed"),
          sql`${betsTable.metadata}->>'version' = '2'`,
        ),
      );
    for (const row of active) {
      if (now < (row.metadata as RaceData).endsAt)
        throw conflict("Your current race is still running.");
      await settleDue(tx, row, now);
      credited = true;
    }
    const seed = generateSeed(),
      plan = makeHorsePlan(seed, input.venueId),
      winner = RACING_HORSES[plan.order[0] - 1];
    const hundredths = Math.round(
      horseOdds(winner.probability, cfg.houseEdge, cfg.maxMultiplier) * 100,
    );
    const payout = slip
      .filter((b) => b.horseId === winner.id)
      .reduce(
        (sum, b) => sum + (BigInt(b.amountPaise) * BigInt(hundredths)) / 100n,
        0n,
      );
    const [round] = await tx
      .insert(gameRoundsTable)
      .values({
        gameCode: code,
        serverSeed: seed,
        serverSeedHash: sha256Hex(seed),
        clientSeed: input.requestId,
        nonce: 0,
        crashPoint: 0,
        houseEdge: cfg.houseEdge,
        maxMultiplier: cfg.maxMultiplier,
        totalStake: total,
        playerCount: 1,
      })
      .returning();
    const metadata: RaceData = {
      version: 2,
      requestId: input.requestId,
      fingerprint,
      plan,
      startedAt: now + 3000,
      endsAt: now + 3000 + Math.ceil(plan.duration * 1000),
      bets: slip,
      payout: payout.toString(),
    };
    const [bet] = await tx
      .insert(betsTable)
      .values({
        userId,
        gameCode: code,
        roundId: round.id,
        stakeAmount: total,
        status: "placed",
        metadata,
      })
      .returning();
    try {
      await postEntry(
        {
          userId,
          scope: code,
          type: "bet",
          amount: -total,
          refType: "bet",
          refId: bet.id,
          memo: "Horse Racing stake",
        },
        tx,
      );
    } catch (e) {
      if ((e as Error).message === "INSUFFICIENT_FUNDS")
        throw badRequest("Insufficient wallet balance.");
      throw e;
    }
    posted = true;
    return receipt(bet);
  });
  const wallet = await getBalanceByUser(userId);
  if (posted || credited)
    publishWalletBalance({
      userId,
      balance: wallet.balance,
      entryType: posted ? "bet" : "win",
      amount: posted ? -total : 0n,
    });
  return { serverNow: now, balance: wallet.balance.toString(), race };
}
/** Settlement survives navigation, lost responses and API restarts. */
export function startHorseGameEngine() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const due = await db
        .select({ userId: betsTable.userId })
        .from(betsTable)
        .where(
          and(
            eq(betsTable.gameCode, code),
            eq(betsTable.status, "placed"),
            sql`${betsTable.metadata}->>'version' = '2'`,
            sql`(${betsTable.metadata}->>'endsAt')::bigint <= ${Date.now()}`,
          ),
        )
        .limit(100);
      for (const id of new Set(due.map((r) => r.userId)))
        await horseGameState(id);
    } catch (e) {
      console.error("[horse-game] settlement", e);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 1000);
  timer.unref();
  return () => clearInterval(timer);
}
