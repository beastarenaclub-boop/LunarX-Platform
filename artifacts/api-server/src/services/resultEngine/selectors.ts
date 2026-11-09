/**
 * How a steered table picks its outcome.
 *
 * Pure: every input is an argument, nothing here reads a database or a clock,
 * and the only randomness is the `SeededRng` handed in. That is what makes a
 * decision replayable — feed the recorded params, exposure and seed back in and
 * the same choice comes out, which is the entire reason `round_decision` stores
 * a seed rather than just an answer.
 *
 * Read `decide()` first; everything else is a branch of it.
 *
 * Two things a reader needs before going further.
 *
 * OUTSIDE `random` mode the outcome is CHOSEN FROM THE OPEN BOOK, not drawn.
 * Outcomes are not equally likely, and nothing on the player wire distinguishes
 * a steered round from a drawn one. Do not build a client, a test or a report
 * that assumes uniformity on a steered table.
 *
 * A decision of `choiceIndex: null` means DRAW HONESTLY: the caller resolves the
 * round exactly as it would with no engine at all, through the game's own
 * derivation. Every non-steering path returns that rather than picking a
 * candidate uniformly, and the difference is not cosmetic — picking uniformly
 * from a candidate list would flatten games whose outcomes are not equally
 * likely, quietly rewriting the odds of every card game in `random` mode.
 */
import type { SeededRng } from "./rng";
import { clamp01, type EngineMode, type EngineParams } from "./params";
import type { Exposure, OutcomePosition } from "./exposure";

export type AlertCode =
  | "BANK_FLOOR_UNREACHABLE"
  | "ZERO_BET_STREAK"
  | "BENEFICIARY_STREAK"
  | "DIVERSIFIED"
  | "ENGINE_FAILED"
  | "RTP_LOSS_RECOVERY"
  | "RTP_MINIMUM_LOSS"
  /** RTP set aside the result that would otherwise have landed, because it had already run `rtpMaxRepeat` rounds. */
  | "RTP_REPEAT_GUARD"
  /** An operator declared this result; the engine chose nothing. */
  | "FORCED"
  /** The sharing-partner balance narrowed the pool this round. */
  | "PARTY_BALANCED"
  /** No result kept every sharing partner inside the band / free of loss; the least-bad ones were kept. */
  | "PARTY_BAND_UNREACHABLE"
  /** The player balance narrowed the pool this round. */
  | "PLAYER_BALANCED"
  /** No result kept every weighed player inside the band; the least-bad ones were kept. */
  | "PLAYER_BAND_UNREACHABLE";

export interface Candidate {
  choiceId: string;
  label: string;
  houseNetPaise: string;
  weight: number;
}

export interface ResultDecision {
  /**
   * Index into the exposure's candidate list, or NULL for "draw honestly".
   * Null is the common case: `random` mode, an empty book, a noise round and
   * every failure all return it.
   */
  choiceIndex: number | null;
  /** The class chosen, or null when drawing honestly. */
  choiceId: string | null;
  mode: EngineMode;
  houseDeltaPaise: string;
  candidates: Candidate[];
  rngSeed: string;
  reason: string;
  alerts: AlertCode[];
  /** True when the ranking was discarded and the round left to its own draw. */
  noise: boolean;
  whaleUserId: string | null;
  bankBeforePaise: string;
  /** The sharing-partner balance, when it ran. Strings only: this is stored as JSON. */
  party?: PartyRecord;
  /** The player balance, when it ran. */
  players?: PlayerRecord;
  /** Integer inputs needed to explain/replay an RTP decision. */
  rtp?: {
    holdBps: number;
    recoveryMode: EngineParams["rtpRecoveryMode"];
    /** How far back the settled totals below were measured. */
    historyScope: EngineParams["rtpHistoryScope"];
    /** Share of the running gap repaid this round, in basis points (10000 = all of it). */
    aggressivenessBps: number;
    noiseRate: number;
    settledStakesPaise: string;
    settledPayoutsPaise: string;
    roundStakesPaise: string;
    /** The payout the ranking aimed for, in whole paise (informational; replay from the integers above). */
    wantedPayoutPaise: string;
    /** The per-round ceiling on the aim, in bps of the round's stake (0 = none), and whether it bit this round. */
    roundCapBps: number;
    wantedCapped: boolean;
    selectedPayoutPaise: string;
    /** Distance from the CUMULATIVE target after this pick, whatever the aggressiveness. */
    targetErrorBpsPaise: string;
    minBankFloorPaise: string;
    /** The repeat guard's inputs: the leading run of the stream's history it read, and what it set aside. */
    maxRepeat: number;
    recentChoiceIds: string[];
    repeatExcluded: string[];
    /** The beneficiary guard's inputs: the streak it read, whose it was, and the results it set aside. */
    maxBeneficiaryStreak: number;
    beneficiaryStreak: number;
    lastBeneficiaryUserId: string | null;
    beneficiaryExcluded: string[];
    /** The near-tie band: the setting in bps and the tolerance it came to on this round's stake, in paise. */
    tieBandBps: number;
    tieBandPaise: string;
    /**
     * The draw: the payouts either side of the aim (null on a side nothing on
     * the board reaches), the odds of the high one in bps — chosen so the two
     * sides' MEAN is the aim — and the side it landed on, before the tie band.
     */
    bracketLowPaise: string | null;
    bracketHighPaise: string | null;
    highChanceBps: number;
    drawnPayoutPaise: string;
    evaluated: { index: number; choiceId: string; payoutPaise: string }[];
  };
}

/** Settled history per party, over the balance's own scope — what each partner's RTP is measured on. */
export type PartyTotals = Record<string, { stakedPaise: bigint; payoutPaise: bigint }>;

export interface PartyRecord {
  mode: EngineParams["partyBalanceMode"];
  targetBps: number;
  bandBps: number;
  historyScope: EngineParams["partyHistoryScope"];
  parties: { id: string; roundStakePaise: string; stakedBeforePaise: string; payoutBeforePaise: string; rtpBeforeBps: number | null }[];
  /** Pool sizes before and after the stage. */
  narrowedFrom: number;
  narrowedTo: number;
  /** Whether at least one result satisfied the rule outright (else the least-bad were kept). */
  satisfied: boolean;
  evaluated: { choiceId: string; worstRtpDevBps: number | null; worstShortfallPaise: string | null; worstLossPaise: string }[];
}

/** Settled history per player on the round, over the RTP history scope — what each player's RTP is measured on. */
export type PlayerTotals = Record<string, { stakedPaise: bigint; payoutPaise: bigint; rounds: number }>;

export interface PlayerRecord {
  capEnabled: boolean;
  liftEnabled: boolean;
  targetBps: number;
  bandBps: number;
  minRounds: number;
  historyScope: EngineParams["rtpHistoryScope"];
  /** Every player on the round; `weighed` says whether they had the history to count. */
  players: { id: string; roundStakePaise: string; stakedBeforePaise: string; payoutBeforePaise: string; roundsBefore: number; rtpBeforeBps: number | null; weighed: boolean }[];
  narrowedFrom: number;
  narrowedTo: number;
  /** Whether at least one result kept every weighed player inside the band (else the least-bad were kept). */
  satisfied: boolean;
  evaluated: { choiceId: string; worstDevBps: number; worstShortfallPaise: string }[];
}

/**
 * The bank the floor is measured against, and the floor itself.
 *
 * ONE definition, because three places gate on the floor and a fourth records
 * it — and the floor is the engine's only HARD limit, so two of them drifting
 * apart is a money bug nobody sees until it has already paid out. A scope
 * running one shared budget redirects both of these; everything else on
 * `BankState` stays the stream's own.
 */
export function effectiveBankPaise(bank: BankState): bigint {
  return bank.budgetBankPaise ?? bank.bankPaise;
}
export function effectiveFloorPaise(bank: BankState): bigint {
  return bank.budgetFloorPaise ?? bank.minBankFloorPaise;
}
export function aboveFloor(bank: BankState, houseNetPaise: bigint): boolean {
  return effectiveBankPaise(bank) + houseNetPaise >= effectiveFloorPaise(bank);
}

export interface BankState {
  bankPaise: bigint;
  /** Present when the sharing-partner balance is on: per-party history and the target it holds to. */
  partyTotals?: PartyTotals;
  partyTargetBps?: number;
  /** Present when the player balance is on: the settled history of each player on the round. */
  playerTotals?: PlayerTotals;
  minBankFloorPaise: bigint;
  /**
   * The scope's shared budget, when it has one (`resultEngine/bankBudget.ts`).
   *
   * `bankPaise` and `minBankFloorPaise` stay the STREAM's own and keep driving
   * everything else — auto's target, the hand-back, `bankBeforePaise` on the
   * record. These two redirect the FLOOR TEST alone: `budgetFloorPaise` is one
   * figure for every game in the scope, and `budgetBankPaise` (combined mode
   * only) is the sum of their banks to measure it against. Both absent on a
   * scope nobody has configured, which is the shipped behaviour.
   */
  budgetFloorPaise?: bigint;
  budgetBankPaise?: bigint;
  zeroBetStreak: number;
  beneficiaryStreak: number;
  lastBeneficiaryUserId: string | null;
  /** Newest first, as choice ids. */
  recentChoiceIds: string[];
  /** Rolling turnover and house net over the last `windowRounds` rounds, for `auto`. */
  windowStakedPaise: bigint;
  windowHouseNetPaise: bigint;
  /** All recorded settled rounds of this stream, independent of bank edits. */
  cumulativeStakedPaise?: bigint;
  cumulativePayoutPaise?: bigint;
}

const abs = (v: bigint) => (v < 0n ? -v : v);

/** The run at the head of a newest-first history: which result, how many times. */
export function leadingRun(recent: readonly string[]): { id: string; count: number } | null {
  const id = recent[0];
  if (id === undefined) return null;
  let count = 0;
  for (const r of recent) {
    if (r !== id) break;
    count++;
  }
  return { id, count };
}

/**
 * The results a guard may stand in for `setAside`: those `keep` admits that
 * pay no more than the cheapest set-aside result. Empty when nothing is set
 * aside or nothing is that cheap — a guard may make a round cheaper, never
 * be the reason it pays out.
 */
function noDearer(
  pool: OutcomePosition[],
  setAside: OutcomePosition[],
  keep: (p: OutcomePosition) => boolean,
): OutcomePosition[] {
  if (setAside.length === 0) return [];
  let cheapest = setAside[0]!.payoutPaise;
  for (const p of setAside) if (p.payoutPaise < cheapest) cheapest = p.payoutPaise;
  return pool.filter((p) => keep(p) && p.payoutPaise <= cheapest);
}

/** The share of the running gap RTP repays at aggressiveness 0, in bps. */
export const RTP_MIN_CORRECTION_BPS = 500;
/** Aggressiveness 0..1 → the share of the running gap repaid this round, bps. */
export function rtpCorrectionBps(aggressiveness: number): number {
  return RTP_MIN_CORRECTION_BPS + Math.round(clamp01(aggressiveness) * (10_000 - RTP_MIN_CORRECTION_BPS));
}

/**
 * Compare complete-round payouts, including returned stakes. Cross multiplying
 * keeps both the target and the error exact even beyond Number's safe range.
 * This mode uses the bank floor, draws between the two payouts either side
 * of the aim so that the EXPECTED payout is the aim (the draw, below), and
 * randomises ties, exact or near.
 *
 * Two of the shared parameters are read here, with RTP's own meaning:
 *
 *  Each has an on/off switch (`rtpNoiseEnabled`, `rtpAggressivenessEnabled`):
 *  off, no round is left to an honest draw at all — the 2% floor on
 *  `noiseRate` is a bound on the number, not on the switch — and the gap is
 *  closed in full every round.
 *
 *  - `noiseRate`: the share of rounds that ignore the engine and draw
 *    honestly, rolled BEFORE anything is ranked (the same argument as the
 *    other modes — rolled afterwards it could depend on how the ranking
 *    looked). A noise round still counts in the ledger, so the steered rounds
 *    around it absorb whatever it paid. It applies while recovering too:
 *    "recover first" with no honest rounds is a stretch where nobody wins,
 *    which is the pattern noise exists to break.
 *  - `aggressiveness`: how much of the RUNNING GAP from the target is repaid
 *    on this round, mapped onto 5%..100% (`RTP_MIN_CORRECTION_BPS`). At 1
 *    the pick aims to close the whole gap now (the original behaviour); at
 *    0.5 a little over half; at 0 five per cent, the gentlest correction.
 *    It cannot reach zero: a gap is always being repaid. (The floor predates
 *    the draw below — under "closest" with no memory the wheel's payout
 *    steps biased every pick the same way and a 90% stream settled at 85.3%
 *    over 3,000 random books; the draw removed that bias, the floor stays.)
 *    Five per cent a round still repays 95% of any gap within ~60 rounds.
 *    Every value is distinct; there is no dead zone.
 *
 * The other modes' streak filters stay out: they discard the ranking for an
 * honest draw, which is the one thing this mode promises not to do. It has
 * two guards of its own instead, and both keep ranking:
 *
 *  - `rtpMaxRepeat`: a result that has already landed that many rounds in a
 *    row is SET ASIDE for this round and the next-closest is taken. Measured
 *    on 2026-09-16: a stream in deficit wants more than any result on the
 *    board can pay, so "closest" is the highest-paying pocket for that
 *    layout — a fixed answer for a fixed book — and a Prev-Bet layout landed
 *    pocket 10 six rounds running, paid at 118% each time. The floor still
 *    outranks the guard: the only floor-legal result is taken however long
 *    its run. The history counts every landed round, steered or drawn,
 *    because the repeat is what the player sees. The guard only ever swaps
 *    in a result that pays no more than the repeated one, so it can never be
 *    the reason a round pays out — on a two-result game a forced flip was a
 *    guaranteed, readable win (2026-10-12).
 *  - `rtpTieBandPct`: results within that share of the round's stake of the
 *    payout the draw landed on are ties and drawn at random, instead of only
 *    EXACT ties.
 *    Bounded by the round's own stake, not the cumulative history, so it
 *    cannot widen into "everything is a tie" on a mature stream.
 */
function rtp(
  rng: SeededRng,
  exposure: Exposure,
  bank: BankState,
  params: EngineParams,
  seed: string,
): ResultDecision {
  const stakes = bank.cumulativeStakedPaise;
  const payouts = bank.cumulativePayoutPaise;
  if (stakes === undefined || payouts === undefined) {
    throw new Error("RTP totals are required before selecting a result");
  }
  const alerts: AlertCode[] = [];
  const noiseRate = params.rtpNoiseEnabled ? clamp01(params.noiseRate) : 0;
  if (noiseRate > 0 && rng.next() < noiseRate) {
    return drawHonestly(
      exposure,
      "rtp",
      bank,
      "Noise round — discarded the ranking and left it to its own draw.",
      alerts,
      true,
      seed,
    );
  }
  let pool = exposure.outcomes.filter(
    (p) => aboveFloor(bank, p.houseNetPaise),
  );
  const floorUnreachable = pool.length === 0;
  if (floorUnreachable) {
    alerts.push("BANK_FLOOR_UNREACHABLE");
    pool = exposure.outcomes;
  }
  const recovering = params.rtpRecoveryMode === "recover" && payouts > stakes;
  const allLose = pool.every((p) => p.houseNetPaise < 0n);
  // In target mode an intentional loss can be necessary to give back excess
  // hold. In recover mode an unavoidable loss is always minimised.
  const minimisePayout = floorUnreachable || recovering ||
    (params.rtpRecoveryMode === "recover" && allLose);
  if (recovering) alerts.push("RTP_LOSS_RECOVERY");
  if (minimisePayout && allLose) alerts.push("RTP_MINIMUM_LOSS");
  // The repeat guard, applied to the pool BEFORE ranking so the pick below
  // is simply "the closest result that may still land". Only when something
  // else in the pool can meet the floor — otherwise the floor wins.
  const maxRepeat = Math.max(1, Math.floor(params.rtpMaxRepeat));
  const run = leadingRun(bank.recentChoiceIds);
  const repeatExcluded: string[] = [];
  let setAside: OutcomePosition | null = null;
  // It may only make a round CHEAPER, never dearer: what replaces the running
  // result must pay no more than the cheapest copy of it. Measured on
  // 2026-10-12 (andar-bahar, one partner stream): with two results and a cap
  // of 2, the guard turned "the house won twice" into "the other side lands
  // next", a player read it off the history strip, staked ₹100 to build the
  // run and ₹500 on the forced side, and won 12 of 12 forced rounds — 175%
  // RTP. A run of the house's own win is not the pattern this guard is for.
  if (run && run.count >= maxRepeat) {
    const running = pool.filter((p) => p.choiceId === run.id);
    const rest = noDearer(pool, running, (p) => p.choiceId !== run.id);
    if (rest.length > 0) {
      setAside = running[0]!;
      pool = rest;
      repeatExcluded.push(run.id);
    }
  }
  // One account cannot headline round after round. The counter is the one
  // `distribute` reads, but in this mode `noteRoundOutcome` advances it on
  // EVERY priced round the account topped, not only on giving rounds —
  // because the streak this guard exists for happens on rounds the house
  // WINS. Measured on 2026-09-19 (roulette-mini, one partner stream): one
  // account covered 16 of 19 pockets at the ceiling, a second sat on the
  // three it left open, and the three holes were the closest result to the
  // target every round, so the second account was paid 6x on 14 of 15 rounds
  // while the house held 15–25 % of each. The repeat guard above never saw
  // it — the pocket moved every round; only the winner did not. Same rule as
  // distribute's: the filter holds only if it leaves something to pick from.
  // And the repeat guard's rule (2026-10-12): it may only swap in a result
  // paying no more than the cheapest one the streaking account tops. Without
  // it two accounts could farm it — A takes ₹10 wins until it has topped the
  // cap, then B stakes ₹5,000 on the only results A does not top: 96 of 96
  // forced rounds won, 187% RTP for the pair, measured on andar-bahar. The
  // 09-19 shape (the holes WERE the cheapest results) is the player cap's job
  // now: it weighs each account's RTP over the history, in paise, rather
  // than a two-round streak anyone can build.
  const beneficiaryExcluded: string[] = [];
  if (bank.beneficiaryStreak >= params.maxBeneficiaryStreak && bank.lastBeneficiaryUserId) {
    const tops = pool.filter((p) => p.topWinnerUserId === bank.lastBeneficiaryUserId);
    const without = noDearer(pool, tops, (p) => p.topWinnerUserId !== bank.lastBeneficiaryUserId);
    if (without.length > 0) {
      for (const p of tops) beneficiaryExcluded.push(p.choiceId);
      pool = without;
      alerts.push("BENEFICIARY_STREAK");
    }
  }
  // The sharing-partner balance, on what the floor and the repeat guard left.
  const party = partyStage(pool, exposure, params, bank, alerts);
  pool = party.pool;
  // Then the player balance, on what the parties left.
  const players = playerStage(pool, exposure, params, bank, alerts);
  pool = players.pool;
  const B = exposure.totalStakedPaise;
  const ret = BigInt(10_000 - params.rtpHoldBps); // player return, bps
  const aBps = BigInt(params.rtpAggressivenessEnabled ? rtpCorrectionBps(params.aggressiveness) : 10_000);
  // The payout this round aims for, scaled by 10^8 to stay integer: this
  // round's own share of the return, plus `aggressiveness` of the running gap
  // (positive when the house has held more than the target so far). At
  // aggressiveness 1 this ranks identically to "closest to the cumulative
  // target"; the record below keeps that cumulative error either way.
  const wantedRaw = ret * B * 10_000n + aBps * (ret * stakes - 10_000n * payouts);
  // The per-round ceiling on the AIM (2026-09-20): at a giveback target the
  // running gap can dwarf a small round, and aggressiveness paces it as a
  // share of the gap, not of the round — ₹5L owed against a ₹10k table at
  // 10 % still aims ₹60k and lands the biggest pocket. This bounds the aim
  // at the round's own share plus `rtpRoundCapBps` of its stake. Only the
  // upward side: a wanted below the round's share (the house owed money) is
  // left alone, and which results are LEGAL is untouched — a lone straight
  // still pays 0 or 18×, and closeness still picks between them.
  const capBps = BigInt(Math.max(0, Math.floor(params.rtpRoundCapBps)));
  const wantedCap = (ret + capBps) * B * 10_000n;
  const wanted = capBps > 0n && wantedRaw > wantedCap ? wantedCap : wantedRaw;
  const target = (stakes + B) * ret;
  const error = (p: OutcomePosition) => abs((payouts + p.payoutPaise) * 10_000n - target);
  const bandBps = BigInt(Math.round(clamp01(params.rtpTieBandPct) * 10_000));
  const tieBandPaise = (bandBps * B) / 10_000n;
  // THE DRAW. Not "the payout closest to the aim": a board rarely has a
  // payout AT the aim, and for the same layout "closest" is a fixed answer
  // — and a fixed answer pays. Measured 2026-10-14 (roulette-mini, one
  // partner stream, history `none`): two dozens on a 19-pocket wheel pay
  // 1.5× or 0, the aim at 80 % was 0.8×, 1.5× was the nearer of the two,
  // and the engine paid it round after round — 150 % over 400 rounds on a
  // wheel that returns 94.7 % by itself. So the two payouts either side of
  // the aim bracket it and ONE is drawn, the high side with probability
  // (aim − low) / (high − low): the odds that make the EXPECTED payout the
  // aim exactly, whatever the board's payout steps. With a history the miss
  // is carried as before and repaid next round; with none the draw alone
  // holds the target. A board whose payouts all sit on one side of the aim
  // cannot reach it, and the closest is taken — the honest answer, and the
  // old one. The odds are in parts per billion, the rng's own resolution.
  let low: OutcomePosition | null = null;
  let high: OutcomePosition | null = null;
  if (!minimisePayout) {
    for (const p of pool) {
      const v = p.payoutPaise * 100_000_000n;
      if (v <= wanted && (low === null || p.payoutPaise > low.payoutPaise)) low = p;
      if (v >= wanted && (high === null || p.payoutPaise < high.payoutPaise)) high = p;
    }
  }
  let highChance = 0n;
  let drawn: OutcomePosition;
  if (minimisePayout) {
    drawn = pool[0]!;
    for (const p of pool) if (p.payoutPaise < drawn.payoutPaise) drawn = p;
  } else if (low && high && low.payoutPaise !== high.payoutPaise) {
    const span = (high.payoutPaise - low.payoutPaise) * 100_000_000n;
    highChance = ((wanted - low.payoutPaise * 100_000_000n) * 1_000_000_000n) / span;
    drawn = BigInt(Math.floor(rng.next() * 1e9)) < highChance ? high : low;
  } else {
    drawn = (low ?? high)!;
    if (!low) highChance = 1_000_000_000n;
  }
  // The near-tie band, in paise, around the side the draw landed on.
  const ties = pool.filter((p) => abs(p.payoutPaise - drawn.payoutPaise) <= tieBandPaise);
  const picked = rng.pick(ties);
  // Flag the guard only when it changed the answer: the result it set aside
  // would have been a side of the bracket, or in the band around the drawn one.
  const guardChanged = setAside !== null && (
    abs(setAside.payoutPaise - drawn.payoutPaise) <= tieBandPaise ||
    (!minimisePayout &&
      (low === null || setAside.payoutPaise > low.payoutPaise) &&
      (high === null || setAside.payoutPaise < high.payoutPaise)));
  if (guardChanged) alerts.push("RTP_REPEAT_GUARD");
  const guardNote = setAside
    ? ` The repeat guard set aside ${setAside.label}, which had landed ${run!.count} rounds running.`
    : "";
  return {
    ...fromPick(
      picked,
      ties.map((p) => ({ choiceId: p.choiceId, label: p.label, houseNetPaise: p.houseNetPaise.toString(), weight: 1 })),
      "rtp", exposure, bank,
      (floorUnreachable
        ? "RTP: bank floor is unreachable; selected the smallest available payout."
        : minimisePayout
          ? "RTP: loss recovery takes priority; selected the smallest available payout."
          : low && high && low.payoutPaise !== high.payoutPaise
            ? "RTP: drew between the two payouts either side of this round's aim (its share of the player-return target plus the chosen slice of the running gap), at the odds that make the expected payout the aim."
            : "RTP: selected the available payout closest to this round's aim; nothing on the board sits on the other side of it.") + guardNote,
      alerts, seed,
    ),
    rtp: {
      holdBps: params.rtpHoldBps,
      recoveryMode: params.rtpRecoveryMode,
      historyScope: params.rtpHistoryScope,
      aggressivenessBps: Number(aBps),
      noiseRate,
      settledStakesPaise: stakes.toString(),
      settledPayoutsPaise: payouts.toString(),
      roundStakesPaise: B.toString(),
      wantedPayoutPaise: (wanted / 100_000_000n).toString(),
      roundCapBps: Number(capBps),
      wantedCapped: wanted !== wantedRaw,
      selectedPayoutPaise: picked.payoutPaise.toString(),
      targetErrorBpsPaise: error(picked).toString(),
      minBankFloorPaise: effectiveFloorPaise(bank).toString(),
      maxRepeat,
      recentChoiceIds: bank.recentChoiceIds.slice(0, maxRepeat),
      repeatExcluded,
      maxBeneficiaryStreak: params.maxBeneficiaryStreak,
      beneficiaryStreak: bank.beneficiaryStreak,
      lastBeneficiaryUserId: bank.lastBeneficiaryUserId,
      beneficiaryExcluded,
      tieBandBps: Number(bandBps),
      tieBandPaise: tieBandPaise.toString(),
      bracketLowPaise: low ? low.payoutPaise.toString() : null,
      bracketHighPaise: high ? high.payoutPaise.toString() : null,
      highChanceBps: Number(highChance / 100_000n),
      drawnPayoutPaise: drawn.payoutPaise.toString(),
      evaluated: exposure.outcomes.map((p) => ({ index: p.index, choiceId: p.choiceId, payoutPaise: p.payoutPaise.toString() })),
    },
    ...(party.record ? { party: party.record } : {}),
    ...(players.record ? { players: players.record } : {}),
  };
}

/**
 * The anti-pattern check.
 *
 * Runs before ranking in collect, distribute and auto. RTP has its own
 * ranking and tie-breaking policy. A steered table that produces a visible
 * pattern is worse than one that holds slightly less: the pattern is what gets
 * noticed, and it is noticed by exactly the people who count results.
 *
 * `naturalOdds` is what makes this work across games rather than only on a
 * wheel. A roulette pocket is expected 20/38 = 0.53 times in the window, so six
 * of them is far past chance and fires. Banker is expected about nine times in
 * the same window, so six is BELOW its natural rate and must not fire. Reading
 * the odds from the game rather than assuming a uniform space is the whole
 * difference between a guard and a nuisance.
 */
export function streaking(
  recent: readonly string[],
  choiceCount: number,
  naturalOdds?: Record<string, number>,
): boolean {
  // Under 8 results there is no pattern to see, only a short sample.
  if (recent.length < 8) return false;
  const window = recent.slice(0, 20);

  // A class repeating far past ITS OWN chance. The absolute floor of 6 is doing
  // the work: on a wheel, at 3 this fired on about half of all FAIR windows —
  // each pocket is expected 0.53 times over 20 rounds, so a pocket reaching
  // three is unremarkable — and silently turned a 15% noise rate into 50%.
  const counts = new Map<string, number>();
  for (const id of window) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    const p = naturalOdds?.[id] ?? 1 / Math.max(1, choiceCount);
    const expected = window.length * p;
    if (n >= 6 && n > expected * 4) return true;
  }
  return false;
}

/**
 * Shift every raw score so the worst candidate still carries a sliver of
 * weight, then walk one roll down the list.
 *
 * The shift is not cosmetic. A zero-weight candidate sitting in the recorded
 * pool would never be drawn, which would make the pool a lie about what could
 * have happened — and the pool is the thing an auditor reads.
 */
export function weightedPick(
  rng: SeededRng,
  items: readonly OutcomePosition[],
  score: (p: OutcomePosition) => number,
): { picked: OutcomePosition; candidates: Candidate[] } {
  const raw = items.map(score);
  const min = Math.min(...raw);
  const weights = raw.map((r) => r - min + 1e-6);
  const total = weights.reduce((a, b) => a + b, 0);
  const candidates: Candidate[] = items.map((p, i) => ({
    choiceId: p.choiceId,
    label: p.label,
    houseNetPaise: p.houseNetPaise.toString(),
    weight: weights[i]!,
  }));
  let roll = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return { picked: items[i]!, candidates };
  }
  return { picked: items[items.length - 1]!, candidates };
}

/**
 * The pool every steering selector draws from.
 *
 * The bank floor is the one HARD limit, and it outranks every target. When even
 * it cannot be met, the engine says so and takes the least bad outcome rather
 * than refusing to resolve: a stranded round holds every stake on the table,
 * and that is worse than a breached floor an operator can see in an alert.
 */
/**
 * The sharing-partner balance (2026-09-18).
 *
 * Every partner on a shared stream pays its own players, so the pool's best
 * result can be one partner's loss. This narrows `pool` to the results that
 * keep the parties level, BEFORE the mode ranks what is left:
 *
 *   rtpBand  keep results after which every party's RTP over the history
 *            scope sits within `partyBandBps` of the target; if none does,
 *            keep the results whose worst-placed party is closest, with the
 *            band as slack so a repeated layout is not one fixed answer.
 *   noLoser  keep results where no party pays out more than it took this
 *            round; if none does, keep those whose largest party loss is
 *            smallest, with a slack of the band's share of the round's stake.
 *
 * Runs only with two or more parties on the round and two or more results to
 * choose from — with one party there is nothing to balance, and it must
 * never override a pool the floor already cut to one. Pure; the record it
 * returns is stored on the decision so a pick can be replayed.
 */
export function partyStage(
  pool: OutcomePosition[],
  exposure: Exposure,
  params: EngineParams,
  bank: BankState,
  alerts: AlertCode[],
): { pool: OutcomePosition[]; record: PartyRecord | null } {
  const stakes = exposure.partyStakes;
  if (!params.partyBalanceEnabled || !stakes || stakes.size < 2 || pool.length < 2) {
    return { pool, record: null };
  }
  const totals = bank.partyTotals ?? {};
  const target = BigInt(bank.partyTargetBps ?? (params.partyTargetRtpBps || 10_000 - params.rtpHoldBps));
  const band = BigInt(Math.max(0, Math.floor(params.partyBandBps)));
  const ids = [...stakes.keys()].sort();
  const before = (id: string) => totals[id] ?? { stakedPaise: 0n, payoutPaise: 0n };
  // Two readings of "how far off" per result: the worst party's deviation
  // in bps (the band test), and the worst party's SHORTFALL in paise — how
  // much that party is short of, or over, the target on its history plus
  // this round. The fallback ranks on the paise figure: a single round moves
  // a long history's RTP by a fraction of a point, so a bps slack would keep
  // every result and steer nothing, while the paise figure still separates
  // "pays the lagging party" from "does not".
  const evalOf = (p: OutcomePosition) => {
    let worstDev: bigint | null = null;
    let worstShort: bigint | null = null;
    let worstLoss = -(1n << 62n);
    for (const id of ids) {
      const part = p.parties?.get(id) ?? { stakePaise: stakes.get(id) ?? 0n, payoutPaise: 0n };
      const S = before(id).stakedPaise + part.stakePaise;
      const P = before(id).payoutPaise + part.payoutPaise;
      if (S > 0n) {
        const dev = abs((P * 10_000n) / S - target);
        if (worstDev === null || dev > worstDev) worstDev = dev;
        const short = abs(P * 10_000n - target * S) / 10_000n;
        if (worstShort === null || short > worstShort) worstShort = short;
      }
      const loss = part.payoutPaise - part.stakePaise;
      if (loss > worstLoss) worstLoss = loss;
    }
    return { worstDev, worstShort, worstLoss };
  };
  const scored = pool.map((p) => ({ p, ...evalOf(p) }));
  let kept: OutcomePosition[];
  let satisfied: boolean;
  if (params.partyBalanceMode === "noLoser") {
    const ok = scored.filter((x) => x.worstLoss <= 0n);
    satisfied = ok.length > 0;
    if (satisfied) kept = ok.map((x) => x.p);
    else {
      const min = scored.reduce((m, x) => (x.worstLoss < m ? x.worstLoss : m), scored[0]!.worstLoss);
      const slack = (band * exposure.totalStakedPaise) / 10_000n;
      kept = scored.filter((x) => x.worstLoss <= min + slack).map((x) => x.p);
    }
  } else {
    const ok = scored.filter((x) => x.worstDev !== null && x.worstDev <= band);
    satisfied = ok.length > 0;
    if (satisfied) kept = ok.map((x) => x.p);
    else {
      const withDev = scored.filter((x) => x.worstShort !== null);
      if (withDev.length === 0) return { pool, record: null };
      const min = withDev.reduce((m, x) => (x.worstShort! < m ? x.worstShort! : m), withDev[0]!.worstShort!);
      const slack = (band * exposure.totalStakedPaise) / 10_000n;
      kept = withDev.filter((x) => x.worstShort! <= min + slack).map((x) => x.p);
    }
  }
  if (kept.length === 0) kept = pool;
  if (kept.length < pool.length) alerts.push("PARTY_BALANCED");
  if (!satisfied) alerts.push("PARTY_BAND_UNREACHABLE");
  return {
    pool: kept,
    record: {
      mode: params.partyBalanceMode,
      targetBps: Number(target),
      bandBps: Number(band),
      historyScope: params.partyHistoryScope,
      parties: ids.map((id) => {
        const b = before(id);
        return {
          id,
          roundStakePaise: (stakes.get(id) ?? 0n).toString(),
          stakedBeforePaise: b.stakedPaise.toString(),
          payoutBeforePaise: b.payoutPaise.toString(),
          rtpBeforeBps: b.stakedPaise > 0n ? Number((b.payoutPaise * 10_000n) / b.stakedPaise) : null,
        };
      }),
      narrowedFrom: pool.length,
      narrowedTo: kept.length,
      satisfied,
      evaluated: scored.map((x) => ({ choiceId: x.p.choiceId, worstRtpDevBps: x.worstDev === null ? null : Number(x.worstDev), worstShortfallPaise: x.worstShort === null ? null : x.worstShort.toString(), worstLossPaise: x.worstLoss.toString() })),
    },
  };
}

/**
 * The player balance (2026-09-20).
 *
 * Every mode ranks a result by what the whole table would be paid, never by
 * who receives it. So a book shaped so that one account's pockets are always
 * the cheapest result pays that account every round: measured on 2026-09-19,
 * one player covered 16 of 19 pockets at the ceiling, another sat on the
 * three holes, and the holes were the pick 14 rounds in 15 — one account at
 * 205 % over the day, the cover bettor at 25 %, the house holding 31 %. This
 * narrows `pool` to the results that keep every WEIGHED player inside
 * `playerBandBps` of the stream's target, BEFORE the mode ranks what is left:
 *
 *   cap   (playerCapEnabled)  set aside results after which a player's RTP
 *         over the history scope sits ABOVE target + band
 *   lift  (playerLiftEnabled) set aside results after which a player's RTP
 *         sits BELOW target − band — the house giving back on purpose, so it
 *         is its own switch
 *
 * If no result satisfies, the results whose worst-placed player is closest
 * to the band edge (in paise, with the band's share of the round's stake as
 * slack) are kept, so a repeated layout is not one fixed answer. A player
 * with fewer than `playerMinRounds` settled slips in the scope is not weighed
 * — a first-round winner is not trimmed on the second — and a player alone
 * on the round IS weighed, unlike a lone party: a cap on one account is
 * exactly the case. Pure; the record is stored on the decision for replay.
 */
export function playerStage(
  pool: OutcomePosition[],
  exposure: Exposure,
  params: EngineParams,
  bank: BankState,
  alerts: AlertCode[],
): { pool: OutcomePosition[]; record: PlayerRecord | null } {
  const stakes = exposure.playerStakes;
  const cap = params.playerCapEnabled;
  const lift = params.playerLiftEnabled;
  if ((!cap && !lift) || !stakes || stakes.size === 0 || pool.length < 2) {
    return { pool, record: null };
  }
  const totals = bank.playerTotals ?? {};
  const minRounds = Math.max(1, Math.floor(params.playerMinRounds));
  const before = (id: string) => totals[id] ?? { stakedPaise: 0n, payoutPaise: 0n, rounds: 0 };
  const all = [...stakes.keys()].sort();
  const ids = all.filter((id) => before(id).rounds >= minRounds && (!lift || (stakes.get(id) ?? 0n) <= before(id).stakedPaise));
  if (ids.length === 0) return { pool, record: null };
  const target = BigInt(10_000 - params.rtpHoldBps);
  const band = BigInt(Math.max(0, Math.floor(params.playerBandBps)));
  const upper = target + band;
  const lower = target > band ? target - band : 0n;
  // Per result: the worst player's distance outside the band in bps (the
  // test), and in paise (the fallback's ranking — one round moves a long
  // history's RTP by a fraction of a point, so a bps slack would keep every
  // result and steer nothing; the paise figure still separates "pays the
  // lagging player" from "does not"). Inside the band both are zero.
  const evalOf = (p: OutcomePosition) => {
    let worstDev = 0n;
    let worstShort = 0n;
    for (const id of ids) {
      const S = before(id).stakedPaise + (stakes.get(id) ?? 0n);
      const P = before(id).payoutPaise + (p.players?.get(id) ?? 0n);
      if (S <= 0n) continue;
      const rtp = (P * 10_000n) / S;
      let dev = 0n;
      let short = 0n;
      if (cap && rtp > upper) {
        dev = rtp - upper;
        short = (P * 10_000n - upper * S) / 10_000n;
      } else if (lift && rtp < lower) {
        dev = lower - rtp;
        short = (lower * S - P * 10_000n) / 10_000n;
        const settledDeficit = (lower * before(id).stakedPaise) / 10_000n - before(id).payoutPaise;
        const liftLimit = settledDeficit > 0n ? settledDeficit : 0n;
        if (short > liftLimit) short = liftLimit;
        if (liftLimit === 0n) dev = 0n;
      }
      if (dev > worstDev) worstDev = dev;
      if (short > worstShort) worstShort = short;
    }
    return { worstDev, worstShort };
  };
  const scored = pool.map((p) => ({ p, ...evalOf(p) }));
  const ok = scored.filter((x) => x.worstDev === 0n);
  const satisfied = ok.length > 0;
  let kept: OutcomePosition[];
  if (satisfied) kept = ok.map((x) => x.p);
  else {
    const min = scored.reduce((m, x) => (x.worstShort < m ? x.worstShort : m), scored[0]!.worstShort);
    const slack = (band * exposure.totalStakedPaise) / 10_000n;
    kept = scored.filter((x) => x.worstShort <= min + slack).map((x) => x.p);
  }
  if (kept.length === 0) kept = pool;
  if (kept.length < pool.length) alerts.push("PLAYER_BALANCED");
  if (!satisfied) alerts.push("PLAYER_BAND_UNREACHABLE");
  return {
    pool: kept,
    record: {
      capEnabled: cap,
      liftEnabled: lift,
      targetBps: Number(target),
      bandBps: Number(band),
      minRounds,
      historyScope: params.rtpHistoryScope,
      players: all.map((id) => {
        const b = before(id);
        return {
          id,
          roundStakePaise: (stakes.get(id) ?? 0n).toString(),
          stakedBeforePaise: b.stakedPaise.toString(),
          payoutBeforePaise: b.payoutPaise.toString(),
          roundsBefore: b.rounds,
          rtpBeforeBps: b.stakedPaise > 0n ? Number((b.payoutPaise * 10_000n) / b.stakedPaise) : null,
          weighed: ids.includes(id),
        };
      }),
      narrowedFrom: pool.length,
      narrowedTo: kept.length,
      satisfied,
      evaluated: scored.map((x) => ({ choiceId: x.p.choiceId, worstDevBps: Number(x.worstDev), worstShortfallPaise: x.worstShort.toString() })),
    },
  };
}

export function eligible(
  exposure: Exposure,
  bank: BankState,
  params: EngineParams,
  alerts: AlertCode[],
): OutcomePosition[] {
  const floorLegal = exposure.outcomes.filter(
    (p) => aboveFloor(bank, p.houseNetPaise),
  );

  if (floorLegal.length === 0) {
    alerts.push("BANK_FLOOR_UNREACHABLE");
    const best = exposure.outcomes.reduce((a, b) =>
      b.houseNetPaise > a.houseNetPaise ? b : a,
    );
    // The dead-outcome rule below YIELDS here. There is nothing left to trade.
    return [best];
  }

  if (bank.zeroBetStreak < params.maxZeroBetStreak) return floorLegal;

  // Too many rounds running have landed where nobody had a chip. Prefer an
  // outcome somebody actually backed, but only if that leaves a pool at all.
  // A streak must never manufacture a more expensive winner on a sparse book.
  const cheapest = floorLegal.reduce((m, p) => p.payoutPaise < m ? p.payoutPaise : m, floorLegal[0]!.payoutPaise);
  const backed = floorLegal.filter((p) => p.betCount > 0 && p.payoutPaise <= cheapest);
  if (backed.length > 0) {
    alerts.push("ZERO_BET_STREAK");
    return backed;
  }
  return floorLegal;
}

/**
 * Do not steer this round; let the game draw its own outcome.
 *
 * This is the honest path and it is reached far more often than the steering
 * ones. It deliberately does NOT pick from the candidate list.
 */
function drawHonestly(
  exposure: Exposure,
  mode: EngineMode,
  bank: BankState,
  reason: string,
  alerts: AlertCode[],
  noise: boolean,
  seed: string,
): ResultDecision {
  return {
    choiceIndex: null,
    choiceId: null,
    mode,
    houseDeltaPaise: "0",
    candidates: [],
    rngSeed: seed,
    reason,
    alerts,
    noise,
    whaleUserId: exposure.whaleUserId,
    bankBeforePaise: bank.bankPaise.toString(),
  };
}

function fromPick(
  picked: OutcomePosition,
  candidates: Candidate[],
  mode: EngineMode,
  exposure: Exposure,
  bank: BankState,
  reason: string,
  alerts: AlertCode[],
  seed: string,
): ResultDecision {
  return {
    choiceIndex: picked.index,
    choiceId: picked.choiceId,
    mode,
    houseDeltaPaise: picked.houseNetPaise.toString(),
    candidates,
    rngSeed: seed,
    reason,
    alerts,
    noise: false,
    whaleUserId: exposure.whaleUserId,
    bankBeforePaise: bank.bankPaise.toString(),
  };
}

/** Favour the outcomes the house wins most on, narrowed by `aggressiveness`. */
function collect(
  rng: SeededRng,
  exposure: Exposure,
  bank: BankState,
  params: EngineParams,
  alerts: AlertCode[],
  seed: string,
  aggressivenessOverride?: number,
): ResultDecision {
  const pool = eligible(exposure, bank, params, alerts);
  const aggressiveness = clamp01(aggressivenessOverride ?? params.aggressiveness);
  // At 0 every eligible outcome is in the shortlist; at 1, only three. Never
  // fewer than three: a shortlist of one is a fixed table, not a steered one.
  const k = Math.max(3, Math.ceil(exposure.outcomes.length * (1 - aggressiveness)));
  const ties = new Map(pool.map(p => [p.index, rng.next()]));
  const ranked = [...pool].sort((a, b) =>
    a.houseNetPaise === b.houseNetPaise
      ? ties.get(a.index)! - ties.get(b.index)!
      : b.houseNetPaise > a.houseNetPaise
        ? 1
        : -1,
  );
  const shortlist = ranked.slice(0, k);
  const { picked, candidates } = weightedPick(rng, shortlist, (p) =>
    Number(p.houseNetPaise),
  );
  return fromPick(
    picked,
    candidates,
    "collect",
    exposure,
    bank,
    `Collecting: shortlisted the ${shortlist.length} best of ${pool.length} eligible outcomes by house net.`,
    alerts,
    seed,
  );
}

/** Give the bank back down to its target, paced over `paceRounds`. */
function distribute(
  rng: SeededRng,
  exposure: Exposure,
  bank: BankState,
  params: EngineParams,
  alerts: AlertCode[],
  seed: string,
  targetOverride?: bigint | null,
  paceOverride?: number,
): ResultDecision {
  let pool = eligible(exposure, bank, params, alerts);

  // One account cannot headline every giving round in a row. The filter is kept
  // only if it leaves something to pick from — refusing to give at all is not
  // the alternative to giving to the same person twice.
  if (
    bank.beneficiaryStreak >= params.maxBeneficiaryStreak &&
    bank.lastBeneficiaryUserId
  ) {
    const without = pool.filter(
      (p) => p.topWinnerUserId !== bank.lastBeneficiaryUserId,
    );
    if (without.length > 0) {
      pool = without;
      alerts.push("BENEFICIARY_STREAK");
    }
  }

  const target = targetOverride === undefined ? params.targetBankPaise : targetOverride;
  const owed = target === null ? 0n : bank.bankPaise - target;
  if (target === null || owed <= 0n) {
    return drawHonestly(
      exposure,
      "distribute",
      bank,
      target === null
        ? "Distributing with no target bank set — nothing to give back, left to its own draw."
        : "Distributing but the bank is already at or below target — left to its own draw.",
      alerts,
      false,
      seed,
    );
  }

  const pace = BigInt(Math.max(1, Math.floor(paceOverride ?? params.paceRounds)));
  const wantGive = owed / pace;

  const losing = pool.filter((p) => p.houseNetPaise < 0n);
  if (losing.length === 0) {
    // Nobody's chip makes this round cost the house anything. Take the CHEAPEST
    // win rather than inventing a payout that no bet on the table earns.
    const cheapest = pool.reduce((a, b) => (b.houseNetPaise < a.houseNetPaise ? b : a));
    return fromPick(
      cheapest,
      [
        {
          choiceId: cheapest.choiceId,
          label: cheapest.label,
          houseNetPaise: cheapest.houseNetPaise.toString(),
          weight: 1,
        },
      ],
      "distribute",
      exposure,
      bank,
      "Distributing, but no outcome on the book loses money — took the cheapest win instead of fabricating a payout.",
      alerts,
      seed,
    );
  }

  // Include the cheapest non-losing outcome. Interpolate between outcomes
  // bracketing the desired net so a lone 36x bet is paid only at its paced rate.
  const wanted = -wantGive;
  const sorted = [...pool].sort((a,b) => a.houseNetPaise < b.houseNetPaise ? -1 : a.houseNetPaise > b.houseNetPaise ? 1 : 0);
  const low = [...sorted].reverse().find(p => p.houseNetPaise <= wanted) ?? sorted[0]!;
  const high = sorted.find(p => p.houseNetPaise >= wanted) ?? sorted[sorted.length - 1]!;
  const span = high.houseNetPaise - low.houseNetPaise;
  const lowWeight = span > 0n ? Number(high.houseNetPaise - wanted) / Number(span) : 1;
  const picked = rng.next() < lowWeight ? low : high;
  const candidates: Candidate[] = [low, ...(high === low ? [] : [high])].map(p => ({
    choiceId: p.choiceId, label: p.label, houseNetPaise: p.houseNetPaise.toString(),
    weight: p === low ? lowWeight : 1 - lowWeight,
  }));
  return fromPick(
    picked,
    candidates,
    "distribute",
    exposure,
    bank,
    `Distributing ~${wantGive} paise this round (${owed} owed over ${pace} rounds).`,
    alerts,
    seed,
  );
}

/**
 * Hold a target share of turnover, steering either way.
 *
 * `auto` steers the RATE, not the bank — which is why it derives its own target
 * when it needs to distribute instead of reading `targetBankPaise`. A target
 * left over from a previous `collect` run is about a different question.
 */
function auto(
  rng: SeededRng,
  exposure: Exposure,
  bank: BankState,
  params: EngineParams,
  alerts: AlertCode[],
  seed: string,
): ResultDecision {
  const BAND = 0.015;
  if (bank.windowStakedPaise <= 0n) {
    return drawHonestly(
      exposure,
      "auto",
      bank,
      "Auto: no turnover in the window yet — left to its own draw.",
      alerts,
      false,
      seed,
    );
  }
  const hold = Number(bank.windowHouseNetPaise) / Number(bank.windowStakedPaise);

  if (hold < params.targetHoldPct - BAND) {
    // Below target. Collect, but at a fixed middling aggressiveness — auto is
    // correcting a rate, not chasing the single best outcome on the board.
    return {
      ...collect(rng, exposure, bank, params, alerts, seed, 0.4),
      mode: "auto",
      reason: `Auto: holding ${(hold * 100).toFixed(2)}% against a ${(params.targetHoldPct * 100).toFixed(2)}% target — collecting.`,
    };
  }

  if (hold > params.targetHoldPct + BAND) {
    const derivedTarget =
      bank.bankPaise -
      BigInt(
        Math.round(Number(bank.windowStakedPaise) * (hold - params.targetHoldPct)),
      );
    return {
      ...distribute(
        rng,
        exposure,
        bank,
        params,
        alerts,
        seed,
        derivedTarget,
        Math.max(10, Math.floor(params.windowRounds / 10)),
      ),
      mode: "auto",
      reason: `Auto: holding ${(hold * 100).toFixed(2)}% against a ${(params.targetHoldPct * 100).toFixed(2)}% target — giving back.`,
    };
  }

  return drawHonestly(
    exposure,
    "auto",
    bank,
    `Auto: holding ${(hold * 100).toFixed(2)}%, inside the band — left to its own draw.`,
    alerts,
    false,
    seed,
  );
}

/**
 * The dispatcher.
 *
 * Order matters and is observable:
 *
 *  1. `normal` reads nothing at all and never steers.
 *  2. An empty book steers nowhere — with nothing staked there is no house net
 *     to steer toward, so the game draws for itself.
 *  3. RTP rolls its own noise first, then ranks by its cumulative target and
 *     loss policy; the streak guards below are not applied to it.
 *  4. For collect/distribute/auto, THE NOISE ROLL HAPPENS BEFORE ANYTHING IS RANKED. That is the whole point
 *     of its position: rolled afterwards, the decision to ignore the ranking
 *     could be influenced by how good the ranking looked, which is a different
 *     and much worse machine.
 *  5. Only then, the remaining mode.
 */
export function decide(
  mode: EngineMode,
  exposure: Exposure,
  params: EngineParams,
  bank: BankState,
  rng: SeededRng,
  seed: string,
  naturalOdds?: Record<string, number>,
  extraStreak?: (recent: readonly string[]) => boolean,
): ResultDecision {
  const alerts: AlertCode[] = [];

  if (mode === "normal") {
    return drawHonestly(
      exposure,
      "normal",
      bank,
      "Engine is in normal mode — the game draws its own result at its published odds.",
      alerts,
      false,
      seed,
    );
  }

  if (exposure.betCount === 0 || exposure.totalStakedPaise <= 0n) {
    return drawHonestly(
      exposure,
      mode,
      bank,
      "No bets in this round — nothing to steer, left to its own draw.",
      alerts,
      false,
      seed,
    );
  }

  if (exposure.outcomes.length === 0) {
    return drawHonestly(
      exposure,
      mode,
      bank,
      "No candidate outcomes to choose between — left to its own draw.",
      alerts,
      false,
      seed,
    );
  }

  if (mode === "rtp") return rtp(rng, exposure, bank, params, seed);

  const forced =
    streaking(bank.recentChoiceIds, exposure.outcomes.length, naturalOdds) ||
    extraStreak?.(bank.recentChoiceIds) === true;
  if (forced || rng.next() < clamp01(params.noiseRate)) {
    if (forced) alerts.push("DIVERSIFIED");
    return drawHonestly(
      exposure,
      mode,
      bank,
      forced
        ? "Recent results were forming a pattern — left to its own draw to break it."
        : "Noise round — discarded the ranking and left it to its own draw.",
      alerts,
      true,
      seed,
    );
  }

  // The sharing-partner balance runs on what the bank floor allows (the
  // floor outranks it), and the mode then ranks the narrowed pool exactly as
  // it would have ranked the full one. `index` on each position is the
  // original candidate index, so the pick still names the right outcome.
  const floorLegal = exposure.outcomes.filter((p) => aboveFloor(bank, p.houseNetPaise));
  const party = partyStage(floorLegal.length > 0 ? floorLegal : exposure.outcomes, exposure, params, bank, alerts);
  const players = playerStage(party.pool, exposure, params, bank, alerts);
  const narrowed: Exposure = party.record || players.record ? { ...exposure, outcomes: players.pool } : exposure;
  const decision =
    mode === "collect"
      ? collect(rng, narrowed, bank, params, alerts, seed)
      : mode === "distribute"
        ? distribute(rng, narrowed, bank, params, alerts, seed)
        : auto(rng, narrowed, bank, params, alerts, seed);
  return {
    ...decision,
    ...(party.record ? { party: party.record } : {}),
    ...(players.record ? { players: players.record } : {}),
  };
}
