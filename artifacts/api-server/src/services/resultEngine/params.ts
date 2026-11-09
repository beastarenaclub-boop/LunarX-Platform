/**
 * The result engine's parameters.
 *
 * Stored per stream as jsonb and merged over these defaults on every read.
 * NOTHING trusts the stored blob: a value of the wrong type, or out of range,
 * falls back to its default rather than reaching a selector. A params row is
 * operator input that has been sitting in a database for months, and a NaN
 * `paceRounds` would divide a giveaway by nothing.
 */

/**
 * The five modes, available on every steerable game.
 *
 * `normal` was called `random` until 2026-09-05, and the rename is a
 * correction rather than a preference: in it the engine steers NOTHING and the
 * game draws its own result through its own derivation, at the RTP it
 * publishes. It never meant "uniform over the outcomes", and on a card table
 * that reading would have been a different game — a uniform pick over player,
 * banker and tie makes one round in three a tie.
 */
export type EngineMode = "normal" | "collect" | "distribute" | "auto" | "rtp";

export const RTP_RECOVERY_MODES = ["recover", "target"] as const;
export type RtpRecoveryMode = (typeof RTP_RECOVERY_MODES)[number];

/**
 * How much of the stream's settled history the RTP target is measured over.
 * `all` is every recorded round; `7d` / `24h` only rounds settled inside
 * that window; `none` is no memory at all — every round aims for its own
 * share of the target and nothing earlier is repaid or recovered.
 */
export const RTP_HISTORY_SCOPES = ["all", "7d", "24h", "none"] as const;
export type RtpHistoryScope = (typeof RTP_HISTORY_SCOPES)[number];
export const RTP_HISTORY_WINDOW_MS: Readonly<Record<RtpHistoryScope, number | null>> = {
  all: null,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  none: 0,
};

export const ENGINE_MODES: readonly EngineMode[] = [
  "normal",
  "collect",
  "distribute",
  "auto",
  "rtp",
];

/**
 * Rows written before the rename hold `random`, and they mean `normal`.
 *
 * Read leniently and write the new name. Migration 0068 rewrites the stored
 * rows, but a decision's `meta` is a frozen JSON snapshot that is never
 * rewritten, so this has to keep coping with the old name for as long as those
 * rows are read.
 */
export function toEngineMode(v: unknown): EngineMode | null {
  if (v === "random") return "normal";
  return typeof v === "string" && (ENGINE_MODES as readonly string[]).includes(v)
    ? (v as EngineMode)
    : null;
}

export function isEngineMode(v: unknown): v is EngineMode {
  return toEngineMode(v) !== null;
}

export const PARTY_BALANCE_MODES = ["rtpBand", "noLoser"] as const;
export type PartyBalanceMode = (typeof PARTY_BALANCE_MODES)[number];

export interface EngineParams {
  /**
   * Balance results across the partners sharing this stream (2026-09-18).
   * Each partner pays its own players, so a result that is cheapest for the
   * pool can still be one partner paying while another collects. On, a stage
   * before the mode's own ranking keeps only the results that leave every
   * partner inside `partyBandBps` of `partyTargetRtpBps` (rtpBand), or that
   * leave no partner paying out more than it took this round (noLoser), and
   * falls back to the least-bad results when none qualify. Off, or with one
   * party on the round, nothing changes.
   */
  partyBalanceEnabled: boolean;
  partyBalanceMode: PartyBalanceMode;
  /** The RTP every partner is held to, in bps of stake; 0 = this stream's Target RTP (10000 − rtpHoldBps). */
  partyTargetRtpBps: number;
  /** How far a partner's RTP may sit from the target before a result is set aside, in bps. */
  partyBandBps: number;
  /** The settled history each partner's RTP is measured over. */
  partyHistoryScope: RtpHistoryScope;
  /**
   * Balance results across the PLAYERS on a round (2026-09-20). The modes
   * rank a result by what the whole table would be paid and never by who
   * gets it, so a book shaped so that one account's pockets are always the
   * cheapest pays that account every round — measured on 2026-09-19, one
   * player at 205 % over a day while the cover bettor sat at 25 %. On, a
   * stage before the mode's own ranking sets aside the results that would
   * leave a player OVER the target by more than `playerBandBps` (cap) or
   * UNDER it by more (lift), each side its own switch, and falls back to the
   * results whose worst-placed player is closest when none qualify. A player
   * with fewer than `playerMinRounds` settled slips in the RTP history scope
   * is not weighed — a first-round winner must not be trimmed on the second.
   * Both off (default), or one weighed player on the round, nothing changes.
   */
  playerCapEnabled: boolean;
  playerLiftEnabled: boolean;
  /** How far a player's RTP over the history scope may sit from the stream's target, in bps. */
  playerBandBps: number;
  /** Settled slips a player needs in the history scope before the balance weighs them. */
  playerMinRounds: number;
  /**
   * RTP mode stores house hold in basis points: 1000 = 90% player return.
   * NEGATIVE is a giveback (2026-09-20): −1000 = 110 %, the house funding
   * 10 % of turnover on purpose. The bank floor is then the budget — the
   * giveback stops by itself when the bank reaches it.
   */
  rtpHoldBps: number;
  /**
   * The most a single round may AIM above its own share of the target, in
   * bps of that round's stake; 0 = no ceiling. Aggressiveness paces the
   * running gap as a share of the GAP, so a ₹5L gap against a ₹10k round at
   * 10 % still aims ₹60k at a ₹10k table and lands its biggest pocket; this
   * bounds the aim in the round's own terms. It caps what the engine aims
   * at, never which results are legal — a lone straight still pays 0 or 18×.
   */
  rtpRoundCapBps: number;
  /** Recover a cumulative house loss first, or always pursue the RTP target. */
  rtpRecoveryMode: RtpRecoveryMode;
  /**
   * The settled history the target is measured over — see RTP_HISTORY_SCOPES.
   * Under `none` the running gap is always zero, so aggressiveness has
   * nothing to repay and "recover" never has a loss to recover.
   */
  rtpHistoryScope: RtpHistoryScope;
  /**
   * Whether RTP reads `aggressiveness` at all. Off, every round closes the
   * whole running gap (the plain closest-to-cumulative-target rule).
   */
  rtpAggressivenessEnabled: boolean;
  /** Whether RTP rolls `noiseRate`. Off, no round is left to an honest draw. */
  rtpNoiseEnabled: boolean;
  /**
   * The most rounds in a row the same result may land on a stream under RTP.
   * Once it has, that result is set aside for the round and the next-closest
   * is taken — unless it is the only result that meets the bank floor. The
   * history counts every landed round, steered or drawn, because a repeat is
   * what the PLAYER sees: a Prev-Bet layout replayed against a stream in
   * deficit landed the same pocket six rounds running (2026-09-16).
   */
  rtpMaxRepeat: number;
  /**
   * How close to the best-scoring result another must be, as a share of the
   * round's stake, to count as a tie and be drawn against it at random.
   * Zero = exact ties only — the deterministic argmin.
   */
  rtpTieBandPct: number;
  /** Where `collect` climbs to and `distribute` falls to, in paise. Null = no target. */
  targetBankPaise: bigint | null;
  /** Narrows `collect`'s shortlist. 0 = every eligible pocket, 1 = the best three. */
  aggressiveness: number;
  /** Rounds a `distribute` giveaway is spread over. */
  paceRounds: number;
  /**
   * The share of rounds that discard the ranking entirely and draw uniformly.
   *
   * IT CANNOT BE SET TO ZERO. The floor of 0.02 is enforced here and is
   * deliberate: it is what stops the wheel being detectable by anyone counting
   * a few hundred spins. An engine with no noise is a pattern.
   */
  noiseRate: number;
  /** `auto`'s target share of turnover to hold. */
  targetHoldPct: number;
  /** Rounds `auto` averages hold over. */
  windowRounds: number;
  /** Consecutive rounds allowed to land on a pocket nobody backed. */
  maxZeroBetStreak: number;
  /** Share of a round's stake making one account a whale. */
  whaleThresholdPct: number;
  /** Consecutive giving rounds one account may headline. */
  maxBeneficiaryStreak: number;
}

export const DEFAULT_PARAMS: Readonly<EngineParams> = {
  partyBalanceEnabled: false,
  partyBalanceMode: "rtpBand",
  partyTargetRtpBps: 0,
  partyBandBps: 300,
  partyHistoryScope: "all",
  playerCapEnabled: false,
  playerLiftEnabled: false,
  playerBandBps: 2000,
  playerMinRounds: 10,
  rtpHoldBps: 1000,
  rtpRoundCapBps: 0,
  // The defaults make RTP TRY FOR THE TARGET ON EVERY ROUND (operator
  // request, 2026-09-15): no honest rounds, the whole running gap carried
  // into each pick, and never a deliberate minimum-payout round. Each of the
  // three is a switch the operator can flip the other way.
  rtpRecoveryMode: "target",
  rtpHistoryScope: "all",
  rtpAggressivenessEnabled: false,
  rtpNoiseEnabled: false,
  rtpMaxRepeat: 2,
  rtpTieBandPct: 0.02,
  targetBankPaise: null,
  aggressiveness: 0.6,
  paceRounds: 50,
  noiseRate: 0.15,
  targetHoldPct: 0.07,
  windowRounds: 200,
  maxZeroBetStreak: 3,
  whaleThresholdPct: 0.6,
  maxBeneficiaryStreak: 3,
};

/** The admin-settable range of each parameter. Also what the API validates against. */
export const PARAM_BOUNDS = {
  partyTargetRtpBps: { min: 0, max: 10_000, integer: true },
  partyBandBps: { min: 0, max: 5_000, integer: true },
  playerBandBps: { min: 0, max: 5_000, integer: true },
  playerMinRounds: { min: 1, max: 1_000, integer: true },
  // −5000 = 150 % player return: the giveback ceiling. Below that a stream
  // is a promotion nobody could fund; above 10000 it pays nothing at all.
  rtpHoldBps: { min: -5_000, max: 10_000, integer: true },
  rtpRoundCapBps: { min: 0, max: 50_000, integer: true },
  rtpMaxRepeat: { min: 1, max: 50, integer: true },
  rtpTieBandPct: { min: 0, max: 0.2, integer: false },
  aggressiveness: { min: 0, max: 1, integer: false },
  paceRounds: { min: 1, max: 10_000, integer: true },
  noiseRate: { min: 0.02, max: 1, integer: false },
  targetHoldPct: { min: -1, max: 1, integer: false },
  windowRounds: { min: 10, max: 100_000, integer: true },
  maxZeroBetStreak: { min: 0, max: 50, integer: true },
  whaleThresholdPct: { min: 0.01, max: 1, integer: false },
  maxBeneficiaryStreak: { min: 1, max: 50, integer: true },
} as const;

export type NumericParamKey = keyof typeof PARAM_BOUNDS;

function numeric(
  raw: Record<string, unknown>,
  key: NumericParamKey,
): number {
  const b = PARAM_BOUNDS[key];
  const v = raw[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_PARAMS[key];
  if (b.integer && !Number.isInteger(v)) return DEFAULT_PARAMS[key];
  if (v < b.min || v > b.max) return DEFAULT_PARAMS[key];
  return v;
}

/** Merge a stored blob over the defaults, discarding anything unusable. */
export function resolveParams(stored: unknown): EngineParams {
  const raw = (stored ?? {}) as Record<string, unknown>;
  if (typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_PARAMS };
  let target: bigint | null = null;
  const t = raw.targetBankPaise;
  if (typeof t === "string" && /^-?\d{1,18}$/u.test(t)) target = BigInt(t);
  else if (typeof t === "number" && Number.isSafeInteger(t)) target = BigInt(t);
  return {
    partyBalanceEnabled: raw.partyBalanceEnabled === true,
    partyBalanceMode: raw.partyBalanceMode === "noLoser" ? "noLoser" : "rtpBand",
    partyTargetRtpBps: numeric(raw, "partyTargetRtpBps"),
    partyBandBps: numeric(raw, "partyBandBps"),
    partyHistoryScope: (RTP_HISTORY_SCOPES as readonly unknown[]).includes(raw.partyHistoryScope)
      ? (raw.partyHistoryScope as RtpHistoryScope)
      : "all",
    playerCapEnabled: raw.playerCapEnabled === true,
    playerLiftEnabled: raw.playerLiftEnabled === true,
    playerBandBps: numeric(raw, "playerBandBps"),
    playerMinRounds: numeric(raw, "playerMinRounds"),
    rtpHoldBps: numeric(raw, "rtpHoldBps"),
    rtpRoundCapBps: numeric(raw, "rtpRoundCapBps"),
    rtpRecoveryMode: raw.rtpRecoveryMode === "recover" ? "recover" : "target",
    rtpHistoryScope: (RTP_HISTORY_SCOPES as readonly unknown[]).includes(raw.rtpHistoryScope)
      ? (raw.rtpHistoryScope as RtpHistoryScope)
      : "all",
    // Only an explicit `true` switches either on; a missing or malformed
    // value keeps the default, like every other field here.
    rtpAggressivenessEnabled: raw.rtpAggressivenessEnabled === true,
    rtpNoiseEnabled: raw.rtpNoiseEnabled === true,
    rtpMaxRepeat: numeric(raw, "rtpMaxRepeat"),
    rtpTieBandPct: numeric(raw, "rtpTieBandPct"),
    targetBankPaise: target,
    aggressiveness: numeric(raw, "aggressiveness"),
    paceRounds: numeric(raw, "paceRounds"),
    noiseRate: numeric(raw, "noiseRate"),
    targetHoldPct: numeric(raw, "targetHoldPct"),
    windowRounds: numeric(raw, "windowRounds"),
    maxZeroBetStreak: numeric(raw, "maxZeroBetStreak"),
    whaleThresholdPct: numeric(raw, "whaleThresholdPct"),
    maxBeneficiaryStreak: numeric(raw, "maxBeneficiaryStreak"),
  };
}

/** The storable form: bigint out, string in, so jsonb round-trips exactly. */
export function paramsToJson(p: EngineParams): Record<string, unknown> {
  return {
    ...p,
    targetBankPaise: p.targetBankPaise === null ? null : p.targetBankPaise.toString(),
  };
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}
