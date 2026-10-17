import {
  db,
  betsTable,
  roundSettlementsTable,
  roundSettlementEntriesTable,
  companyProfitLedgerTable,
  gameConfigTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  postEntry,
  type TxClient,
  publishWalletBalance,
  toWalletScope,
} from "./wallet";
import { bus } from "../realtime/eventBus";
import { logger } from "../lib/logger";
import { badRequest, conflict, notFound } from "../lib/errors";
import { getPartner, remoteCredit } from "./partnerWalletClient";
import { _emitSettledWebhook } from "./bets";

// Company keeps 5% of every round; players share the remaining 95%.
export const COMPANY_BPS = 500n; // 5.00%
export const TOTAL_BPS = 10_000n;

export interface SettlementInputBet {
  betId: string;
  userId: string;
  stake: bigint;
  /** null when the player did not cash out (busted). */
  cashoutMultiplier: number | null;
}

export interface SettlementEntry {
  betId: string;
  userId: string;
  stake: bigint;
  cashoutMultiplier: number | null;
  payout: bigint;
  profit: bigint;
}

export interface SettlementResult {
  totalPool: bigint;
  playerPool: bigint;
  companyProfit: bigint;
  winnerCount: number;
  loserCount: number;
  entries: SettlementEntry[];
}

/**
 * Pure split math. Pulled out of the DB-bound settle function so it can be
 * unit-tested without any infrastructure.
 *
 *   totalPool  = sum of every stake (winners + losers)
 *   companyProfit = floor(totalPool * 5%)  — house cut, always
 *   playerPool = totalPool - companyProfit  — remaining 95% (plus any 5%
 *                rounding remainder, but here we floor company so the
 *                remainder lands in the players' pool, not the house's)
 *   weight(i)  = stake_i * cashoutMultiplier_i  (only for winners)
 *   payout(i)  = floor(playerPool * weight_i / sum_weights)
 *   The very last winner absorbs any rounding leftover so the sum of all
 *   payouts + companyProfit equals totalPool exactly. If nobody cashed out
 *   (sum_weights = 0) the entire pool goes to companyProfit.
 *
 * `cashoutMultiplier` must be > 1 for the bet to count as a winning slice.
 * A non-null multiplier of exactly 1.0 is treated as a no-op cashout (no
 * stake recovery), consistent with how cashOutBet caps the live multiplier.
 */
export function computeSplit(bets: SettlementInputBet[]): SettlementResult {
  let totalPool = 0n;
  for (const b of bets) totalPool += b.stake;

  if (totalPool === 0n) {
    return {
      totalPool: 0n,
      playerPool: 0n,
      companyProfit: 0n,
      winnerCount: 0,
      loserCount: 0,
      entries: bets.map((b) => ({
        betId: b.betId,
        userId: b.userId,
        stake: b.stake,
        cashoutMultiplier: b.cashoutMultiplier,
        payout: 0n,
        profit: -b.stake,
      })),
    };
  }

  // 5% house cut, floor-rounded so remainder favours players.
  let companyProfit = (totalPool * COMPANY_BPS) / TOTAL_BPS;
  let playerPool = totalPool - companyProfit;

  // Winners are bets with a usable cashout multiplier > 1.
  const winners = bets.filter(
    (b) => b.cashoutMultiplier !== null && b.cashoutMultiplier > 1,
  );
  const losers = bets.filter(
    (b) => b.cashoutMultiplier === null || (b.cashoutMultiplier ?? 0) <= 1,
  );

  // Edge case: nobody cashed out — entire pool is company profit. We still
  // emit per-bet entries so the admin breakdown shows every participant.
  if (winners.length === 0) {
    companyProfit = totalPool;
    playerPool = 0n;
    return {
      totalPool,
      playerPool,
      companyProfit,
      winnerCount: 0,
      loserCount: bets.length,
      entries: bets.map((b) => ({
        betId: b.betId,
        userId: b.userId,
        stake: b.stake,
        cashoutMultiplier: b.cashoutMultiplier,
        payout: 0n,
        profit: -b.stake,
      })),
    };
  }

  // Weights are stake × multiplier scaled to integer micro-units (×1e6) so
  // the 95/5 split stays in pure bigint arithmetic; this avoids float drift
  // when totalling weights and computing the proportional share.
  const SCALE = 1_000_000n;
  const weights: bigint[] = winners.map((w) =>
    (w.stake * BigInt(Math.round((w.cashoutMultiplier as number) * 1_000_000))) /
    1n,
  );
  // Each weight above is stake_paise × (multiplier × 1e6). Sum is large but
  // fits in bigint trivially. We use the sum directly as the divisor.
  let sumWeights = 0n;
  for (const w of weights) sumWeights += w;

  // Distribute playerPool: floor(playerPool * w_i / sumWeights) per winner,
  // then dump the rounding residual into the last winner so totals balance.
  const winnerPayouts: bigint[] = weights.map((w) => (playerPool * w) / sumWeights);
  let distributed = 0n;
  for (const p of winnerPayouts) distributed += p;
  const residual = playerPool - distributed;
  if (residual > 0n && winnerPayouts.length > 0) {
    // Hand the residual to the largest winner so it scales sensibly. Falling
    // back to "last in list" would give an arbitrary player the leftover.
    let topIdx = 0;
    for (let i = 1; i < winnerPayouts.length; i++) {
      if (winnerPayouts[i]! > winnerPayouts[topIdx]!) topIdx = i;
    }
    winnerPayouts[topIdx] = winnerPayouts[topIdx]! + residual;
  }

  const entries: SettlementEntry[] = [];
  let wIdx = 0;
  for (const b of bets) {
    const isWinner = b.cashoutMultiplier !== null && b.cashoutMultiplier > 1;
    if (isWinner) {
      const payout = winnerPayouts[wIdx++]!;
      entries.push({
        betId: b.betId,
        userId: b.userId,
        stake: b.stake,
        cashoutMultiplier: b.cashoutMultiplier,
        payout,
        profit: payout - b.stake,
      });
    } else {
      entries.push({
        betId: b.betId,
        userId: b.userId,
        stake: b.stake,
        cashoutMultiplier: b.cashoutMultiplier,
        payout: 0n,
        profit: -b.stake,
      });
    }
  }

  // Sanity: payouts + companyProfit must equal totalPool exactly.
  let totalOut = companyProfit;
  for (const e of entries) totalOut += e.payout;
  if (totalOut !== totalPool) {
    // Should be impossible given the residual fix-up above; throw loudly so
    // a settle bug never silently shorts (or over-pays) the house ledger.
    throw new Error(
      `Settlement balance mismatch: pool=${totalPool} totalOut=${totalOut}`,
    );
  }

  return {
    totalPool,
    playerPool,
    companyProfit,
    winnerCount: winners.length,
    loserCount: losers.length,
    entries,
  };
}

export interface SettleRoundResult extends SettlementResult {
  settlementId: string;
  gameCode: string;
  alreadySettled: boolean;
}

/**
 * Atomic + idempotent round settlement under the pari-mutuel model.
 *
 * Pre-conditions enforced server-side (NOT trusted from the caller):
 *   - The round must contain at least one bet.
 *   - Every bet in the round must already be in a terminal status
 *     (cashed_out, lost, voided). If any bet is still 'placed' the round
 *     hasn't actually crashed yet — we reject with 409 instead of
 *     force-resolving, so an authenticated caller cannot prematurely
 *     finalize an in-flight round and steal stakes from active players.
 *   - The bet rows determine the gameCode (caller-supplied gameCode is
 *     ignored). Per-game settlementMode must be 'pari_mutuel'; under
 *     'house_edge' we no-op so the legacy per-bet credit path remains
 *     the sole money mover.
 *
 * Loads every bet for the round, computes the 95/5 split, credits each
 * winner's wallet via the existing ledger, writes the round_settlements +
 * round_settlement_entries rows, AND posts a company_profit_ledger entry
 * for the 5% house cut — all inside one transaction. Re-running for the
 * same round is a no-op (unique on round_id+game_code; in-tx SELECT FOR
 * UPDATE; fast-path check before opening the transaction).
 */
export async function settleRoundPariMutuel(
  roundId: string,
): Promise<SettleRoundResult | null> {
  // Pre-flight #1: at least one bet must exist; derive the game from those
  // bets so the caller cannot trick us into settling a round under the
  // wrong settlementMode by spoofing gameCode in the request body.
  const probeBets = await db
    .select({
      id: betsTable.id,
      status: betsTable.status,
      gameCode: betsTable.gameCode,
      metadata: betsTable.metadata,
    })
    .from(betsTable)
    .where(eq(betsTable.roundId, roundId))
    .limit(500);
  if (probeBets.length === 0) {
    throw notFound(`Round ${roundId} has no bets`);
  }
  const gameCode = probeBets[0]!.gameCode;
  // Defensive: if a round somehow contains bets across multiple games,
  // refuse to settle — the split must be over a single game's pool.
  if (probeBets.some((b) => b.gameCode !== gameCode)) {
    throw badRequest(
      `Round ${roundId} contains bets across multiple games; refusing to settle`,
    );
  }
  // Pre-flight #2: every bet must already be terminal. Lunar is client-driven
  // and we can't trust an arbitrary user to tell us a round has crashed,
  // so we infer "round is over" from the fact that no bet is still 'placed'.
  // This blocks the obvious griefing attack: settle a still-flying round to
  // forcibly finalize stakes that should still be in play.
  const stillOpen = probeBets.filter((b) => b.status === "placed").length;
  if (stillOpen > 0) {
    throw conflict(
      `Round ${roundId} has ${stillOpen} bet(s) still in 'placed' state; round not finished`,
    );
  }
  // Pre-flight #3: feature flag — only run pari-mutuel for games configured
  // for it. House-edge games already credited at cashOutBet, so settling
  // them again would double-pay every winner.
  const cfg = await db
    .select({ settlementMode: gameConfigTable.settlementMode })
    .from(gameConfigTable)
    .where(eq(gameConfigTable.gameCode, gameCode))
    .limit(1);
  if (!cfg[0]) {
    throw notFound(`Game config missing for ${gameCode}`);
  }
  const acceptedModes = probeBets.map(b => (b.metadata as { settlementMode?: string } | null)?.settlementMode ?? cfg[0].settlementMode);
  if (acceptedModes.some(mode => mode !== "pari_mutuel")) {
    // Not an error — the round just has no pari-mutuel settlement to do.
    return null;
  }
  // Fast-path: if already settled, return null immediately. The in-tx
  // SELECT FOR UPDATE below remains the authoritative idempotency guard.
  const existing = await db
    .select()
    .from(roundSettlementsTable)
    .where(
      and(
        eq(roundSettlementsTable.roundId, roundId),
        eq(roundSettlementsTable.gameCode, gameCode),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return null;
  }

  type CreditedLocal = {
    kind: "local";
    userId: string;
    payout: bigint;
    balanceAfter: bigint;
  };
  type CreditedRemote = {
    kind: "remote";
    userId: string;
    partnerId: string;
    partnerPlayerRef: string;
    betId: string;
    gameCode: string;
    payout: bigint;
  };
  type CreditedSkipped = {
    kind: "skipped_remote";
    userId: string;
    partnerId: string;
    payout: bigint;
  };
  type Credited = CreditedLocal | CreditedRemote | CreditedSkipped;
  type SettledBetForWebhook = { betId: string };

  type TxResult =
    | { kind: "already" }
    | { kind: "empty" }
    | {
        kind: "ok";
        settlementId: string;
        split: SettlementResult;
        credited: Credited[];
        settledBets: SettledBetForWebhook[];
      };
  const result: TxResult = await db.transaction(async (tx: TxClient) => {
    // Re-check inside the transaction so two concurrent triggers can't both
    // pay out. The unique index on (round_id, game_code) is the durable
    // backstop; this select+lock keeps the second caller from doing wasted
    // work and surfacing a duplicate-key error to the route.
    const inTx = await tx
      .select()
      .from(roundSettlementsTable)
      .where(
        and(
          eq(roundSettlementsTable.roundId, roundId),
          eq(roundSettlementsTable.gameCode, gameCode),
        ),
      )
      .for("update")
      .limit(1);
    if (inTx[0]) {
      return { kind: "already" };
    }

    // Lock every bet for the round at the row level so a concurrent cashout
    // can't transition between our pre-flight and the split. We re-check
    // the "no placed bets" invariant under the lock — if a player races a
    // cashout in between, we abort instead of settling a moving target.
    const bets = await tx
      .select()
      .from(betsTable)
      .where(eq(betsTable.roundId, roundId))
      .for("update");

    if (bets.length === 0) {
      return { kind: "empty" };
    }
    const placedUnderLock = bets.filter((b) => b.status === "placed").length;
    if (placedUnderLock > 0) {
      throw conflict(
        `Round ${roundId} raced: ${placedUnderLock} bet(s) flipped back to 'placed' before settle`,
      );
    }
    // cashed_out bets keep their multiplier; lost bets carry multiplier=null.
    // voided bets were rolled back at place time so they contribute neither
    // to the pool nor to the entries. Free bets are ALSO excluded: their
    // stake never entered the pool (no wallet debit at placement) and their
    // winnings were already credited to cash at cashOutBet time — including
    // them here would both inflate the pool with phantom stake and double-pay
    // the winner.
    const eligible = bets.filter(
      (b) =>
        (b.status === "cashed_out" || b.status === "lost") &&
        !(b.metadata as { freeBet?: boolean } | null)?.freeBet,
    );

    const split = computeSplit(
      eligible.map((b) => ({
        betId: b.id,
        userId: b.userId,
        stake: b.stakeAmount,
        cashoutMultiplier:
          b.status === "cashed_out" ? (b.multiplier ?? null) : null,
      })),
    );

    const [settlement] = await tx
      .insert(roundSettlementsTable)
      .values({
        roundId,
        gameCode,
        totalPool: split.totalPool,
        playerPool: split.playerPool,
        companyProfit: split.companyProfit,
        winnerCount: split.winnerCount,
        loserCount: split.loserCount,
      })
      .returning();

    if (split.entries.length > 0) {
      await tx.insert(roundSettlementEntriesTable).values(
        split.entries.map((e) => ({
          settlementId: settlement!.id,
          roundId,
          userId: e.userId,
          betId: e.betId,
          stake: e.stake,
          cashoutMultiplier: e.cashoutMultiplier,
          payout: e.payout,
          profit: e.profit,
        })),
      );
    }

    // Build a quick (betId -> bet row) map so we can route payouts by the
    // bet's owning partner: remote-wallet partners get a remoteCredit POST
    // dispatched after commit (mirroring cashOutBet/placeBet behavior),
    // local-wallet players get postEntry inside this transaction.
    const betById = new Map(bets.map((b) => [b.id, b]));
    const credited: Credited[] = [];
    const settledBets: SettledBetForWebhook[] = [];
    for (const e of split.entries) {
      // Always update bet.payoutAmount — even for losers (already 0) and
      // remote-wallet partners — so the bet row is the single source of
      // truth for "what was finally paid". Webhook re-emit (after commit)
      // pulls from the updated row.
      await tx
        .update(betsTable)
        .set({ payoutAmount: e.payout })
        .where(eq(betsTable.id, e.betId));

      const betRow = betById.get(e.betId);
      // Track every cashed_out bet for post-commit webhook re-emission so
      // partners learn the *final* payout (not the placeholder 0 that
      // cashOutBet wrote in pari-mutuel mode).
      if (betRow && betRow.status === "cashed_out" && betRow.partnerId) {
        settledBets.push({ betId: e.betId });
      }

      if (e.payout <= 0n) continue;

      // Partner routing: lookup partner config (cached). A remote-wallet
      // partner MUST NOT be credited via the local Lunar ledger — their
      // money lives in the partner's wallet system. We schedule a remote
      // credit POST for after the transaction commits and a bet.settled
      // webhook for reconciliation; same strict-mode policy as cashOutBet.
      const partner = betRow?.partnerId
        ? await getPartner(betRow.partnerId)
        : null;
      const partnerIsRemote =
        !!partner && partner.walletMode === "remote-wallet";
      const canRemoteCredit =
        partnerIsRemote &&
        !!partner?.walletCallbackUrl &&
        !!betRow?.partnerPlayerRef;

      if (partnerIsRemote && canRemoteCredit && partner && betRow?.partnerPlayerRef) {
        credited.push({
          kind: "remote",
          userId: e.userId,
          partnerId: partner.id,
          partnerPlayerRef: betRow.partnerPlayerRef,
          betId: e.betId,
          gameCode,
          payout: e.payout,
        });
        continue;
      }
      if (partnerIsRemote && !canRemoteCredit) {
        // Config drift — skip both local and remote credit; the bet.settled
        // webhook below is the durable retry channel partners must honor.
        logger.warn(
          {
            betId: e.betId,
            partnerId: betRow?.partnerId,
            hasCallback: !!partner?.walletCallbackUrl,
            hasPlayerRef: !!betRow?.partnerPlayerRef,
          },
          "remote-wallet partner pari-mutuel credit skipped — config drift",
        );
        credited.push({
          kind: "skipped_remote",
          userId: e.userId,
          partnerId: betRow!.partnerId!,
          payout: e.payout,
        });
        continue;
      }

      // Local wallet path: post inside the same transaction so a wallet
      // failure rolls the entire settlement back.
      const { entry } = await postEntry(
        {
          userId: e.userId,
          type: "win",
          amount: e.payout,
          // Pari-mutuel payouts credit the wallet scope of whichever
          // crash game this round belongs to (lunar or a themed variant).
          scope: toWalletScope(gameCode),
          refType: "round_settlement",
          refId: settlement!.id,
          memo: `Pari-mutuel payout for round ${roundId}`,
        },
        tx,
      );
      credited.push({
        kind: "local",
        userId: e.userId,
        payout: e.payout,
        balanceAfter: entry.balanceAfter,
      });
    }

    // Append-only company-profit ledger row in the same transaction. Pull
    // the current running balance under the lock (FOR UPDATE on the table
    // would be excessive; we serialize on the unique settlement_id index
    // and the transaction's per-row locks). The unique index on
    // settlement_id makes this insert idempotent if the surrounding
    // settlement insert was already committed in another tx.
    const [{ prev }] = (await tx
      .select({
        prev: sql<string>`COALESCE(MAX(${companyProfitLedgerTable.balanceAfter}), 0)::text`,
      })
      .from(companyProfitLedgerTable)
      .where(eq(companyProfitLedgerTable.gameCode, gameCode))) as {
      prev: string;
    }[];
    const newBalance = BigInt(prev) + split.companyProfit;
    await tx.insert(companyProfitLedgerTable).values({
      settlementId: settlement!.id,
      gameCode,
      amount: split.companyProfit,
      balanceAfter: newBalance,
    });

    return {
      kind: "ok",
      settlementId: settlement!.id,
      split,
      credited,
      settledBets,
    };
  });

  if (result.kind !== "ok") {
    return null;
  }

  // post-commit: publish wallet balance updates for LOCAL credits only —
  // remote-wallet partners manage their own balance feed. `amount` is the
  // payout delta (not the new balance), matching the convention used by
  // postEntry's own publishWalletBalance call elsewhere in the app.
  for (const c of result.credited) {
    if (c.kind === "local") {
      publishWalletBalance({
        userId: c.userId,
        scope: toWalletScope(gameCode),
        balance: c.balanceAfter,
        entryType: "win",
        amount: c.payout,
      });
    }
  }
  // Remote-wallet partner credits: best-effort POST after the local txn
  // committed. Failure is non-fatal — the bet.settled webhook re-emitted
  // below is the durable reconciliation channel and the partner's /credit
  // handler MUST be idempotent on betId.
  for (const c of result.credited) {
    if (c.kind === "remote") {
      void remoteCredit({
        partner: (await getPartner(c.partnerId))!,
        playerRef: c.partnerPlayerRef,
        amountPaise: c.payout,
        idempotencyKey: `credit_${c.betId}`,
        betId: c.betId,
        gameCode: c.gameCode,
      });
    }
  }
  // Re-emit bet.settled per cashed_out bet so partners learn the *final*
  // payout. We deferred this in cashOutBet under pari-mutuel mode precisely
  // so partners never observe an interim payout=0. Re-fetch each bet row
  // post-commit to get the updated payoutAmount before emitting.
  if (result.settledBets.length > 0) {
    const ids = result.settledBets.map((s) => s.betId);
    const refreshed = await db
      .select()
      .from(betsTable)
      .where(
        ids.length === 1
          ? eq(betsTable.id, ids[0]!)
          : sql`${betsTable.id} IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
      );
    for (const b of refreshed) _emitSettledWebhook(b);
  }
  // Reuse the existing "bet_settled" bump so the dashboard re-pulls. We don't
  // need a dedicated topic here — the admin Round Profit page polls its own
  // endpoints on a 30/60s cadence and re-fetches on visibility change.
  bus.publish({
    topic: "admin:metrics",
    type: "bump",
    reason: "bet_settled",
    ts: Date.now(),
  });

  logger.info(
    {
      roundId,
      gameCode,
      pool: result.split.totalPool.toString(),
      company: result.split.companyProfit.toString(),
      winners: result.split.winnerCount,
      losers: result.split.loserCount,
    },
    "round settled (pari-mutuel)",
  );

  return {
    settlementId: result.settlementId,
    gameCode,
    alreadySettled: false,
    ...result.split,
  };
}

/**
 * Read helper for the admin "Round Profit Split" page. Returns counts +
 * pool/payout/profit totals over a half-open `[since, until)` window so the
 * caller can compose today / 7d / 30d / all-time cards.
 */
export async function settlementTotals(args: {
  since?: Date | null;
  until?: Date | null;
  gameCode?: string | null;
}) {
  const conds = [] as ReturnType<typeof eq>[];
  if (args.gameCode) conds.push(eq(roundSettlementsTable.gameCode, args.gameCode));
  // Use raw SQL for the window so we don't need to import gte/lt here.
  const where =
    conds.length > 0
      ? sql`${conds.reduce((a, b) => sql`${a} AND ${b}`)}`
      : sql`true`;
  const since = args.since ?? null;
  const until = args.until ?? null;
  const window = sql`${
    since ? sql`${roundSettlementsTable.settledAt} >= ${since}` : sql`true`
  } AND ${
    until ? sql`${roundSettlementsTable.settledAt} < ${until}` : sql`true`
  }`;
  const rows = await db
    .select({
      rounds: sql<string>`COUNT(*)::text`,
      totalPool: sql<string>`COALESCE(SUM(${roundSettlementsTable.totalPool}), 0)::text`,
      playerPool: sql<string>`COALESCE(SUM(${roundSettlementsTable.playerPool}), 0)::text`,
      companyProfit: sql<string>`COALESCE(SUM(${roundSettlementsTable.companyProfit}), 0)::text`,
    })
    .from(roundSettlementsTable)
    .where(sql`${where} AND ${window}`);
  const r = rows[0]!;
  return {
    rounds: Number(r.rounds),
    totalPool: r.totalPool,
    playerPool: r.playerPool,
    companyProfit: r.companyProfit,
  };
}
