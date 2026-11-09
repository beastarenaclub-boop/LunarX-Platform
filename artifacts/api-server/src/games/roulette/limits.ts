/**
 * Per-bet-type table limits.
 *
 * `game_config.max_stake_paise` caps the SLIP; these cap each POSITION, and the
 * two are different controls. A position is a place a chip physically goes —
 * `straight [17]`, `split [17,20]`, `red` — and each holds up to its own
 * ceiling independently: POSITIONS DO NOT POOL. That is the rule printed on a
 * real felt and the one the parity spec's third edition names (`maxPerSpot`,
 * 09 §maxPerSpot): 5,000 on straight 17, 5,000 on the split beside it and
 * 5,000 on red are three legal chips even though all three cover 17. The
 * house's exposure to one POCKET is therefore a multiple of the straight
 * ceiling, deliberately — the trade for a limit a player can read off the
 * table. The optional per-pocket cap below is the operator's own control over
 * that multiple and is absent by default.
 *
 * Every type ships at the cabinet's 5,000.00 and there is NO per-position
 * floor: the table minimum (`minStakePaise`) judges the placement's SUM, so
 * ₹5 spread as five ₹1 chips is a legal ₹5 bet. Operators may still tighten
 * a group's ceiling through `rouletteLimits`; a stored `min` is ignored.
 *
 * Pure — no DB, no config — so the bands can be checked in isolation and the
 * client can render the same numbers it will be judged against.
 */
import { coveredPockets, pocketLabel, type BetType, type Wheel } from "./wheel";

export type RouletteLimitGroup =
  | "number"
  | "bracket"
  | "line"
  | "redBlack"
  | "oddEven"
  | "highLow"
  | "dozenColumn";

/**
 * Which band each of the 13 bet types is judged under.
 *
 * `bracket` is split/street/corner — the adjacent-number blocks. `highLow` and
 * `dozenColumn` were not named in the table spec; they carry the outside band
 * because that is where their payout puts them (1:1 and 2:1 respectively), not
 * because anyone chose it. Change them here if the table wants otherwise.
 *
 * BOTH WHEELS share these groups. The bands are in money, not in odds, so they
 * do not need to differ: a straight-up chip is the concentrated-liability bet on
 * the mini table too, and it pays less there rather than more.
 */
export const LIMIT_GROUP: Readonly<Record<BetType, RouletteLimitGroup>> = {
  straight: "number",
  split: "bracket",
  street: "bracket",
  corner: "bracket",
  sixline: "line",
  red: "redBlack",
  black: "redBlack",
  odd: "oddEven",
  even: "oddEven",
  high: "highLow",
  low: "highLow",
  dozen: "dozenColumn",
  column: "dozenColumn",
};

export interface LimitBand {
  /** Kept for the stored shape; NOT enforced — see `checkRouletteLimits`. */
  minPaise: bigint;
  maxPaise: bigint;
}

const rupees = (n: number) => BigInt(n) * 100n;

/**
 * The stored shape's ceiling: paise integers, one entry per group, any subset.
 * Same ceiling as `maxStakePaise` in lib/gameConfigResolver.ts, for the same
 * reason — the bound's job is to stop a value that breaks the arithmetic, not
 * to enforce a house style.
 */
export const LIMIT_MAX_PAISE = 100_000_000_000;

/**
 * The shipped BANDS impose no ceiling of their own: the day-to-day ceiling is
 * `game_config.max_per_spot_paise` (5,000.00 by default, per partner through
 * their overrides), applied over these by `withSpotCap`. A band is the
 * operator's optional HARD cap per group — set one and it wins over any spot
 * value, platform or partner — plus the optional per-group floor.
 */
const SPOT_DEFAULT: LimitBand = { minPaise: 0n, maxPaise: BigInt(LIMIT_MAX_PAISE) };

export const ROULETTE_LIMITS: Readonly<Record<RouletteLimitGroup, LimitBand>> = {
  number: SPOT_DEFAULT,
  bracket: SPOT_DEFAULT,
  line: SPOT_DEFAULT,
  redBlack: SPOT_DEFAULT,
  oddEven: SPOT_DEFAULT,
  highLow: SPOT_DEFAULT,
  dozenColumn: SPOT_DEFAULT,
};

export class RouletteLimitError extends Error {
  constructor(
    readonly group: RouletteLimitGroup,
    readonly direction: "min" | "max",
    readonly band: LimitBand,
    /**
     * WHICH position, so the refusal can say so. The server's sentence names
     * the type and the figure; on a board of thirty-six the selection is the
     * part a player has to act on, and the client appends it (spec 16 §4).
     */
    readonly type: BetType,
    readonly selection: readonly number[],
    /** The position's total had the chip been accepted. */
    readonly totalPaise: bigint,
  ) {
    super("ROULETTE_LIMIT");
  }
}

/**
 * Too much money on ONE POCKET, counting every bet that covers it.
 *
 * Distinct from `RouletteLimitError`, which is about a POSITION. The two are
 * different questions and the position bands cannot answer this one.
 */
export class RoulettePocketLimitError extends Error {
  constructor(
    readonly pocket: number,
    /**
     * Carried, not derived at the route: "00" is pocket 37 on the classic
     * wheel and 19 on the mini one, and the error mapper is module-level with
     * no wheel in scope. The thrower has one.
     */
    readonly label: string,
    readonly capPaise: bigint,
    readonly totalPaise: bigint,
  ) {
    super("ROULETTE_POCKET_LIMIT");
  }
}

/**
 * The identity of a POSITION on the layout — the thing a limit applies to.
 *
 * `type` plus the SORTED selection — the spec's `spotKey`. Sorted because
 * `split [17,20]` and `split [20,17]` are one spot on the felt, and a client
 * keying on send order would disagree with the server about it.
 *
 * It USED to be keyed on the pockets covered, which merged the mini wheel's
 * `dozen[1]` and `sixline[1]` (the same six numbers) into one position. The
 * third-edition spec is explicit that they are two: positions stand alone and
 * do not pool, whatever they cover. Keyed by type, no coverage is computed for
 * a limit anywhere.
 *
 * Aggregating by this before checking the maximum is the whole point. A slip is
 * an array and nothing stops a client sending the same chip twice: without the
 * sum, ten separate ₹5,000 straights on 17 all pass the ₹5,000 cap and put
 * ₹50,000 on one position, which is exactly what the cap exists to prevent.
 * The minimum is summed too, so four ₹5 chips on red are one ₹20 position.
 */
export function positionKey(bet: { type: BetType; selection: readonly number[] }): string {
  return `${bet.type}:${[...bet.selection].sort((a, b) => a - b).join(",")}`;
}

/**
 * Throw if any position falls outside its band, counting everything this player
 * already has on that position IN THIS ROUND.
 *
 * `prior` is the player's already-accepted chips. Without it the sum above
 * lives inside one placement, and the cap is per REQUEST rather than per
 * position: five separate placements of the ₹2,000 maximum on pocket 17 each
 * pass on their own and put ₹10,000 on one pocket — measured, and it settled at
 * 36x for ₹3,60,000 against the ₹72,000 the band exists to bound. The comment
 * above always described the right rule; it was only ever applied to the array
 * in hand.
 *
 * Runs on the already-validated bet list, so coverage and stake shape have been
 * checked; this only judges amounts.
 */
export function checkRouletteLimits(
  wheel: Wheel,
  bets: readonly { type: BetType; selection: number[]; amountPaise: bigint }[],
  limits: Readonly<Record<RouletteLimitGroup, LimitBand>> = ROULETTE_LIMITS,
  prior: readonly { type: BetType; selection: number[]; amountPaise: bigint }[] = [],
  /** Total exposure allowed on ONE pocket. Null = no such cap (the default). */
  maxPerPocketPaise: bigint | null = null,
): void {
  const staked = new Map<
    string,
    { type: BetType; selection: readonly number[]; total: bigint; incoming: bigint }
  >();
  const add = (
    bet: { type: BetType; selection: number[]; amountPaise: bigint },
    isIncoming: boolean,
  ) => {
    // An unmapped type would silently escape every limit, so refuse it rather
    // than defaulting to a band — a new bet type must be given one here.
    if (!LIMIT_GROUP[bet.type]) throw new Error("INVALID_ROULETTE_BET");
    const key = positionKey(bet);
    const prev = staked.get(key);
    staked.set(key, {
      type: bet.type,
      selection: bet.selection,
      total: (prev?.total ?? 0n) + bet.amountPaise,
      incoming: (prev?.incoming ?? 0n) + (isIncoming ? bet.amountPaise : 0n),
    });
  };
  for (const bet of prior) add(bet, false);
  for (const bet of bets) add(bet, true);

  for (const { type, selection, total, incoming } of staked.values()) {
    const group = LIMIT_GROUP[type];
    const band = limits[group];
    // NO per-position minimum, ever (operator decision, 2026-09-14, and the
    // spec's own rule): the ONLY floor on a wheel is the table minimum, judged
    // on the placement's TOTAL by `placeTableBets`. ₹5 spread as ₹1 on five
    // spots is a legal ₹5 bet. A stored band `min` is parsed for the shape's
    // sake and enforced nowhere; `"min"` stays in `RouletteLimitError` only
    // so the type does not lie to older readers.
    if (total > band.maxPaise) {
      throw new RouletteLimitError(group, "max", band, type, selection, total);
    }
  }

  /**
   * And the POCKET, which no band bounds.
   *
   * Every bet stakes its whole amount against every pocket it covers — a
   * ₹5,000 split puts ₹5,000 on both numbers, a ₹5,000 red puts ₹5,000 on all
   * eighteen — so a pocket's exposure is the sum over every position touching
   * it, and it settles as that sum if the ball lands there. Judged on the
   * player's whole round, incoming plus prior, for the same reason the bands
   * are: a per-request cap is not a cap.
   *
   * The LOWEST-numbered pocket over the cap is the one named, so the message
   * is deterministic when a wide bet pushes several at once.
   */
  if (maxPerPocketPaise !== null && maxPerPocketPaise > 0n) {
    const perPocket = new Map<number, bigint>();
    for (const bet of [...prior, ...bets]) {
      for (const p of coveredPockets(wheel, bet.type, bet.selection)) {
        perPocket.set(p, (perPocket.get(p) ?? 0n) + bet.amountPaise);
      }
    }
    let worst: number | null = null;
    for (const [pocket, total] of perPocket) {
      if (total <= maxPerPocketPaise) continue;
      if (worst === null || pocket < worst) worst = pocket;
    }
    if (worst !== null) {
      throw new RoulettePocketLimitError(
        worst,
        pocketLabel(wheel, worst),
        maxPerPocketPaise,
        perPocket.get(worst)!,
      );
    }
  }
}

/**
 * The stored shape: paise integers, one entry per group, any subset.
 *
 * Same ceiling as `maxStakePaise` in lib/gameConfigResolver.ts, for the same
 * reason — the bound's job is to stop a value that breaks the arithmetic, not
 * to enforce a house style.
 */

export const LIMIT_GROUPS = Object.keys(ROULETTE_LIMITS) as RouletteLimitGroup[];

/**
 * Validate an operator-supplied limits blob. Throws with a readable reason.
 *
 * Called on the WRITE path so a bad band is refused at the panel rather than
 * silently ignored at read time. Refused, never clamped: a clamp hands the
 * table a limit nobody chose and hides it — the same argument
 * `lib/gameConfigResolver.ts` makes for the partner config bounds.
 */
export function validateRouletteLimits(raw: unknown): void {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("rouletteLimits must be an object keyed by bet group");
  }
  for (const [group, band] of Object.entries(raw as Record<string, unknown>)) {
    if (!LIMIT_GROUPS.includes(group as RouletteLimitGroup)) {
      throw new Error(
        `unknown bet group "${group}" — expected one of ${LIMIT_GROUPS.join(", ")}`,
      );
    }
    if (!band || typeof band !== "object") {
      throw new Error(`${group}: expected { min, max } in paise`);
    }
    const { min, max } = band as { min?: unknown; max?: unknown };
    for (const [name, v] of [["min", min], ["max", max]] as const) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        throw new Error(`${group}.${name} must be a whole number of paise`);
      }
      if (v > LIMIT_MAX_PAISE) {
        throw new Error(`${group}.${name} exceeds ${LIMIT_MAX_PAISE} paise`);
      }
    }
    // A zero maximum is a closed table dressed as a limit; `enabled` is the
    // honest way to say that, so it is refused here.
    if ((max as number) < 1) throw new Error(`${group}.max must be at least 1 paisa`);
    if ((min as number) > (max as number)) {
      throw new Error(`${group}.min (${min}) is above ${group}.max (${max})`);
    }
  }
}

/**
 * Resolve stored limits into the bands the adapter enforces.
 *
 * A group missing from the blob keeps its shipped band, so an operator can save
 * only the numbers they care about. A group whose stored band is malformed ALSO
 * falls back rather than throwing: this runs on the bet path, and a corrupt blob
 * must not take the table down — the write path above is what stops one being
 * stored in the first place.
 */
export function parseRouletteLimits(
  raw: unknown,
): Readonly<Record<RouletteLimitGroup, LimitBand>> {
  if (!raw || typeof raw !== "object") return ROULETTE_LIMITS;
  const stored = raw as Record<string, { min?: unknown; max?: unknown }>;
  const out = {} as Record<RouletteLimitGroup, LimitBand>;
  for (const group of LIMIT_GROUPS) {
    const band = stored[group];
    const min = band?.min;
    const max = band?.max;
    const usable =
      typeof min === "number" &&
      typeof max === "number" &&
      Number.isInteger(min) &&
      Number.isInteger(max) &&
      min >= 0 &&
      max >= 1 &&
      min <= max &&
      max <= LIMIT_MAX_PAISE;
    out[group] = usable
      ? { minPaise: BigInt(min), maxPaise: BigInt(max) }
      : ROULETTE_LIMITS[group];
  }
  return out;
}

/**
 * The optional cap on TOTAL EXPOSURE against a single pocket, in paise.
 *
 * The position bands bound one position at a time, and nothing bounded the
 * pocket. A player holding the ₹2,000 straight-up maximum on 17 could add the
 * ₹20,000 maximum on red, on odd, on the second dozen, on the second column
 * and on every split and corner containing 17 — each its own position, each
 * inside its own band, and every one of them paying out if 17 comes up. The
 * sum of what one number can cost had no ceiling at all.
 *
 * Stored beside the bands in the same `rouletteLimits` JSON, so there is no
 * new column and the existing editor reaches it. ABSENT MEANS UNLIMITED: this
 * is a control an operator opts into, because the right number is a
 * risk decision and inventing one here would start refusing legitimate play on
 * every table at once.
 */
export function parsePerPocketCapPaise(raw: unknown): bigint | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as { maxPerPocket?: unknown }).maxPerPocket;
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return null;
  if (v * 100 > Number(LIMIT_MAX_PAISE)) return null;
  return BigInt(v) * 100n;
}

/**
 * The bands with the per-spot ceiling applied: every group's maximum becomes
 * the TIGHTER of its band and the cap. Null/absent cap = the bands alone.
 */
export function withSpotCap(
  limits: Readonly<Record<RouletteLimitGroup, LimitBand>>,
  capPaise: bigint | null | undefined,
): Readonly<Record<RouletteLimitGroup, LimitBand>> {
  if (capPaise === null || capPaise === undefined || capPaise <= 0n) return limits;
  const out = {} as Record<RouletteLimitGroup, LimitBand>;
  for (const [g, b] of Object.entries(limits) as [RouletteLimitGroup, LimitBand][]) {
    const maxPaise = b.maxPaise < capPaise ? b.maxPaise : capPaise;
    out[g] = { minPaise: b.minPaise < maxPaise ? b.minPaise : maxPaise, maxPaise };
  }
  return out;
}

/** The bands as the client and the panels want them: rupees, plain numbers. */
export function limitsForDisplay(
  limits: Readonly<Record<RouletteLimitGroup, LimitBand>> = ROULETTE_LIMITS,
): Record<RouletteLimitGroup, { min: number; max: number }> {
  const out = {} as Record<RouletteLimitGroup, { min: number; max: number }>;
  for (const [group, band] of Object.entries(limits) as [
    RouletteLimitGroup,
    LimitBand,
  ][]) {
    out[group] = { min: Number(band.minPaise) / 100, max: Number(band.maxPaise) / 100 };
  }
  return out;
}

/** Human label for an error message, e.g. "Straight-up". */
export const GROUP_LABEL: Readonly<Record<RouletteLimitGroup, string>> = {
  number: "Straight-up",
  bracket: "Split/street/corner",
  line: "Line",
  redBlack: "Red/black",
  oddEven: "Odd/even",
  highLow: "High/low",
  dozenColumn: "Dozen/column",
};
