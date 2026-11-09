/**
 * The result engine's database face: read a stream's state, decide a pocket,
 * write down why, and move the bank when the round settles.
 *
 * Everything that decides is in `selectors.ts` and is pure. Everything that
 * touches a row is here. The split is what lets a decision be replayed from
 * `round_decision` without a database at all.
 *
 * THE ROUND ALWAYS RESOLVES. Every failure path in this file falls through to
 * a uniform draw rather than throwing: a missing audit row is bad, a stranded
 * round holding every stake on the table is worse.
 */
import {
  db,
  gameEngineConfigTable,
  gameBankLedgerTable,
  roundDecisionTable,
  tableRoundBetsTable,
  tableRoundsTable,
  betsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { streamKey, parseStreamKey } from "../../lib/crashStream";
import { SeededRng } from "./rng";
import type { OutcomeSpace, OutcomeSeed } from "../tableAdapter";
import {
  DEFAULT_PARAMS,
  isEngineMode,
  toEngineMode,
  paramsToJson,
  RTP_HISTORY_WINDOW_MS,
  type RtpHistoryScope,
  resolveParams,
  type EngineMode,
  type EngineParams,
} from "./params";
import {
  computeExposure,
  type Exposure,
  type ExposureCandidate,
  type ExposureSlip,
} from "./exposure";
import { decide, type BankState, type PartyTotals, type PlayerTotals, type ResultDecision } from "./selectors";
import { effectiveFloorFor } from "./bankBudget";

/** How many recent outcome classes the streak check keeps. It reads the last 20. */
const RECENT_POCKETS_KEPT = 40;

export interface EngineState {
  streamKey: string;
  gameCode: string;
  partnerId: string | null;
  mode: EngineMode;
  params: EngineParams;
  bankPaise: bigint;
  minBankFloorPaise: bigint;
  zeroBetStreak: number;
  beneficiaryStreak: number;
  lastBeneficiaryUserId: string | null;
  /** Newest first, as choice ids. */
  recentChoiceIds: string[];
}

/**
 * Read a stream's engine row, creating it lazily in "normal".
 *
 * Lazy creation rather than a seed step is deliberate: a partner stream comes
 * into existence the first time somebody launches that partner's table, and
 * there is no moment before that at which a seeder could have run. The default
 * has to be the safe one, which is why the column default is `random` and this
 * function never passes a mode.
 */
export async function engineStateFor(
  gameCode: string,
  partnerId: string | null,
): Promise<EngineState> {
  const key = streamKey(gameCode, partnerId);
  const rows = await db
    .select()
    .from(gameEngineConfigTable)
    .where(eq(gameEngineConfigTable.streamKey, key))
    .limit(1);
  let row = rows[0];
  if (!row) {
    await db
      .insert(gameEngineConfigTable)
      .values({ streamKey: key, gameCode, partnerId })
      .onConflictDoNothing();
    row = (
      await db
        .select()
        .from(gameEngineConfigTable)
        .where(eq(gameEngineConfigTable.streamKey, key))
        .limit(1)
    )[0];
  }
  return {
    streamKey: key,
    gameCode,
    partnerId,
    mode: toEngineMode(row?.mode) ?? "normal",
    params: resolveParams(row?.params),
    bankPaise: row?.bankPaise ?? 0n,
    minBankFloorPaise: row?.minBankFloorPaise ?? 0n,
    zeroBetStreak: row?.zeroBetStreak ?? 0,
    beneficiaryStreak: row?.beneficiaryStreak ?? 0,
    lastBeneficiaryUserId: row?.lastBeneficiaryUserId ?? null,
    // Read leniently: rows written before the engine covered every table hold
    // NUMBERS in this column, and a roulette pocket's class id is its own
    // decimal string. Coercing rather than dropping keeps a stream's streak
    // history continuous across the release that widened it.
    recentChoiceIds: Array.isArray(row?.recentPockets)
      ? (row.recentPockets as unknown[])
          .filter((v) => typeof v === "string" || Number.isInteger(v))
          .map((v) => String(v))
      : [],
  };
}

/**
 * The open book for a round, scored against every candidate outcome.
 *
 * `payoutFor` is the game's own settle with the round's config bound, so what
 * the engine thinks a candidate costs is what settlement will actually pay.
 */
export async function exposureForRound(
  roundId: string,
  candidates: readonly ExposureCandidate[],
  whaleThresholdPct: number,
  payoutFor: (bets: unknown, outcome: unknown, slip?: ExposureSlip) => bigint,
  strict = false,
): Promise<Exposure> {
  // The bet row names who PAYS the slip — the partner, or us. Read here so
  // the balancing stage can weigh the parties on a shared stream; a slip
  // whose bet row is gone counts as ours.
  const slips = await db
    .select({
      userId: tableRoundBetsTable.userId,
      bets: tableRoundBetsTable.bets,
      totalStake: tableRoundBetsTable.totalStake,
      pricingConfig: tableRoundBetsTable.pricingConfig,
      partnerId: betsTable.partnerId,
    })
    .from(tableRoundBetsTable)
    .leftJoin(betsTable, eq(betsTable.id, tableRoundBetsTable.betId))
    .where(
      and(
        eq(tableRoundBetsTable.roundId, roundId),
        // A refunded slip is off the book: its stake went back, so it can
        // neither win nor lose and steering toward it would be steering toward
        // money that is not there.
        eq(tableRoundBetsTable.status, "pending"),
      ),
    );

  const parsed: ExposureSlip[] = slips.map((s) => ({
    userId: s.userId,
    bets: s.bets,
    stakePaise: s.totalStake,
    pricingConfig: s.pricingConfig,
    partyId: s.partnerId ?? "local",
  }));

  return computeExposure(candidates, parsed, whaleThresholdPct, payoutFor, strict);
}

/**
 * The rolling window `auto` averages hold over: turnover and house net across
 * the last `windowRounds` SETTLED rounds of this stream.
 *
 * Read from the bank ledger rather than from the rounds, because the ledger is
 * the thing whose sum IS the bank — a window computed from a different source
 * could disagree with the number it is steering.
 */
async function windowFor(
  key: string,
  windowRounds: number,
): Promise<{ stakedPaise: bigint; houseNetPaise: bigint }> {
  const rows = await db
    .select({
      stakes: gameBankLedgerTable.totalStakesPaise,
      payouts: gameBankLedgerTable.totalPayoutsPaise,
    })
    .from(gameBankLedgerTable)
    .where(eq(gameBankLedgerTable.streamKey, key))
    .orderBy(desc(gameBankLedgerTable.createdAt))
    .limit(Math.max(1, Math.min(windowRounds, 100_000)));
  let staked = 0n;
  let net = 0n;
  for (const r of rows) {
    staked += r.stakes;
    net += r.stakes - r.payouts;
  }
  return { stakedPaise: staked, houseNetPaise: net };
}

/**
 * The ledger is durable across restarts and independent of an operator editing
 * the bank. Aggregate in Postgres rather than transferring all historical rows
 * to the round loop. Manual adjustments are not player stakes or payouts.
 *
 * `scope` is how far back the target is measured: every settled round, only
 * those inside the last day or week (served by
 * `game_bank_ledger_stream_created_idx`), or none at all — under `none` the
 * totals are zero without a query, so each round aims for its own share of
 * the target and no earlier profit or loss is carried into it. The window
 * is measured on the APP clock, like every other date bound in this server,
 * so a container whose Postgres clock drifts cannot move the target.
 */
export async function cumulativeFor(
  key: string,
  scope: RtpHistoryScope = "all",
): Promise<{
  stakedPaise: bigint;
  payoutPaise: bigint;
}> {
  const windowMs = RTP_HISTORY_WINDOW_MS[scope];
  if (windowMs === 0) return { stakedPaise: 0n, payoutPaise: 0n };
  const [row] = await db
    .select({
      stakes: sql<string>`coalesce(sum(${gameBankLedgerTable.totalStakesPaise}), 0)::text`,
      payouts: sql<string>`coalesce(sum(${gameBankLedgerTable.totalPayoutsPaise}), 0)::text`,
    })
    .from(gameBankLedgerTable)
    .where(and(
      eq(gameBankLedgerTable.streamKey, key),
      eq(gameBankLedgerTable.type, "round_settle"),
      windowMs === null
        ? undefined
        : gte(gameBankLedgerTable.createdAt, new Date(Date.now() - windowMs)),
    ));
  return { stakedPaise: BigInt(row?.stakes ?? "0"), payoutPaise: BigInt(row?.payouts ?? "0") };
}

/**
 * Settled stakes and payouts per PARTY on one stream, over the balance's
 * history scope — each sharing partner's own RTP so far. Read off the slips
 * joined to their bet rows (the bet names the payer) and the stream's own
 * settled rounds, so a member's bets on the owner's rounds count for the
 * member. O(history) like `cumulativeFor`; a narrower scope bounds it.
 */
export async function partyTotalsFor(
  gameCode: string,
  partnerId: string | null,
  scope: RtpHistoryScope = "all",
): Promise<PartyTotals> {
  const windowMs = RTP_HISTORY_WINDOW_MS[scope];
  if (windowMs === 0) return {};
  const rows = await db
    .select({
      party: betsTable.partnerId,
      stakes: sql<string>`coalesce(sum(${betsTable.stakeAmount}), 0)::text`,
      payouts: sql<string>`coalesce(sum(${betsTable.payoutAmount}), 0)::text`,
    })
    .from(tableRoundBetsTable)
    .innerJoin(betsTable, eq(betsTable.id, tableRoundBetsTable.betId))
    .innerJoin(tableRoundsTable, eq(tableRoundsTable.id, tableRoundBetsTable.roundId))
    .where(and(
      eq(tableRoundsTable.gameCode, gameCode),
      partnerId ? eq(tableRoundsTable.partnerId, partnerId) : sql`${tableRoundsTable.partnerId} IS NULL`,
      eq(tableRoundBetsTable.status, "settled"),
      windowMs === null ? undefined : gte(tableRoundsTable.settledAt, new Date(Date.now() - windowMs)),
    ))
    .groupBy(betsTable.partnerId);
  const out: PartyTotals = {};
  for (const r of rows) out[r.party ?? "local"] = { stakedPaise: BigInt(r.stakes), payoutPaise: BigInt(r.payouts) };
  return out;
}

/**
 * Settled stakes, payouts and slip counts per PLAYER on one stream, over the
 * RTP history scope, for the players named — the balance weighs only the
 * accounts on the round, so the read is bounded by the table, not the
 * player base. Same join as `partyTotalsFor` (slips → their bet row → the
 * stream's settled rounds), grouped by the slip's user.
 */
export async function playerTotalsFor(
  gameCode: string,
  partnerId: string | null,
  scope: RtpHistoryScope,
  userIds: readonly string[],
): Promise<PlayerTotals> {
  const windowMs = RTP_HISTORY_WINDOW_MS[scope];
  if (windowMs === 0 || userIds.length === 0) return {};
  const rows = await db
    .select({
      userId: tableRoundBetsTable.userId,
      stakes: sql<string>`coalesce(sum(${betsTable.stakeAmount}), 0)::text`,
      payouts: sql<string>`coalesce(sum(${betsTable.payoutAmount}), 0)::text`,
      rounds: sql<string>`count(*)::text`,
    })
    .from(tableRoundBetsTable)
    .innerJoin(betsTable, eq(betsTable.id, tableRoundBetsTable.betId))
    .innerJoin(tableRoundsTable, eq(tableRoundsTable.id, tableRoundBetsTable.roundId))
    .where(and(
      eq(tableRoundsTable.gameCode, gameCode),
      partnerId ? eq(tableRoundsTable.partnerId, partnerId) : sql`${tableRoundsTable.partnerId} IS NULL`,
      eq(tableRoundBetsTable.status, "settled"),
      inArray(tableRoundBetsTable.userId, [...userIds]),
      windowMs === null ? undefined : gte(tableRoundsTable.settledAt, new Date(Date.now() - windowMs)),
    ))
    .groupBy(tableRoundBetsTable.userId);
  const out: PlayerTotals = {};
  for (const r of rows) out[r.userId] = { stakedPaise: BigInt(r.stakes), payoutPaise: BigInt(r.payouts), rounds: Number(r.rounds) };
  return out;
}

export type ResultSourceKind = "admin" | "strategy" | "drawn";

export interface DecidedOutcome {
  /** The outcome the round will settle against. Never null. */
  outcome: unknown;
  source: ResultSourceKind;
  decision: ResultDecision | null;
  /**
   * Everything with a side effect: consuming the armed force, writing the
   * decision row, advancing the streak history.
   *
   * Deferred so the CALLER can run it only once the outcome has actually been
   * written to the round. This function decides; whether that decision became
   * the round's result is settled by a conditional write it cannot see, and a
   * decision that lost that write must leave no trace — otherwise
   * `round_decision` describes a result the round never landed on, and a force
   * is consumed by a spin it did not decide.
   */
  commit: (transaction?: EngineTransaction) => Promise<void>;
  afterCommit?: () => void;
}

/**
 * Decide a round's outcome.
 *
 * Precedence is strict and observable:
 *
 *   1. an admin force armed for this stream — consumed, so it lasts one spin;
 *   2. the result engine, when the mode is not `random` and there is a book;
 *   3. the GAME'S OWN DRAW, which is what every other path falls through to.
 *
 * Step 3 is the important one and it is why this reads the way it does. A round
 * the engine does not steer resolves exactly as it would with no engine at all:
 * same derivation, same odds, same published RTP. The engine only ever
 * REPLACES that outcome, and only when it is actually steering. Drawing
 * uniformly from the candidate list instead would flatten every game whose
 * outcomes are not equally likely — nine per cent of baccarat rounds are ties,
 * and a third of them would be, which is a different game.
 *
 * Nothing here may throw. Each step catches its own failure and falls through,
 * because a round that cannot resolve strands every stake on the table.
 */
export async function decideOutcomeFor(args: {
  gameCode: string;
  partnerId: string | null;
  roundId: string;
  seed: OutcomeSeed;
  space: OutcomeSpace;
  /** The game's settle, with the round's config bound. Returns total payout. */
  payoutFor: (bets: unknown, outcome: unknown, slip?: ExposureSlip) => bigint;
  /** The game's own honest derivation for this round. */
  drawHonest: () => unknown;
  /**
   * The book, when the caller already holds it. The shared tables leave this
   * out and the open slips are read from `table_round_bets`; a single-player
   * game (rummy) has ONE bet and no slip row, so it hands its entry in here.
   */
  book?: readonly ExposureSlip[];
}): Promise<DecidedOutcome> {
  const { gameCode, partnerId, roundId, seed, space } = args;
  const key = streamKey(gameCode, partnerId);

  // 1 — admin force.
  //
  // PEEKED, not taken. Everything with a side effect below — consuming the
  // force, writing the decision row, advancing the streak history — is deferred
  // into `commit`, which the caller runs only once the outcome has actually
  // been written to the round. Done eagerly, a decision that then LOST the
  // conditional write (to the reveal-deadline fallback, most likely, while this
  // was still in flight under pool pressure) left the round settling on one
  // pocket while `round_decision` said an operator had forced another — and the
  // force was gone with nothing to show it had been eaten. That table exists to
  // answer whether a round was chosen or drawn, and this was the one path where
  // it answered wrong.
  try {
    const choiceId = peekForcedResult(gameCode, partnerId);
    if (choiceId !== null) {
      const outcome = space.forChoice(seed, choiceId);
      if (outcome !== null && outcome !== undefined) {
        const state = await engineStateFor(gameCode, partnerId);
        const commit = async (transaction?: EngineTransaction) => {
          await recordDecision(key, gameCode, roundId, {
            choiceIndex: null,
            choiceId,
            // The mode this stream was actually in. Recording "normal" made the
            // decisions table report every operator force as an unsteered round,
            // which is the opposite of what that table is for.
            mode: state.mode,
            houseDeltaPaise: "0",
            candidates: [],
            rngSeed: "",
            reason: "An operator forced this result.",
            alerts: ["FORCED"],
            noise: false,
            whaleUserId: null,
            bankBeforePaise: state.bankPaise.toString(),
          }, transaction);
          // A forced round is still a round this wheel landed on, so it belongs
          // in the recent history. Left out, `streaking()` — whose whole job is
          // to notice the table forming a visible pattern — counted none of
          // them, so an operator forcing one pocket repeatedly with the repeat
          // override never tripped the guard, and the admin card's recent list
          // showed a history with the forced results missing.
          await noteRoundOutcome(
            state,
            { outcomes: [], totalStakedPaise: 0n, betCount: 0, whaleUserId: null },
            { choiceIndex: null } as ResultDecision,
            choiceId, transaction,
          );
        };
        return { outcome, source: "admin", decision: null, commit, afterCommit: () => { if (peekForcedResult(gameCode, partnerId) === choiceId) takeForcedResult(gameCode, partnerId); } };
      }
      // The class was legal but no real outcome could be built for it — a deal
      // the sampler never found. Better an honest round than a stuck one.
      logger.warn(
        { gameCode, roundId, choiceId },
        "[result-engine] forced class produced no outcome — drawing honestly",
      );
    }
  } catch (err) {
    // A blip must never block a round. "None armed" is the safe reading of
    // "could not tell".
    logger.warn({ err, gameCode, roundId }, "[result-engine] forced-result read failed");
  }

  // 2 — the engine.
  try {
    const state = await engineStateFor(gameCode, partnerId);
    // `random` reads nothing, so build no candidates for it. That is not only
    // a saving: sampling deals costs real work per round on a table that will
    // never look at them.
    const candidates: ExposureCandidate[] =
      state.mode === "normal"
        ? []
        : space.candidates(seed).map((c) => {
            const choice = space.choices().find((x) => x.id === c.choiceId);
            return {
              id: c.choiceId,
              label: choice?.label ?? c.choiceId,
              group: choice?.group,
              tone: choice?.tone,
              outcome: c.outcome,
            };
          });
    const exposure =
      candidates.length === 0
        ? { outcomes: [], totalStakedPaise: 0n, betCount: 0, whaleUserId: null }
        : args.book
          ? computeExposure(
              candidates,
              args.book,
              state.params.whaleThresholdPct,
              args.payoutFor,
              true,
            )
          : await exposureForRound(
            roundId,
            candidates,
            state.params.whaleThresholdPct,
            args.payoutFor,
            true,
          );
    const win =
      state.mode === "auto"
        ? await windowFor(state.streamKey, state.params.windowRounds)
        : { stakedPaise: 0n, houseNetPaise: 0n };
    const bank: BankState = {
      bankPaise: state.bankPaise,
      minBankFloorPaise: state.minBankFloorPaise,
      zeroBetStreak: state.zeroBetStreak,
      beneficiaryStreak: state.beneficiaryStreak,
      lastBeneficiaryUserId: state.lastBeneficiaryUserId,
      recentChoiceIds: state.recentChoiceIds,
      windowStakedPaise: win.stakedPaise,
      windowHouseNetPaise: win.houseNetPaise,
    };
    // The scope's shared loss budget, if it runs one. `per_game` — the
    // default, and every scope nobody has configured — returns an empty
    // object, so the floor test keeps reading this stream's own bank and
    // floor exactly as it always has.
    Object.assign(bank, await effectiveFloorFor(partnerId));
    if (state.mode === "rtp") {
      const totals = await cumulativeFor(state.streamKey, state.params.rtpHistoryScope);
      bank.cumulativeStakedPaise = totals.stakedPaise;
      bank.cumulativePayoutPaise = totals.payoutPaise;
    }
    // Only read when it can act: the switch is on and more than one party
    // has a chip on this round.
    if (state.params.partyBalanceEnabled && (exposure.partyStakes?.size ?? 0) > 1) {
      bank.partyTotals = await partyTotalsFor(gameCode, partnerId, state.params.partyHistoryScope);
      bank.partyTargetBps = state.params.partyTargetRtpBps || 10_000 - state.params.rtpHoldBps;
    }
    // Likewise the player balance: only read when a switch is on, and only
    // for the accounts on this round. Measured over the RTP history scope,
    // the one window the stream's target is already measured over.
    if ((state.params.playerCapEnabled || state.params.playerLiftEnabled) && (exposure.playerStakes?.size ?? 0) > 0) {
      bank.playerTotals = await playerTotalsFor(gameCode, partnerId, state.params.rtpHistoryScope, [...exposure.playerStakes!.keys()]);
    }
    const rng = SeededRng.fresh();
    const decision = decide(
      state.mode,
      exposure,
      state.params,
      bank,
      rng,
      rng.seed,
      space.naturalOdds?.(),
      space.extraStreak?.bind(space),
    );

    const steered = decision.choiceIndex !== null;
    const outcome = steered
      ? candidates[decision.choiceIndex!]!.outcome
      : args.drawHonest();

    // Record the class the round ACTUALLY landed on, steered or not. A history
    // that only held the steered rounds could not answer the one question it
    // exists for.
    const landedChoiceId = steered
      ? decision.choiceId
      : (space.classify(outcome) ?? null);
    const commit = async (transaction?: EngineTransaction) => {
      await recordDecision(key, gameCode, roundId, {
        ...decision,
        choiceId: landedChoiceId,
      }, transaction);
      await noteRoundOutcome(state, exposure, decision, landedChoiceId, transaction);
    };
    return {
      outcome,
      commit,
      // `drawn` is the honest label for a round the engine did not steer.
      // Collapsing it with `strategy` would make the result source useless for
      // the only question it is ever asked: was this round chosen or drawn?
      source: steered ? "strategy" : "drawn",
      decision,
    };
  } catch (err) {
    logger.error(
      { err, gameCode, roundId },
      "[result-engine] failed — the game draws its own result instead",
    );
    const outcome = args.drawHonest();
    // Best effort, and deferred like the others: if the round does not end up
    // settling on this, there is nothing to note.
    const commit = async (transaction?: EngineTransaction) => {
      await recordDecision(key, gameCode, roundId, {
        choiceIndex: null,
        choiceId: space.classify(outcome) ?? null,
        mode: "normal",
        houseDeltaPaise: "0",
        candidates: [],
        rngSeed: "",
        reason: "FALLBACK: the result engine failed; the game drew its own result.",
        alerts: ["ENGINE_FAILED"],
        noise: true,
        whaleUserId: null,
        bankBeforePaise: "0",
      }, transaction);
    };
    return { outcome, source: "drawn", decision: null, commit };
  }
}

/**
 * Write down why the round landed where it did.
 *
 * ON CONFLICT DO NOTHING on the round, so a retry reads back the ORIGINAL
 * decision rather than overwriting it with a fresh one. `meta` is round-tripped
 * through JSON so what is stored is exactly what comes back — a bigint or an
 * undefined reaching jsonb would be stored as something other than what was
 * decided.
 */
async function recordDecision(
  key: string,
  gameCode: string,
  roundId: string,
  decision: ResultDecision,
  transaction?: EngineTransaction,
): Promise<void> {
  await (transaction ?? db)
    .insert(roundDecisionTable)
    .values({
      roundId,
      streamKey: key,
      gameCode,
      mode: decision.mode,
      // The numeric form of the class where it has one, which is every wheel
      // pocket and every Lucky 7 total. Null for a class that is a word.
      winningPocket:
        decision.choiceId !== null && /^\d+$/u.test(decision.choiceId)
          ? Number(decision.choiceId)
          : null,
      winningChoice: decision.choiceId,
      houseDeltaPaise: BigInt(decision.houseDeltaPaise || "0"),
      meta: JSON.parse(JSON.stringify(decision)) as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: roundDecisionTable.roundId });
}

/**
 * Advance the streak counters and the recent-pocket window.
 *
 * These live on the row rather than being recomputed, because both are about
 * CONSECUTIVE rounds and this runs before the round they belong to has settled
 * — a query over settled rounds cannot see it yet.
 */
async function noteRoundOutcome(
  state: EngineState,
  exposure: Exposure,
  decision: ResultDecision,
  landedChoiceId: string | null,
  transaction?: EngineTransaction,
): Promise<void> {
  // The position the round LANDED on, which on an unsteered round is looked up
  // by class rather than by the index nobody picked.
  const landed =
    decision.choiceIndex !== null
      ? exposure.outcomes[decision.choiceIndex]
      : exposure.outcomes.find((o) => o.choiceId === landedChoiceId);

  // `normal` builds NO candidates on purpose, so there is no exposure to look
  // the landed outcome up in and every lookup here misses. Read as "nobody
  // backed it", that made the unbacked streak a plain round counter: it climbed
  // on every round the stream spent in `normal` and never reset. Measured on the
  // shared wheel — a round with all 38 pockets backed still took it 185 to 186,
  // and the stream sat at 185 after a day.
  //
  // It matters on the FIRST steered round after an operator changes the mode.
  // `eligible()` sees the streak past its maximum and narrows the pool to
  // outcomes somebody backed, which strips the zeros — on any ordinary book the
  // two best collecting pockets on the wheel. Collect was at its weakest on the
  // one round it had just been asked to collect.
  //
  // A round the engine never priced tells us nothing about whether it was
  // backed, so leave the streak where it is rather than inventing an answer.
  const priced = exposure.outcomes.length > 0;
  const backed = (landed?.betCount ?? 0) > 0;
  const beneficiary = landed?.topWinnerUserId ?? null;
  // A "giving" round for distribute is one the house lost. RTP's beneficiary
  // guard counts every round the same account TOPPED, house win or not: the
  // streak it exists to break (one account paid 6x on 14 of 15 rounds while
  // the house held 15–25 % of each, 2026-09-19) never once cost the house the
  // round, so under the distribute rule the counter would have sat at zero.
  const gave = (landed?.houseNetPaise ?? 0n) < 0n ||
    (decision.mode === "rtp" && beneficiary !== null);
  await (transaction ?? db)
    .update(gameEngineConfigTable)
    .set({
      zeroBetStreak: !priced
        ? state.zeroBetStreak
        : backed
          ? 0
          : state.zeroBetStreak + 1,
      // Same argument: an unpriced round has no beneficiary to have seen, so it
      // must not reset a streak it knows nothing about.
      beneficiaryStreak: !priced
        ? state.beneficiaryStreak
        : gave && beneficiary && beneficiary === state.lastBeneficiaryUserId
          ? state.beneficiaryStreak + 1
          : gave && beneficiary
            ? 1
            : 0,
      lastBeneficiaryUserId: gave ? beneficiary : state.lastBeneficiaryUserId,
      recentPockets: (landedChoiceId === null
        ? state.recentChoiceIds
        : [landedChoiceId, ...state.recentChoiceIds]
      ).slice(0, RECENT_POCKETS_KEPT),
    })
    .where(eq(gameEngineConfigTable.streamKey, state.streamKey));
}

/**
 * Move the bank by `stakes − payouts` and write the ledger row, when a round
 * settles.
 *
 * The unique (roundId, type) makes this idempotent: a retried settlement
 * re-runs the insert, the constraint refuses it, and the bank is not moved
 * twice. The bank update is guarded by the same insert succeeding — do them the
 * other way round and a retry that fails at the ledger has already moved money.
 */
export type EngineTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function settleBank(args: {
  gameCode: string;
  partnerId: string | null;
  roundId: string;
  totalStakePaise: bigint;
  totalPayoutPaise: bigint;
}, transaction?: EngineTransaction): Promise<void> {
  const key = streamKey(args.gameCode, args.partnerId);
  const delta = args.totalStakePaise - args.totalPayoutPaise;
  const write = async (tx: EngineTransaction) => {
    await tx.insert(gameEngineConfigTable)
      .values({ streamKey: key, gameCode: args.gameCode, partnerId: args.partnerId })
      .onConflictDoNothing();
    // Serialise settlements on the stream so balanceAfter is the balance this
    // ledger entry actually produced, including concurrent recovery attempts.
    const [state] = await tx.select().from(gameEngineConfigTable)
      .where(eq(gameEngineConfigTable.streamKey, key)).for("update");
    if (!state) throw new Error("Engine stream missing during settlement");
    const after = state.bankPaise + delta;
    const [row] = await tx
      .insert(gameBankLedgerTable)
      .values({
        streamKey: key,
        gameCode: args.gameCode,
        roundId: args.roundId,
        type: "round_settle",
        deltaPaise: delta,
        balanceAfterPaise: after,
        totalStakesPaise: args.totalStakePaise,
        totalPayoutsPaise: args.totalPayoutPaise,
      })
      .onConflictDoNothing({
        target: [gameBankLedgerTable.roundId, gameBankLedgerTable.type],
      })
      .returning({ id: gameBankLedgerTable.id });
    if (!row) return; // already counted

    await tx
      .update(gameEngineConfigTable)
      .set({
        bankPaise: sql`${gameEngineConfigTable.bankPaise} + ${delta}`,
      })
      .where(eq(gameEngineConfigTable.streamKey, key));

    await maybeHandBack(key, { mode: toEngineMode(state.mode) ?? "normal", params: resolveParams(state.params) }, after, tx);
  };
  // The terminal round transition can share this transaction. A failure leaves
  // the round recoverable; retries never pay a player or bank a round twice.
  if (transaction) await write(transaction);
  else await db.transaction(write);
}

/**
 * A mode that has finished its job hands the wheel back to `auto`.
 *
 * Recorded with `updatedBy` left NULL, which is how an operator tells this
 * apart from a person changing the mode.
 */
async function maybeHandBack(
  key: string,
  state: Pick<EngineState, "mode" | "params">,
  bankAfter: bigint,
  tx: EngineTransaction,
): Promise<void> {
  const target = state.params.targetBankPaise;
  if (target === null) return;
  const done =
    (state.mode === "collect" && bankAfter >= target) ||
    (state.mode === "distribute" && bankAfter <= target);
  if (!done) return;
  await tx
    .update(gameEngineConfigTable)
    .set({ mode: "auto", updatedBy: null, updatedAt: new Date() })
    .where(eq(gameEngineConfigTable.streamKey, key));
  logger.info(
    { streamKey: key, from: state.mode, bankAfter: bankAfter.toString() },
    "[result-engine] target reached — handing back to auto",
  );
}

// ---------------------------------------------------------------------------
// Forced results
// ---------------------------------------------------------------------------

/**
 * An operator's forced pocket, held in memory with a 5-minute expiry and
 * consumed by the next spin on that stream.
 *
 * In memory rather than in Redis because this process is the one that runs the
 * round loop for a stream it holds — the same reason `tableRounds.ts` keeps its
 * timers here. A force that does not survive a restart is the safe failure: the
 * wheel goes back to deciding for itself.
 */
const FORCE_TTL_MS = 5 * 60_000;
const forced = new Map<string, { choiceId: string; expiresAt: number }>();

/** How many times a class may appear in the recent window before a force is refused. */
export const FORCE_NO_REPEAT_ROUNDS = 8;
export const FORCE_MAX_REPEATS_IN_WINDOW = 2;

export class ForceRefused extends Error {
  constructor(
    readonly code: "INVALID_CHOICE" | "RECENTLY_DRAWN" | "OFF_ENGINE",
    message: string,
  ) {
    super(message);
  }
}

export async function setForcedResult(args: {
  gameCode: string;
  partnerId: string | null;
  choiceId: string;
  space: OutcomeSpace;
  allowRepeat?: boolean;
}): Promise<void> {
  const choice = args.space.choices().find((c) => c.id === args.choiceId);
  if (!choice) {
    // Checked against the game's OWN space, not merely parsed. An outcome off
    // the layout does not fail loudly at settlement — it settles every bet on
    // the table as a loss and reads in every report as an ordinary
    // house-favourable round.
    throw new ForceRefused(
      "INVALID_CHOICE",
      `${args.choiceId} is not a result ${args.gameCode} can land on`,
    );
  }
  if (!args.allowRepeat) {
    const recent = await recentSettledChoiceIds(
      args.gameCode,
      args.partnerId,
      FORCE_NO_REPEAT_ROUNDS,
      args.space,
    );
    const seen = recent.filter((c) => c === args.choiceId).length;
    if (seen >= FORCE_MAX_REPEATS_IN_WINDOW) {
      throw new ForceRefused(
        "RECENTLY_DRAWN",
        `${choice.label} has already come up ${seen} times in the last ${FORCE_NO_REPEAT_ROUNDS} rounds`,
      );
    }
  }
  forced.set(streamKey(args.gameCode, args.partnerId), {
    choiceId: args.choiceId,
    expiresAt: Date.now() + FORCE_TTL_MS,
  });
  if (args.allowRepeat) {
    logger.warn(
      { gameCode: args.gameCode, partnerId: args.partnerId, choiceId: args.choiceId },
      "[result-engine] FORCED REPEAT — an operator overrode the repeat guard deliberately",
    );
  }
}

export function peekForcedResult(
  gameCode: string,
  partnerId: string | null,
): string | null {
  const hit = forced.get(streamKey(gameCode, partnerId));
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    forced.delete(streamKey(gameCode, partnerId));
    return null;
  }
  return hit.choiceId;
}

/**
 * Every result armed right now, across every stream.
 *
 * The panel needs it because a force does NOT require an engine row: a partner
 * who has never spun a table has no row and so no card, and without this an
 * operator could arm a result there and then have no way to see or clear it.
 * Expired entries are dropped on read rather than swept, which is the same
 * thing `peekForcedResult` does and for the same reason — there is no timer to
 * own.
 */
export function listArmedForces(): { streamKey: string; choiceId: string }[] {
  const now = Date.now();
  const out: { streamKey: string; choiceId: string }[] = [];
  for (const [key, hit] of forced) {
    if (hit.expiresAt <= now) {
      forced.delete(key);
      continue;
    }
    out.push({ streamKey: key, choiceId: hit.choiceId });
  }
  return out;
}

export function clearForcedResult(gameCode: string, partnerId: string | null): void {
  forced.delete(streamKey(gameCode, partnerId));
}

/** Read AND delete, so a force lasts exactly one round. */
function takeForcedResult(gameCode: string, partnerId: string | null): string | null {
  const c = peekForcedResult(gameCode, partnerId);
  if (c !== null) clearForcedResult(gameCode, partnerId);
  return c;
}

/**
 * The last N classes this stream actually settled on.
 *
 * `settled` only: a round in flight has no result to repeat, and a voided one
 * never produced one. Classified through the game's own space, so the repeat
 * guard counts the same thing the operator is choosing.
 */
async function recentSettledChoiceIds(
  gameCode: string,
  partnerId: string | null,
  limit: number,
  space: OutcomeSpace,
): Promise<string[]> {
  const rows = await db
    .select({ outcome: tableRoundsTable.outcome })
    .from(tableRoundsTable)
    .where(
      and(
        eq(tableRoundsTable.gameCode, gameCode),
        eq(tableRoundsTable.phase, "settled"),
        partnerId === null
          ? sql`${tableRoundsTable.partnerId} IS NULL`
          : eq(tableRoundsTable.partnerId, partnerId),
      ),
    )
    .orderBy(desc(tableRoundsTable.settledAt))
    .limit(limit);
  return rows
    .map((r) => {
      try {
        return space.classify(r.outcome);
      } catch {
        return null;
      }
    })
    .filter((c): c is string => typeof c === "string");
}

export { parseStreamKey, streamKey };
