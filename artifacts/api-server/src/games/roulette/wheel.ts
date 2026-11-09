/**
 * The wheel: one parameterised factory, two tables.
 *
 * `roulette` is the American wheel — 38 pockets, 0 and 00, numbers 1–36.
 * `roulette-mini` is the same wheel with `numberCount` halved — 20 pockets,
 * still BOTH zeros, numbers 1–18.
 *
 * There is deliberately NO `if (game === "roulette-mini")` anywhere in this
 * file or in anything that reads it. Every difference between the two tables —
 * pocket count, what "00" encodes as, the grid, the even-money groups, the
 * whole paytable — falls out of `numberCount`. A rebuild that special-cases
 * instead drifts: the second wheel is where a forgotten branch hides, because
 * it is the one nobody plays while testing.
 *
 * Pure. No DB, no config, no imports. That is what lets the payout table be
 * unit-tested against the reference CSVs and lets the client be handed the same
 * coverage the server settles on.
 */

/** "00" is `numberCount + 1`. NEVER hardcode 37 — the mini wheel's is 19. */
export interface Wheel {
  /**
   * The game code this wheel belongs to; the wire value, the folder name and
   * `game_config.game_code`. Narrowed so a wheel can be handed straight to the
   * table-round engine without a cast that would let a typo through.
   */
  readonly code: RouletteGameCode;
  /** 36 on the classic wheel, 18 on the mini. Everything derives from it. */
  readonly numberCount: number;
  /** The pocket "00" encodes as: `numberCount + 1`. */
  /** The pocket "00" encodes as, or NULL on a single-zero wheel. */
  readonly doubleZero: number | null;
  /** `numberCount + 2` — the two zeros plus the numbers. */
  readonly pocketCount: number;
  /** Pockets per dozen and per column: `numberCount / 3`. */
  readonly third: number;
  /** Pockets in low and in high: `numberCount / 2`. */
  readonly half: number;
}

export const BET_TYPES = [
  "straight",
  "split",
  "street",
  "corner",
  "sixline",
  "dozen",
  "column",
  "red",
  "black",
  "odd",
  "even",
  "low",
  "high",
] as const;

export type BetType = (typeof BET_TYPES)[number];

/**
 * The red pockets, as ONE set for both wheels.
 *
 * The mini wheel reuses it restricted to 1..18, which lands on exactly 9 red
 * and 9 black — so a number never changes colour between the two tables. A
 * second, hand-written mini list would be nine chances to make them disagree.
 */
const RED: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export const ROULETTE_GAME_CODES = ["roulette-american", "roulette-mini"] as const;
export type RouletteGameCode = (typeof ROULETTE_GAME_CODES)[number];

/**
 * How many zeros a wheel has — and therefore its edge.
 *
 * It used to be hardcoded at two, which is what made the wheel "the same wheel
 * with `numberCount` halved". The mini table LOST ITS 00 (parity hand-off,
 * second edition), so the count is an input now and `doubleZero` is nullable.
 * Every 00 call site has to answer for a wheel that has none, which is exactly
 * why the type says so rather than a sentinel like -1.
 */
function makeWheel(
  code: RouletteGameCode,
  numberCount: number,
  zeros: 1 | 2,
): Wheel {
  if (numberCount % 3 !== 0 || numberCount < 3) {
    // The layout is three columns wide on both tables. A count that does not
    // divide by three has no grid, so this throws at construction rather than
    // producing a wheel whose streets are ragged.
    throw new Error(`numberCount must be a positive multiple of 3: ${numberCount}`);
  }
  return {
    code,
    numberCount,
    doubleZero: zeros === 2 ? numberCount + 1 : null,
    pocketCount: numberCount + zeros,
    third: numberCount / 3,
    half: numberCount / 2,
  };
}

/**
 * The two shipped wheels. Nothing else may construct one.
 *
 * The MINI wheel is 19 pockets — 0 and 1-18, a single zero. The payouts did
 * not change with the 00 (they are `numberCount / covered` either way), so
 * taking a losing pocket off the wheel halved its edge from 10.00% to
 * `1 − 18/19` = 5.26%, the same as the classic table. That is the whole
 * commercial effect of the change and it was an operator decision, not a
 * derivation: see CLAUDE.md.
 */
export const CLASSIC = makeWheel("roulette-american", 36, 2);
export const MINI = makeWheel("roulette-mini", 18, 1);

/**
 * The pocket the mini wheel USED to encode "00" as, before it was retired.
 *
 * Kept because history is not rewritten: rounds settled before the change hold
 * pocket 19 and must still render as "00" in green. Nothing may bet on it,
 * draw it or accept it — `isPocket` refuses it now — and this constant exists
 * only so the display path can recognise a historical row.
 */
export const MINI_RETIRED_DOUBLE_ZERO = 19;

export const WHEELS: Readonly<Record<string, Wheel>> = {
  "roulette-american": CLASSIC,
  "roulette-mini": MINI,
};

export function isRouletteGame(code: string): code is RouletteGameCode {
  return Object.hasOwn(WHEELS, code);
}

export function wheelFor(code: string): Wheel {
  const w = WHEELS[code];
  if (!w) throw new Error(`UNKNOWN_WHEEL:${code}`);
  return w;
}

/**
 * Is this a pocket the wheel once had but no longer deals?
 *
 * Only the mini wheel's retired 00. DISPLAY ONLY: a round settled before the
 * change holds pocket 19 and its history row must still read "00" in green,
 * because that is what the wheel actually landed on that day. Nothing may bet
 * on it or draw it — `isPocket` refuses it.
 */
function isRetiredPocket(wheel: Wheel, pocket: number): boolean {
  return wheel.code === "roulette-mini" && pocket === MINI_RETIRED_DOUBLE_ZERO;
}

/** `"00"` for the double zero, the number otherwise. A client rendering this needs no special case. */
export function pocketLabel(wheel: Wheel, pocket: number): string {
  if (wheel.doubleZero !== null && pocket === wheel.doubleZero) return "00";
  if (isRetiredPocket(wheel, pocket)) return "00";
  return String(pocket);
}

export function pocketColor(
  wheel: Wheel,
  pocket: number,
): "green" | "red" | "black" {
  if (pocket === 0) return "green";
  if (wheel.doubleZero !== null && pocket === wheel.doubleZero) return "green";
  if (isRetiredPocket(wheel, pocket)) return "green";
  return RED.has(pocket) ? "red" : "black";
}

export function isPocket(wheel: Wheel, n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isInteger(n) &&
    n >= 0 &&
    n < wheel.pocketCount
  );
}

// ---------------------------------------------------------------------------
// The paytable
// ---------------------------------------------------------------------------

/**
 * Odds "to 1". A winning bet returns `stake × (odds + 1)`, stake included.
 *
 * Every multiplier is `numberCount ÷ pocketsCovered`, so the edge is
 * `1 − numberCount/pocketCount` and is FLAT across the table:
 *
 *   classic  1 − 36/38 =  5.26%
 *   mini     1 − 18/20 = 10.00%
 *
 * The mini edge is about double, and that is not a choice anyone made — it
 * follows from keeping BOTH zeros on a half-size wheel.
 *
 * `corner` on the mini wheel covers 4 of 18 and so returns 4.5×. It is the only
 * fractional multiplier on either table and it is the entire reason payouts
 * floor rather than round.
 */
export function coveredCount(wheel: Wheel, type: BetType): number {
  switch (type) {
    case "straight":
      return 1;
    case "split":
      return 2;
    case "street":
      return 3;
    case "corner":
      return 4;
    case "sixline":
      return 6;
    case "dozen":
    case "column":
      return wheel.third;
    default:
      return wheel.half;
  }
}

/** Total return multiplier, stake included: `numberCount / pocketsCovered`. */
export function multiplierFor(wheel: Wheel, type: BetType): number {
  return wheel.numberCount / coveredCount(wheel, type);
}

/**
 * The house edge this wheel's paytable produces. Derived, never read from a
 * stored column.
 *
 * Written as "the two zeros out of the pockets" rather than as
 * `1 - numberCount/pocketCount`, which is the same number in arithmetic and a
 * DIFFERENT float: the subtraction form lands two ulps off 2/38 and stops being
 * equal to the value seeded into `game_config.house_edge`, which is exactly the
 * comparison a config test makes.
 */
export function wheelHouseEdge(wheel: Wheel): number {
  return (wheel.pocketCount - wheel.numberCount) / wheel.pocketCount;
}

// ---------------------------------------------------------------------------
// Coverage — the ONLY definition of what a bet wins on
// ---------------------------------------------------------------------------

export class BetShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BetShapeError";
  }
}

/**
 * The grid, for reference, is three columns wide and `numberCount/3` rows deep:
 *
 *   row r holds 3r+1, 3r+2, 3r+3
 *
 * and it is DRAWN rotated — twelve columns of three on the classic chart art,
 * six on the mini one. The drawing has no bearing on any of the arithmetic
 * below; only the client cares which way up it is.
 *
 * Selection encoding, which is the compact form the wire carries:
 *
 *   straight  [pocket]              corner   [lowest covered pocket]
 *   split     [two pockets]         dozen    [1|2|3]
 *   street    [row-start pocket]    column   [1|2|3]
 *   sixline   [row-start pocket]    even-money  []
 *
 * A client never says what a bet covers. This function is the only definition,
 * and settlement re-derives coverage from the stored type and selection rather
 * than trusting anything recorded at placement.
 */
export function coveredPockets(
  wheel: Wheel,
  type: BetType,
  selection: readonly number[],
): number[] {
  const sel = selection ?? [];
  const n = wheel.numberCount;

  const isNumber = (p: number) => Number.isInteger(p) && p >= 1 && p <= n;

  switch (type) {
    case "straight": {
      if (sel.length !== 1 || !isPocket(wheel, sel[0])) {
        throw new BetShapeError(
          `straight takes exactly one pocket 0..${wheel.pocketCount - 1}`,
        );
      }
      return [sel[0]!];
    }

    case "split": {
      if (sel.length !== 2 || !sel.every((p) => isPocket(wheel, p))) {
        throw new BetShapeError("split takes exactly two pockets");
      }
      const pair = [...sel].sort((a, b) => a - b) as [number, number];
      if (!splitIsLegal(wheel, pair)) {
        throw new BetShapeError(
          `${pair[0]} and ${pair[1]} are not adjacent on the layout — the ` +
            `${wheel.code} wheel ${
              wheel.doubleZero === null
                ? "has a single zero"
                : `encodes 00 as pocket ${wheel.doubleZero}`
            }, and the only splits touching a zero are ${zeroSplits(wheel)
              .map(([a, b]) => `[${a},${b}]`)
              .join(" ")}`,
        );
      }
      return pair;
    }

    case "street": {
      const start = sel[0];
      if (sel.length !== 1 || !isNumber(start!) || start! % 3 !== 1) {
        throw new BetShapeError(
          `street takes one row-start pocket: ${streetStarts(wheel).join(", ")}`,
        );
      }
      return [start!, start! + 1, start! + 2];
    }

    case "sixline": {
      const start = sel[0];
      if (
        sel.length !== 1 ||
        !isNumber(start!) ||
        start! % 3 !== 1 ||
        start! + 5 > n
      ) {
        throw new BetShapeError(
          `sixline takes one row-start pocket with a row below it: ${sixlineStarts(
            wheel,
          ).join(", ")}`,
        );
      }
      return [start!, start! + 1, start! + 2, start! + 3, start! + 4, start! + 5];
    }

    case "corner": {
      // The lowest pocket of the square. It cannot sit in the third column (the
      // square would run off the layout) and it cannot sit in the last row.
      const start = sel[0];
      if (
        sel.length !== 1 ||
        !isNumber(start!) ||
        start! % 3 === 0 ||
        start! + 4 > n
      ) {
        throw new BetShapeError(
          `corner takes the lowest pocket of a 2x2 square: ${cornerStarts(
            wheel,
          ).join(", ")}`,
        );
      }
      return [start!, start! + 1, start! + 3, start! + 4];
    }

    case "dozen": {
      const d = sel[0];
      if (sel.length !== 1 || d !== 1 && d !== 2 && d !== 3) {
        throw new BetShapeError("dozen takes 1, 2 or 3");
      }
      return Array.from({ length: wheel.third }, (_, i) => (d - 1) * wheel.third + i + 1);
    }

    case "column": {
      const c = sel[0];
      if (sel.length !== 1 || (c !== 1 && c !== 2 && c !== 3)) {
        throw new BetShapeError("column takes 1, 2 or 3");
      }
      return Array.from({ length: wheel.third }, (_, i) => c + i * 3);
    }

    default: {
      if (sel.length !== 0) {
        throw new BetShapeError(`${type} takes an empty selection`);
      }
      return evenMoneyPockets(wheel, type);
    }
  }
}

/**
 * The even-money groups.
 *
 * They exclude 0 and 00 — that exclusion IS the house edge on this table. There
 * is no en prison and no la partage anywhere in this game: an even-money bet
 * losing to a zero loses outright.
 */
function evenMoneyPockets(wheel: Wheel, type: BetType): number[] {
  const all = Array.from({ length: wheel.numberCount }, (_, i) => i + 1);
  switch (type) {
    case "red":
      return all.filter((p) => RED.has(p));
    case "black":
      return all.filter((p) => !RED.has(p));
    case "odd":
      return all.filter((p) => p % 2 === 1);
    case "even":
      return all.filter((p) => p % 2 === 0);
    case "low":
      return all.filter((p) => p <= wheel.half);
    case "high":
      return all.filter((p) => p > wheel.half);
    default:
      throw new BetShapeError(`unknown bet type ${type}`);
  }
}

/**
 * The five splits that touch a zero, and the only ones.
 *
 * There is NO five-number bet (0-00-1-2-3) on this table and no basket, top
 * line, neighbours or call bets. A rebuild must not add one: the paytable has
 * no line for it, so it could only be paid at odds nobody chose.
 */
export function zeroSplits(wheel: Wheel): [number, number][] {
  const dz = wheel.doubleZero;
  if (dz === null) {
    // A SINGLE zero sits above all three columns, so it splits with the whole
    // top row and with nothing else. Three splits, not five: `[0,19] [2,19]
    // [3,19]` named a pocket that no longer exists and are refused now.
    return [
      [0, 1],
      [0, 2],
      [0, 3],
    ];
  }
  return [
    [0, 1],
    [0, 2],
    [0, dz],
    [2, dz],
    [3, dz],
  ];
}

function splitIsLegal(wheel: Wheel, [a, b]: [number, number]): boolean {
  if (a === b) return false;
  if (a === 0 || b === wheel.doubleZero || a === wheel.doubleZero) {
    return zeroSplits(wheel).some(([x, y]) => x === a && y === b);
  }
  const n = wheel.numberCount;
  if (a < 1 || b > n) return false;
  // Along a row: adjacent numbers that do not wrap from one row into the next.
  if (b === a + 1 && a % 3 !== 0) return true;
  // Between rows: the same column, one row apart.
  return b === a + 3;
}

export function streetStarts(wheel: Wheel): number[] {
  return Array.from({ length: wheel.third }, (_, r) => r * 3 + 1);
}

export function sixlineStarts(wheel: Wheel): number[] {
  return streetStarts(wheel).slice(0, -1);
}

export function cornerStarts(wheel: Wheel): number[] {
  const out: number[] = [];
  for (let p = 1; p + 4 <= wheel.numberCount; p++) {
    if (p % 3 !== 0) out.push(p);
  }
  return out;
}

/**
 * Every legal bet on a wheel, as (type, selection) pairs.
 *
 * 157 on the classic table, 85 on the mini one. Used by the reference-table
 * check and by the client to build its chart; a UI that offers a bet not in
 * this list is offering one the server will refuse.
 */
export function allLegalBets(wheel: Wheel): { type: BetType; selection: number[] }[] {
  const out: { type: BetType; selection: number[] }[] = [];
  for (let p = 0; p < wheel.pocketCount; p++) out.push({ type: "straight", selection: [p] });
  for (const [a, b] of zeroSplits(wheel)) out.push({ type: "split", selection: [a, b] });
  for (let a = 1; a <= wheel.numberCount; a++) {
    if (a % 3 !== 0) out.push({ type: "split", selection: [a, a + 1] });
    if (a + 3 <= wheel.numberCount) out.push({ type: "split", selection: [a, a + 3] });
  }
  for (const s of streetStarts(wheel)) out.push({ type: "street", selection: [s] });
  for (const s of sixlineStarts(wheel)) out.push({ type: "sixline", selection: [s] });
  for (const s of cornerStarts(wheel)) out.push({ type: "corner", selection: [s] });
  for (const d of [1, 2, 3]) out.push({ type: "dozen", selection: [d] });
  for (const c of [1, 2, 3]) out.push({ type: "column", selection: [c] });
  for (const t of ["red", "black", "odd", "even", "low", "high"] as const) {
    out.push({ type: t, selection: [] });
  }
  return out;
}

/** Settlement's whole test. */
export function betWinsOn(
  wheel: Wheel,
  type: BetType,
  selection: readonly number[],
  pocket: number,
): boolean {
  return coveredPockets(wheel, type, selection).includes(pocket);
}
