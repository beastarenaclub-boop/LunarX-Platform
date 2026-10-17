import {
  db,
  betsTable,
  tableRoundsTable,
  type TableRound,
} from "@workspace/db";
import { and, asc, desc, eq, lte, ne, sql } from "drizzle-orm";
import { bikeGameConfig, validateBikeSlip, makeBikePlan } from "./bikeGame";
import { generateSeed, sha256Hex } from "./rtp";
import { badRequest, conflict } from "../lib/errors";
import {
  getBalanceByUser,
  postEntry,
  publishWalletBalance,
  type TxClient,
} from "./wallet";
import {
  RACING_VENUES,
  bikeRoundSchedule,
  bikeRoundPhase,
  type RacingConfig,
  type RacingLiveRound,
  type RacingLiveState,
  type RacingBetReceipt,
  type BikeSlip,
} from "@workspace/api-zod/bike-racing-game";

const code = "bike-racing";
type Clock = () => number;
type BetRow = typeof betsTable.$inferSelect;
interface LiveMetadata {
  version: 1;
  requestId: string;
  fingerprint: string;
  venueId: string;
  startedAt: number;
  endsAt: number;
  bets: BikeSlip[];
  winnerId?: number;
}
const roundLock = (tx: TxClient, id: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`bike-live-round:${id}`}))`,
  );
function requireVenue(venueId: string) {
  if (!RACING_VENUES.some((v) => v.id === venueId))
    throw badRequest("Unknown racecourse.");
}
function receipt(row: BetRow): RacingBetReceipt {
  const m = row.metadata as LiveMetadata;
  const finished = row.status !== "placed";
  return {
    id: row.id,
    roundId: row.roundId!,
    requestId: m.requestId,
    venueId: m.venueId,
    startedAt: m.startedAt,
    endsAt: m.endsAt,
    status: finished ? "finished" : "placed",
    bets: m.bets,
    totalStake: row.stakeAmount.toString(),
    payoutAmount: finished ? row.payoutAmount.toString() : "0",
    winnerId: finished ? (m.winnerId ?? null) : null,
  };
}
export function publicBikeRound(
  row: TableRound,
  now: number,
): RacingLiveRound {
  const schedule = {
    id: row.id,
    venueId: row.clientSeed,
    bettingOpensAt: row.createdAt.getTime(),
    startedAt: row.bettingEndsAt.getTime(),
    endsAt: row.revealEndsAt.getTime(),
    nextRoundAt: row.settleEndsAt.getTime(),
  };
  const phase = bikeRoundPhase(schedule, now);
  const plan =
    phase === "betting"
      ? null
      : makeBikePlan(row.serverSeed);
  const { version: _version, ...config } = row.config as RacingConfig & {
    version: number;
  };
  return {
    ...schedule,
    id: row.id,
    phase,
    serverSeedHash: row.serverSeedHash,
    plan,
    winnerId: phase === "results" ? plan!.order[0] : null,
    config,
  };
}
export async function ensureBikeLiveRound(venueId: string, now = Date.now()) {
  requireVenue(venueId);
  const schedule = bikeRoundSchedule(venueId, now);
  const [existing] = await db
    .select()
    .from(tableRoundsTable)
    .where(eq(tableRoundsTable.id, schedule.id));
  if (existing) return existing;
  const config = await bikeGameConfig();
  const seed = generateSeed();
  await db
    .insert(tableRoundsTable)
    .values({
      id: schedule.id,
      gameCode: code,
      phase: "betting",
      serverSeed: seed,
      serverSeedHash: sha256Hex(seed),
      clientSeed: venueId,
      bettingEndsAt: new Date(schedule.startedAt),
      revealEndsAt: new Date(schedule.endsAt),
      settleEndsAt: new Date(schedule.nextRoundAt),
      createdAt: new Date(schedule.bettingOpensAt),
      config: { ...config, version: 1 },
    })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(tableRoundsTable)
    .where(eq(tableRoundsTable.id, schedule.id));
  return row;
}
/** One lock and one transaction settle all players, including when no browser is open. */
export async function settleBikeLiveRound(
  id: string,
  clock: Clock = Date.now,
) {
  const changed: string[] = [];
  await db.transaction(async (tx) => {
    await roundLock(tx, id);
    const [round] = await tx
      .select()
      .from(tableRoundsTable)
      .where(eq(tableRoundsTable.id, id));
    if (
      !round ||
      round.gameCode !== code ||
      round.phase === "settled" ||
      clock() < round.revealEndsAt.getTime()
    )
      return;
    const config = round.config as RacingConfig;
    const plan = makeBikePlan(round.serverSeed);
    const winnerId = plan.order[0];
    const odds = BigInt(
      Math.round(
        config.bikes.find((h) => h.id === winnerId)!.multiplier * 100,
      ),
    );
    const rows = await tx
      .select()
      .from(betsTable)
      .where(
        and(
          eq(betsTable.roundId, id),
          eq(betsTable.gameCode, code),
          sql`${betsTable.metadata}->>'version' = '1'`,
        ),
      )
      .orderBy(asc(betsTable.userId));
    let totalPayout = 0n;
    for (const row of rows) {
      if (row.status !== "placed") {
        totalPayout += row.payoutAmount;
        continue;
      }
      const m = row.metadata as LiveMetadata;
      const payout = m.bets
        .filter((b) => b.bikeId === winnerId)
        .reduce((sum, b) => sum + (BigInt(b.amountPaise) * odds) / 100n, 0n);
      if (payout > 0n)
        await postEntry(
          {
            userId: row.userId,
            scope: code,
            type: "win",
            amount: payout,
            refType: "bet",
            refId: row.id,
            memo: "Live Bike Racing winnings",
          },
          tx,
        );
      await tx
        .update(betsTable)
        .set({
          status: payout > 0n ? "won" : "lost",
          payoutAmount: payout,
          multiplier: Number(payout) / Number(row.stakeAmount),
          settledAt: new Date(clock()),
          metadata: { ...m, winnerId },
        })
        .where(eq(betsTable.id, row.id));
      totalPayout += payout;
      changed.push(row.userId);
    }
    await tx
      .update(tableRoundsTable)
      .set({
        phase: "settled",
        outcome: { winnerId, order: plan.order },
        totalPayout,
        settledAt: new Date(clock()),
      })
      .where(eq(tableRoundsTable.id, id));
  });
  for (const userId of changed) {
    const wallet = await getBalanceByUser(userId);
    publishWalletBalance({
      userId,
      balance: wallet.balance,
      entryType: "win",
      amount: 0n,
    });
  }
}
export async function tickBikeLiveGame(clock: Clock = Date.now) {
  for (const venue of RACING_VENUES)
    await ensureBikeLiveRound(venue.id, clock());
  const due = await db
    .select({ id: tableRoundsTable.id })
    .from(tableRoundsTable)
    .where(
      and(
        eq(tableRoundsTable.gameCode, code),
        ne(tableRoundsTable.phase, "settled"),
        lte(tableRoundsTable.revealEndsAt, new Date(clock())),
        sql`${tableRoundsTable.config}->>'version' = '1'`,
      ),
    )
    .orderBy(asc(tableRoundsTable.revealEndsAt))
    .limit(100);
  for (const row of due) await settleBikeLiveRound(row.id, clock);
}
export function startBikeLiveGameEngine() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await tickBikeLiveGame();
    } catch (e) {
      console.error("[bike-live] round engine", e);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 1000);
  timer.unref();
  return () => clearInterval(timer);
}
export async function bikeLiveState(
  userId: string,
  venueId = "apex",
  clock: Clock = Date.now,
): Promise<RacingLiveState> {
  let round = await ensureBikeLiveRound(venueId, clock());
  const due = await db
    .select({ roundId: betsTable.roundId })
    .from(betsTable)
    .where(
      and(
        eq(betsTable.userId, userId),
        eq(betsTable.gameCode, code),
        eq(betsTable.status, "placed"),
        sql`${betsTable.metadata}->>'version' = '1'`,
        sql`(${betsTable.metadata}->>'endsAt')::bigint <= ${clock()}`,
      ),
    );
  for (const row of due)
    if (row.roundId) await settleBikeLiveRound(row.roundId, clock);
  // A DB wait may have crossed into the next slot. Return the current round.
  if (bikeRoundSchedule(venueId, clock()).id !== round.id)
    round = await ensureBikeLiveRound(venueId, clock());
  const rows = await db
    .select()
    .from(betsTable)
    .where(
      and(
        eq(betsTable.userId, userId),
        eq(betsTable.gameCode, code),
        sql`${betsTable.metadata}->>'version' = '1'`,
      ),
    )
    .orderBy(desc(betsTable.placedAt))
    .limit(40);
  const wallet = await getBalanceByUser(userId);
  const now = clock();
  return {
    serverNow: now,
    balance: wallet.balance.toString(),
    race: publicBikeRound(round, now),
    myBet: rows.find((row) => row.roundId === round.id)
      ? receipt(rows.find((row) => row.roundId === round.id)!)
      : null,
    history: rows
      .filter((row) => row.status !== "placed")
      .slice(0, 20)
      .map(receipt),
  };
}
export async function placeBikeLiveBet(
  userId: string,
  input: {
    roundId: string;
    requestId: string;
    venueId: string;
    bets: BikeSlip[];
  },
  clock: Clock = Date.now,
) {
  requireVenue(input.venueId);
  // Validate before canonicalising untrusted amounts, then apply round limits below.
  validateBikeSlip(input.bets, 100n, 8n * 10n ** 18n);
  const slip = input.bets
    .map((b) => ({ ...b, amountPaise: BigInt(b.amountPaise).toString() }))
    .sort((a, b) => a.bikeId - b.bikeId);
  const fingerprint = sha256Hex(
    JSON.stringify({
      roundId: input.roundId,
      venueId: input.venueId,
      bets: slip,
    }),
  );
  // Read global settings before opening a transaction. Using another pooled
  // connection while holding a round lock can starve the pool during a burst.
  const liveConfig = await bikeGameConfig();
  let posted = false;
  const bet = await db.transaction(async (tx) => {
    await roundLock(tx, input.roundId);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`bike-live-user:${userId}`}))`,
    );
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
    if (prior) {
      if ((prior.metadata as LiveMetadata).fingerprint !== fingerprint)
        throw conflict("This request was already used for a different bet.");
      return receipt(prior);
    }
    const [round] = await tx
      .select()
      .from(tableRoundsTable)
      .where(eq(tableRoundsTable.id, input.roundId));
    if (
      !round ||
      round.gameCode !== code ||
      round.clientSeed !== input.venueId ||
      clock() < round.createdAt.getTime() ||
      clock() >= round.bettingEndsAt.getTime()
    )
      throw conflict(
        "Betting is closed for this round. Wait for the next 20-second betting window.",
      );
    const cfg = round.config as RacingConfig;
    if (!cfg.enabled || !liveConfig.enabled)
      throw badRequest("Bike Racing is temporarily unavailable.");
    const total = validateBikeSlip(
      slip,
      BigInt(cfg.minStakePaise),
      BigInt(cfg.maxStakePaise),
    );
    const [accepted] = await tx
      .select({ id: betsTable.id })
      .from(betsTable)
      .where(
        and(
          eq(betsTable.userId, userId),
          eq(betsTable.roundId, round.id),
          eq(betsTable.gameCode, code),
        ),
      )
      .limit(1);
    if (accepted)
      throw conflict("Your bet for this round is already accepted.");
    const metadata: LiveMetadata = {
      version: 1,
      requestId: input.requestId,
      fingerprint,
      venueId: input.venueId,
      startedAt: round.bettingEndsAt.getTime(),
      endsAt: round.revealEndsAt.getTime(),
      bets: slip,
    };
    const [row] = await tx
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
          refId: row.id,
          memo: "Live Bike Racing stake",
        },
        tx,
      );
    } catch (e) {
      if ((e as Error).message === "INSUFFICIENT_FUNDS")
        throw badRequest("Insufficient wallet balance.");
      throw e;
    }
    // Wallet locks can wait: roll the entire transaction back if the cutoff passed.
    if (clock() >= round.bettingEndsAt.getTime())
      throw conflict(
        "Betting closed before your bet was accepted. Your wallet was not charged.",
      );
    await tx
      .update(tableRoundsTable)
      .set({
        totalStake: sql`${tableRoundsTable.totalStake} + ${total}`,
        playerCount: sql`${tableRoundsTable.playerCount} + 1`,
      })
      .where(eq(tableRoundsTable.id, round.id));
    posted = true;
    return receipt(row);
  });
  const state = await bikeLiveState(userId, input.venueId, clock);
  if (posted)
    publishWalletBalance({
      userId,
      balance: BigInt(state.balance),
      entryType: "bet",
      amount: -BigInt(bet.totalStake),
    });
  return {
    ...state,
    acceptedBet:
      state.myBet?.id === bet.id
        ? state.myBet
        : (state.history.find((b) => b.id === bet.id) ?? bet),
  };
}
