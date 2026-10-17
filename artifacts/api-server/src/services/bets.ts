import {
  db,
  betsTable,
  freeBetGrantsTable,
  type Bet,
} from "@workspace/db";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { postEntry, toWalletScope } from "./wallet";
import {
  debitForBet as bonusDebit,
  creditForWin as bonusCreditWin,
  refundForBet as bonusRefund,
  isBonusEligibleGame,
  convertBonusToCashIfReady,
} from "./bonusWallet";
import { accrueCommissionForBet } from "./commission";
import { consumeFreeBet, refundFreeBet } from "./freeBets";
import { requireGameConfig } from "./rtp";
import { bus } from "../realtime/eventBus";
import { db as _db, usersTable } from "@workspace/db";
import { enqueueWebhook } from "./webhookDispatcher";
import { logger } from "../lib/logger";
import { badRequest } from "../lib/errors";
import { isRetiredGame } from "../lib/retiredGames";
import {
  getPartner,
  remoteDebit,
  remoteCredit,
} from "./partnerWalletClient";

async function userDisplayName(userId: string): Promise<string | null> {
  try {
    const r = await _db
      .select({ displayName: usersTable.displayName, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!r[0]) return null;
    if (r[0].displayName) return r[0].displayName;
    // Use email local-part to avoid leaking PII to other players
    const local = r[0].email.split("@")[0];
    return local.length > 12 ? local.slice(0, 10) + "…" : local;
  } catch {
    return null;
  }
}

export interface PlaceBetInput {
  crashTerms?: { crashAutoCashout?: number; crashPanel: number };
  /** Set only by the server's validated shared-round adapter. */
  tableRoundPlacement?: boolean;
  userId: string;
  gameCode: string;
  roundId?: string | null;
  stakeAmount: bigint;
  partnerId?: string | null;
  partnerBetId?: string | null;
  partnerPlayerRef?: string | null;
  /**
   * If true, debit from the bonus wallet instead of cash. Only valid for
   * BONUS_GAMES (lunar/mines/plinko/dice) and never for partner bets. The
   * `useBonus: true` marker is persisted on the bet's metadata so the
   * matching cashOut/settleLoss path can route the credit to the bonus
   * wallet too.
   */
  useBonus?: boolean;
  /**
   * If true, consume one promotional free bet instead of debiting any
   * wallet. The stake is forced to the grant's fixed amount (client-sent
   * stakeAmount is ignored) and `{ freeBet: true, grantId }` is persisted
   * on metadata so cashout credits winnings to the CASH wallet immediately
   * (even in pari-mutuel mode) and round settlement excludes the bet from
   * the shared pool.
   */
  useFreeBet?: boolean;
}

export async function placeBet(input: PlaceBetInput): Promise<Bet> {
  if (isRetiredGame(input.gameCode)) throw badRequest("This game is no longer available.");
  if (input.gameCode === "wheel-2-live") throw badRequest("Use the Wheel 2.0 Live table to confirm your bet.");
  if (input.gameCode === "lucky-7-live") throw badRequest("Use the Lucky 7 Live table to confirm your bet.");
  if (input.gameCode === "7up7down") throw badRequest("Use the 7 Up 7 Down table to confirm your bet.");
  if (input.gameCode === "roulette" && !input.tableRoundPlacement) {
    throw badRequest("Roulette bets must use the current table and its per-selection limits.");
  }
  if (input.gameCode === "chicken-road") throw badRequest("Use the Chicken Road game to place a bet.");
  if (input.gameCode === "crazy-time" && !input.tableRoundPlacement) {
    throw badRequest("Crazy Time bets must use the current table round.");
  }
  if (input.gameCode === "vegetable-bowl" && !input.tableRoundPlacement) {
    throw badRequest("Vegetable Bowl bets must use the current table round.");
  }
  if (input.gameCode === "bike-racing" || /^(hr[34]|br1)-/.test(input.roundId ?? "")) {
    throw badRequest("Live racing bets must use the current race betting window.");
  }
  if (!input.useFreeBet && input.stakeAmount <= 0n) {
    throw new Error("INVALID_STAKE");
  }
  const useBonus = !!input.useBonus;
  if (useBonus) {
    if (input.partnerId) throw new Error("BONUS_NOT_ALLOWED_FOR_PARTNER");
    if (!isBonusEligibleGame(input.gameCode)) {
      throw new Error("BONUS_NOT_ALLOWED_FOR_GAME");
    }
  }
  // Free bets: consume one from the oldest active grant BEFORE inserting the
  // bet row — the atomic decrement in consumeFreeBet is the double-spend
  // guard. Never combinable with bonus or partner bets.
  let freeBetGrantId: string | null = null;
  let stakeAmount = input.stakeAmount;
  if (input.useFreeBet) {
    if (input.partnerId) throw new Error("FREE_BET_NOT_ALLOWED_FOR_PARTNER");
    if (useBonus) throw new Error("FREE_BET_NOT_COMBINABLE_WITH_BONUS");
    const grant = await consumeFreeBet(input.userId, input.gameCode);
    if (!grant) throw new Error("NO_FREE_BETS");
    freeBetGrantId = grant.id;
    stakeAmount = grant.amountPaise;
  }
  // Insert the bet first so we have an id to reference from the ledger entry.
  // If the wallet debit fails (e.g. insufficient funds) we void the bet so the
  // row stays auditable but never counts as a real "placed" wager. If the
  // insert itself fails after a free bet was consumed, refund the grant so
  // the player never loses an entitlement without a bet row to show for it.
  let bet: Bet | undefined;
  try {
    [bet] = await db
      .insert(betsTable)
      .values({
        userId: input.userId,
        gameCode: input.gameCode,
        roundId: input.roundId ?? null,
        stakeAmount,
        status: "placed",
        partnerId: input.partnerId ?? null,
        partnerBetId: input.partnerBetId ?? null,
        partnerPlayerRef: input.partnerPlayerRef ?? null,
        metadata: input.crashTerms ? { ...input.crashTerms, crashFunded: false, settlementMode: "house_edge", ...(freeBetGrantId ? { freeBet: true, grantId: freeBetGrantId } : useBonus ? { useBonus: true } : {}) } : freeBetGrantId
          ? { freeBet: true, grantId: freeBetGrantId }
          : useBonus
            ? { useBonus: true }
            : null,
      })
      .returning();
    if (!bet) throw new Error("BET_INSERT_FAILED");
  } catch (err) {
    if (freeBetGrantId) {
      await refundFreeBet(freeBetGrantId, input.userId);
    }
    throw err;
  }
  // Two wallet-mode branches:
  //   local-credits   — Lunar holds the player's float; we debit our own ledger.
  //   remote-wallet   — Partner holds the player's float; we POST /debit to
  //                     their walletCallbackUrl. Authoritative — failure
  //                     voids the bet and surfaces INSUFFICIENT_FUNDS.
  // The partnerId+walletMode is fetched via a small TTL cache to keep the
  // hot path fast; admin edits propagate within ~60s.
  const partner = input.partnerId ? await getPartner(input.partnerId) : null;
  // Enforce partner.allowedGames so a launcher session for one game cannot
  // simply navigate to another game route inside the iframe and place bets
  // tagged to the partner — the public /v1/bets path already enforces this
  // before reaching us, but the browser-session path through /api/bets/place
  // would otherwise bypass it.
  if (
    partner &&
    partner.allowedGames.length > 0 &&
    !partner.allowedGames.includes(input.gameCode)
  ) {
    await db
      .update(betsTable)
      .set({ status: "voided" })
      .where(eq(betsTable.id, bet!.id));
    throw new Error("GAME_NOT_ALLOWED_FOR_PARTNER");
  }
  // remote-wallet partners MUST have a callbackUrl AND the bet MUST carry a
  // partnerPlayerRef — otherwise we cannot tell the partner whose balance to
  // debit. Silently falling back to the local Lunar wallet here would bypass
  // the partner's authorisation and create money-flow we can't reconcile, so
  // we void the bet and surface a clear configuration error instead.
  if (partner && partner.walletMode === "remote-wallet") {
    if (!partner.walletCallbackUrl || !input.partnerPlayerRef) {
      await db
        .update(betsTable)
        .set({ status: "voided", settledAt: new Date() })
        .where(eq(betsTable.id, bet!.id));
      throw new Error(
        !partner.walletCallbackUrl
          ? "REMOTE_WALLET_NOT_CONFIGURED"
          : "PARTNER_PLAYER_REF_REQUIRED",
      );
    }
  }
  const useRemote = !!partner && partner.walletMode === "remote-wallet";
  try {
    if (freeBetGrantId) {
      // Free bet: no wallet movement at all — the "stake" was already
      // consumed from the grant above.
    } else if (useRemote && partner && input.partnerPlayerRef) {
      await remoteDebit({
        partner,
        playerRef: input.partnerPlayerRef,
        amountPaise: stakeAmount,
        idempotencyKey: `debit_${bet!.id}`,
        betId: bet!.id,
        gameCode: input.gameCode,
      });
    } else if (useBonus) {
      await bonusDebit({
        userId: input.userId,
        amount: stakeAmount,
        betId: bet!.id,
        gameCode: input.gameCode,
      });
    } else {
      await postEntry({
        userId: input.userId,
        type: "bet",
        amount: -stakeAmount,
        scope: toWalletScope(input.gameCode),
        refType: "bet",
        refId: bet!.id,
        memo: `Bet on ${input.gameCode}`,
      });
    }
  } catch (err) {
    await db
      .update(betsTable)
      .set({ status: "voided", settledAt: new Date() })
      .where(eq(betsTable.id, bet!.id));
    if (freeBetGrantId) {
      await refundFreeBet(freeBetGrantId, input.userId);
    }
    throw err;
  }
  void userDisplayName(input.userId).then((displayName) => {
    bus.publish({
      topic: "bets:global",
      type: "placed",
      id: bet!.id,
      userId: input.userId,
      displayName,
      gameCode: input.gameCode,
      stakeAmount: stakeAmount.toString(),
      ts: Date.now(),
    });
  });
  bus.publish({
    topic: "admin:metrics",
    type: "bump",
    reason: "bet_placed",
    ts: Date.now(),
  });
  if (bet!.partnerId) {
    void enqueueWebhook({
      partnerId: bet!.partnerId,
      eventType: "bet.placed",
      payload: {
        betId: bet!.id,
        partnerBetId: bet!.partnerBetId,
        partnerPlayerRef: bet!.partnerPlayerRef,
        gameCode: bet!.gameCode,
        roundId: bet!.roundId,
        stakeAmount: bet!.stakeAmount.toString(),
        placedAt: bet!.placedAt.toISOString(),
      },
      eventId: `bet.placed.${bet!.id}`,
    });
  }
  return bet!;
}

function emitSettledWebhook(bet: Bet): void {
  if (!bet.partnerId) return;
  void enqueueWebhook({
    partnerId: bet.partnerId,
    eventType: "bet.settled",
    payload: {
      betId: bet.id,
      partnerBetId: bet.partnerBetId,
      partnerPlayerRef: bet.partnerPlayerRef,
      gameCode: bet.gameCode,
      roundId: bet.roundId,
      status: bet.status,
      stakeAmount: bet.stakeAmount.toString(),
      payoutAmount: bet.payoutAmount.toString(),
      multiplier: bet.multiplier,
      settledAt: bet.settledAt?.toISOString() ?? null,
    },
    eventId: `bet.settled.${bet.id}`,
  });
}

export interface CashOutInput {
  /** Exact server-computed roulette return; public routes never accept this. */
  roulettePayoutPaise?: bigint;
  /** Exact, server-only wheel settlement; never accepted from public requests. */
  crazyTimePayoutPaise?: bigint;
  /** Exact server-computed Vegetable Bowl return. Never accepted by a public route. */
  vegetablePayoutPaise?: bigint;
  betId: string;
  userId: string;
  multiplier: number;
  // Optional per-call cap (used by games that snapshot maxMultiplier on the
  // round so a mid-round admin RTP edit can never retro-affect economics).
  // When set, we still also cap to the live game config — whichever is lower
  // wins, so admin caps remain a hard ceiling.
  maxMultiplierCap?: number;
}

export async function cashOutBet(input: CashOutInput): Promise<Bet> {
  const rows = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.id, input.betId))
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new Error("BET_NOT_FOUND");
  if (existing.userId !== input.userId) throw new Error("BET_NOT_FOUND");
  if (existing.gameCode === "roulette" && (input.roulettePayoutPaise === undefined || input.roulettePayoutPaise < 0n || input.roulettePayoutPaise > existing.stakeAmount * 36n)) {
    throw badRequest("Roulette bets settle automatically on the winning pocket.");
  }
  if (existing.gameCode === "chicken-road") throw badRequest("Use the Chicken Road game to cash out.");
  if (existing.gameCode === "7up7down") throw badRequest("7 Up 7 Down payouts are settled by the game server.");
  if (existing.gameCode === "wheel-2-live") throw badRequest("Wheel 2.0 Live outcomes are settled by the game server.");
  if (existing.gameCode === "lucky-7-live") throw badRequest("Lucky 7 Live payouts are settled by the game server.");
  if (existing.gameCode === "crazy-time" && (input.crazyTimePayoutPaise === undefined || input.crazyTimePayoutPaise < 0n || input.crazyTimePayoutPaise > existing.stakeAmount * 5001n)) {
    throw badRequest("Crazy Time bets settle automatically after the wheel stops.");
  }
  if (existing.gameCode === "vegetable-bowl" && (input.vegetablePayoutPaise === undefined || input.vegetablePayoutPaise < 0n || input.vegetablePayoutPaise > existing.stakeAmount * 20n)) {
    throw badRequest("Vegetable Bowl bets settle automatically after the harvest.");
  }
  if (existing.gameCode === "bike-racing" || (existing.gameCode === "horse-racing" && [2, 3].includes((existing.metadata as { version?: number } | null)?.version ?? 0))) {
    throw badRequest("Horse race bets settle automatically at the finish.");
  }
  if (existing.status !== "placed") throw new Error("BET_ALREADY_SETTLED");

  // Per-game multiplier cap: the cashout endpoint accepts whatever the client
  // sends, but we cap at the bet's own game's `maxMultiplier` so admins keep
  // a hard ceiling per game (lunar/mines/plinko/dice can each have their own).
  // Trusted lookup: existing.gameCode came from a bet row we already wrote,
  // so its config must exist (placement would have rejected an unknown game).
  const cfg = await requireGameConfig(existing.gameCode);
  const liveCap = cfg.maxMultiplier;
  const snapshotCap = input.maxMultiplierCap ?? Number.POSITIVE_INFINITY;
  const cappedMultiplier = existing.gameCode === "roulette"
    ? Number(input.roulettePayoutPaise!) / Number(existing.stakeAmount)
    : Math.min(input.multiplier, liveCap, snapshotCap);
  const stake = existing.stakeAmount;
  // In pari-mutuel mode the wallet credit is deferred to settleRoundPariMutuel
  // — we just mark the bet as cashed-out at multiplier X with payout=0 here.
  // The round-end settlement service later sums every bet, takes 5% as
  // company profit, and splits 95% across winners weighted by stake×multiplier.
  // The legacy 'house_edge' mode keeps the per-bet immediate credit path.
  const isPariMutuel = existing.gameCode !== "roulette" && existing.gameCode !== "vegetable-bowl" && existing.gameCode !== "crazy-time" && ((existing.metadata as { settlementMode?: string } | null)?.settlementMode ?? cfg.settlementMode) === "pari_mutuel";
  // Free bets settle immediately at stake × multiplier straight to the CASH
  // wallet even in pari-mutuel mode: their stake never entered the shared
  // pool (no debit happened), so they cannot participate in the 95/5 split.
  const existingMeta = (existing.metadata ?? null) as
    | { useBonus?: boolean; freeBet?: boolean }
    | null;
  const isFreeBet = !!existingMeta?.freeBet;
  const payout =
    existing.gameCode === "roulette" ? input.roulettePayoutPaise! : existing.gameCode === "crazy-time" ? input.crazyTimePayoutPaise! : existing.gameCode === "vegetable-bowl" ? input.vegetablePayoutPaise! : isPariMutuel && !isFreeBet
      ? 0n
      : BigInt(Math.floor(Number(stake) * cappedMultiplier));
  // CRITICAL: settle the bet status FIRST with a conditional UPDATE on
  // status='placed'. Postgres makes this atomic, so two concurrent cashout
  // requests on the same bet row can never both win the transition — exactly
  // one returns a row, the other returns []. Only the winner credits the
  // wallet, eliminating the prior TOCTOU double-credit race.
  const now = new Date();
  const [updated] = await db
    .update(betsTable)
    .set({
      status: "cashed_out",
      payoutAmount: payout,
      multiplier: cappedMultiplier,
      settledAt: now,
    })
    .where(and(eq(betsTable.id, existing.id), eq(betsTable.status, "placed")))
    .returning();
  if (!updated) {
    // Lost the race; another request already settled this bet.
    throw new Error("BET_ALREADY_SETTLED");
  }
  // Mirror the placeBet branch: remote-wallet partners get a fire-and-forget
  // best-effort credit POST. Failure is non-fatal because the bet.settled
  // webhook (enqueued below) is the durable retry channel — partner's
  // /credit handler MUST be idempotent on betId.
  const partnerForCredit = existing.partnerId
    ? await getPartner(existing.partnerId)
    : null;
  // Strict mode parity with placeBet: a remote-wallet partner must NEVER
  // be credited via the local Lunar ledger, even if their config drifted
  // (callbackUrl removed, partnerPlayerRef missing, etc.) between place
  // and cashout. We let the bet stay 'cashed_out' in our books — the
  // bet.settled webhook below remains the durable retry channel — and
  // record an explicit reconciliation marker via metadata so admins can
  // surface "credit pending" in the partner detail UI.
  const partnerIsRemote =
    !!partnerForCredit && partnerForCredit.walletMode === "remote-wallet";
  const canRemoteCredit =
    partnerIsRemote &&
    !!partnerForCredit?.walletCallbackUrl &&
    !!existing.partnerPlayerRef;
  try {
    if (isPariMutuel && !isFreeBet) {
      // Skip wallet credit entirely — settleRoundPariMutuel pays out at
      // round end. We still emit the settled webhook below so partners see
      // the cashout decision in real time, even though the credit is
      // booked later by the round settlement.
    } else if (partnerIsRemote && !canRemoteCredit) {
      logger.warn(
        {
          betId: existing.id,
          partnerId: existing.partnerId,
          hasCallback: !!partnerForCredit?.walletCallbackUrl,
          hasPlayerRef: !!existing.partnerPlayerRef,
        },
        "remote-wallet partner credit skipped — config drift; relying on bet.settled webhook for reconciliation",
      );
      // Intentionally NO postEntry fallback. Webhook is the path of record.
    } else if (canRemoteCredit && partnerForCredit && existing.partnerPlayerRef) {
      void remoteCredit({
        partner: partnerForCredit,
        playerRef: existing.partnerPlayerRef,
        amountPaise: payout,
        idempotencyKey: `credit_${existing.id}`,
        betId: existing.id,
        gameCode: existing.gameCode,
      });
    } else {
      const meta = (existing.metadata ?? null) as
        | { useBonus?: boolean }
        | null;
      if (meta?.useBonus) {
        if (payout > 0n) {
          await bonusCreditWin({
            userId: input.userId,
            amount: payout,
            betId: existing.id,
            gameCode: existing.gameCode,
          });
        }
        // After credit, attempt auto-conversion if wagering completed.
        // The bonus debit and cash credit run in the same DB transaction
        // (postEntry honours the supplied tx). If the cash credit fails
        // we log the failure loudly so on-call can investigate — funds
        // are never lost because the bonus debit rolls back too.
        try {
          await convertBonusToCashIfReady(input.userId, async (i, tx) => {
            await postEntry(
              {
                userId: i.userId,
                type: i.type,
                amount: i.amount,
                refType: i.refType,
                refId: i.refId,
                memo: i.memo,
              },
              tx,
            );
          });
        } catch (err) {
          logger.error(
            { err, userId: input.userId, betId: existing.id },
            "convertBonusToCashIfReady failed after win — bonus untouched",
          );
        }
      } else {
        await postEntry({
          userId: input.userId,
          type: "win",
          amount: payout,
          scope: toWalletScope(existing.gameCode),
          refType: "bet",
          refId: existing.id,
          memo: `Cash out @${cappedMultiplier.toFixed(2)}×`,
        });
      }
    }
  } catch (err) {
    // Wallet credit failed — revert the bet so we never end up with a
    // settled-but-unpaid row. We must clear the economic fields too
    // (payoutAmount, multiplier) so a 'placed' bet never carries stale
    // settled economics that downstream readers might trust. Conditional
    // on status='cashed_out' so we don't clobber a future re-settlement.
    await db
      .update(betsTable)
      .set({
        status: "placed",
        settledAt: null,
        payoutAmount: 0n,
        multiplier: null,
      })
      .where(and(eq(betsTable.id, existing.id), eq(betsTable.status, "cashed_out")));
    throw err;
  }
  // Bonus and free bets shouldn't accrue agent commissions (no real cash
  // float entered the system).
  if (!existingMeta?.useBonus && !isFreeBet) {
    void accrueCommissionForBet(input.userId, now);
  }
  void userDisplayName(input.userId).then((displayName) => {
    bus.publish({
      topic: "bets:global",
      type: "settled",
      id: updated!.id,
      userId: input.userId,
      displayName,
      gameCode: updated!.gameCode,
      stakeAmount: stake.toString(),
      payoutAmount: payout.toString(),
      multiplier: cappedMultiplier,
      status: "cashed_out",
      ts: Date.now(),
    });
  });
  // admin:metrics is a "something changed" signal; subscribers re-fetch the
  // dashboard for an authoritative snapshot rather than patching deltas, so
  // we publish a single bumped event with no per-field math here.
  bus.publish({
    topic: "admin:metrics",
    type: "bump",
    reason: "bet_settled",
    ts: Date.now(),
  });
  // Defer bet.settled in pari-mutuel mode: the cashout decision is recorded
  // (status=cashed_out, multiplier set, payout=0) but the *final* economics
  // come from settleRoundPariMutuel at round end. Emitting bet.settled now
  // with payout=0 would tell partners the bet was settled for nothing — and
  // there's no compensating event when the real payout lands. So we hold
  // the webhook until settle, where we re-emit per bet with the true payout.
  if (!isPariMutuel) {
    emitSettledWebhook(updated!);
  }
  return updated!;
}

// Exported so settleRoundPariMutuel can re-emit bet.settled at round end
// with the final, post-split payoutAmount filled in.
export const _emitSettledWebhook = emitSettledWebhook;

/**
 * Refund a bet's stake to the originating wallet (cash or bonus). Used by
 * game services when a settlement throws after placeBet. Reads the bet's
 * `useBonus` marker from metadata to route the refund correctly.
 */
export async function refundStake(
  betId: string,
  userId: string,
  stakeAmount: bigint,
): Promise<void> {
  const rows = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.id, betId))
    .limit(1);
  const meta = (rows[0]?.metadata ?? null) as { useBonus?: boolean; freeBet?: boolean; grantId?: string; freeBetRefunded?: boolean } | null;
  if (meta?.freeBet && meta.grantId) {
    await db.transaction(async tx => {
      const updated = await tx.update(betsTable).set({metadata:{...meta,freeBetRefunded:true}})
        .where(and(eq(betsTable.id,betId),sql`COALESCE(${betsTable.metadata}->>'freeBetRefunded','false') <> 'true'`)).returning({id:betsTable.id});
      if (updated.length) await tx.update(freeBetGrantsTable).set({remainingCount:sql`${freeBetGrantsTable.remainingCount} + 1`}).where(and(eq(freeBetGrantsTable.id,meta.grantId!),eq(freeBetGrantsTable.userId,userId)));
    });
    bus.publish({topic:`free-bets:${userId}`,type:"changed",ts:Date.now()});
  } else if (meta?.useBonus) {
    await bonusRefund({ userId, amount: stakeAmount, betId });
  } else {
    await postEntry({
      userId,
      type: "refund",
      amount: stakeAmount,
      scope: toWalletScope(rows[0]?.gameCode),
      refType: "bet",
      refId: betId,
      memo: "Pre-settlement failure — refund",
    });
  }
}

export async function settleLoss(
  betId: string,
  userId: string,
  multiplier?: number | null,
  vegetableTableSettlement = false,
  crazyTimeTableSettlement = false,
  rouletteTableSettlement = false,
): Promise<Bet> {
  const rows = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.id, betId))
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new Error("BET_NOT_FOUND");
  if (existing.userId !== userId) throw new Error("BET_NOT_FOUND");
  if (existing.gameCode === "roulette" && !rouletteTableSettlement) {
    throw badRequest("Roulette bets settle automatically on the winning pocket.");
  }
  if (existing.gameCode === "chicken-road") throw badRequest("Chicken Road outcomes are settled by the game server.");
  if (existing.gameCode === "7up7down") throw badRequest("7 Up 7 Down outcomes are settled by the game server.");
  if (existing.gameCode === "wheel-2-live") throw badRequest("Wheel 2.0 Live outcomes are settled by the game server.");
  if (existing.gameCode === "lucky-7-live") throw badRequest("Lucky 7 Live outcomes are settled by the game server.");
  if (existing.gameCode === "crazy-time" && !crazyTimeTableSettlement) {
    throw badRequest("Crazy Time bets settle automatically after the wheel stops.");
  }
  if (existing.gameCode === "vegetable-bowl" && !vegetableTableSettlement) {
    throw badRequest("Vegetable Bowl bets settle automatically after the harvest.");
  }
  if (existing.gameCode === "bike-racing" || (existing.gameCode === "horse-racing" && [2, 3].includes((existing.metadata as { version?: number } | null)?.version ?? 0))) {
    throw badRequest("Horse race bets settle automatically at the finish.");
  }
  if (existing.status !== "placed") return existing;
  const now = new Date();
  // Conditional update on status='placed' — guarantees only one settleLoss
  // call per bet ever transitions the row, mirroring the cashOutBet pattern.
  // settleLoss has no wallet credit (loss is a no-op on funds), so we don't
  // need a revert path; the loser of the race just returns the existing row.
  const [updated] = await db
    .update(betsTable)
    .set({
      status: "lost",
      payoutAmount: 0n,
      multiplier: multiplier ?? null,
      settledAt: now,
    })
    .where(and(eq(betsTable.id, existing.id), eq(betsTable.status, "placed")))
    .returning();
  if (!updated) {
    // Another path already settled this bet; treat as idempotent success.
    return existing;
  }
  const lossMeta = (existing.metadata ?? null) as
    | { useBonus?: boolean; freeBet?: boolean }
    | null;
  if (!lossMeta?.useBonus && !lossMeta?.freeBet) {
    void accrueCommissionForBet(userId, now);
  } else if (lossMeta?.useBonus) {
    // Wagering may have completed via the loss-leg of this bet (the
    // wager amount is accrued when the bonus stake is debited). Run
    // the conversion check so any leftover bonus auto-converts to
    // cash the moment the threshold is crossed.
    try {
      await convertBonusToCashIfReady(userId, async (i, tx) => {
        await postEntry(
          {
            userId: i.userId,
            type: i.type,
            amount: i.amount,
            refType: i.refType,
            refId: i.refId,
            memo: i.memo,
          },
          tx,
        );
      });
    } catch (err) {
      logger.error(
        { err, userId, betId: existing.id },
        "convertBonusToCashIfReady failed after loss — bonus untouched",
      );
    }
  }
  void userDisplayName(userId).then((displayName) => {
    bus.publish({
      topic: "bets:global",
      type: "settled",
      id: updated!.id,
      userId,
      displayName,
      gameCode: updated!.gameCode,
      stakeAmount: existing.stakeAmount.toString(),
      payoutAmount: "0",
      multiplier: multiplier ?? null,
      status: "lost",
      ts: Date.now(),
    });
  });
  bus.publish({
    topic: "admin:metrics",
    type: "bump",
    reason: "bet_settled",
    ts: Date.now(),
  });
  emitSettledWebhook(updated!);
  return updated!;
}

function encodeCursor(placedAt: Date, id: string): string {
  return Buffer.from(`${placedAt.toISOString()}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { placedAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.indexOf("|");
    if (sep < 0) return null;
    const placedAt = new Date(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (Number.isNaN(placedAt.getTime()) || !id) return null;
    return { placedAt, id };
  } catch {
    return null;
  }
}

export async function listBets(input: {
  userId: string;
  limit: number;
  cursor?: string | null;
}) {
  const conds = [eq(betsTable.userId, input.userId)];
  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (decoded) {
      conds.push(
        or(
          lt(betsTable.placedAt, decoded.placedAt),
          and(
            eq(betsTable.placedAt, decoded.placedAt),
            lt(betsTable.id, decoded.id),
          ),
        )!,
      );
    }
  }
  const rows = await db
    .select()
    .from(betsTable)
    .where(and(...conds))
    .orderBy(desc(betsTable.placedAt), desc(betsTable.id))
    .limit(input.limit + 1);
  const entries = rows.slice(0, input.limit);
  const last = entries[entries.length - 1];
  const nextCursor =
    rows.length > input.limit && last ? encodeCursor(last.placedAt, last.id) : null;
  return { entries, nextCursor };
}
