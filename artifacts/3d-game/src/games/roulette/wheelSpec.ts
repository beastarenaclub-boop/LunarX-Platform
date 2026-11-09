/**
 * The two wheels, client side.
 *
 * This is the SAME parameterised construction the server uses
 * (`api-server/src/games/roulette/wheel.ts`), and it is duplicated rather than
 * shared for one reason: the client cannot import from the API server, and a
 * fourth workspace package to carry forty lines of pure arithmetic costs more
 * than the copy. `__tests__/wheelParity.test.ts` reads the SAME generated
 * reference tables the server's own test reads, so the two cannot drift — a
 * copy without that check would be the defect, not the copy.
 *
 * There is deliberately no `if (mini)` anywhere. Every difference falls out of
 * `numberCount`.
 */

export type BetType =
  | "straight"
  | "split"
  | "street"
  | "corner"
  | "sixline"
  | "dozen"
  | "column"
  | "red"
  | "black"
  | "odd"
  | "even"
  | "low"
  | "high";

export const BET_TYPES: readonly BetType[] = [
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
];

export interface Wheel {
  /** The game code: the route, the API prefix and the realtime game name. */
  readonly code: "roulette-american" | "roulette-mini";
  readonly title: string;
  readonly numberCount: number;
  /** What "00" encodes as. 37 on the classic wheel, 19 on the mini. NEVER hardcode it. */
  /** The pocket "00" encodes as, or NULL on a single-zero wheel. */
  readonly doubleZero: number | null;
  readonly pocketCount: number;
  /** Pockets per dozen and per column. */
  readonly third: number;
  /** Pockets in low, and in high. */
  readonly half: number;
  /** Printed columns on the chart art: 12 classic, 6 mini. */
  readonly columns: number;
  /** Pocket order clockwise from the top of the unrotated ring sprite. */
  readonly order: readonly number[];
  /** Where pocket 0 sits on the unrotated sprite, radians clockwise from 12 o'clock. */
  readonly zeroOffset: number;
}

/**
 * One red set for both wheels, restricted to each one's range.
 *
 * That restriction lands on exactly 9 red and 9 black for the mini table, and
 * means a number never changes colour between the two. A second hand-written
 * mini list would be nine chances to make them disagree.
 */
const RED: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

/** Clockwise from the sprite's 12 o'clock. Pinned to the ring art. */
const CLASSIC_ORDER = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, 37, 27,
  10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
] as const;

/**
 * The mini ring, 19 wedges: the classic order with every number above 18 AND
 * the 00 wedge removed. `2 → 0 → 9` are still the zero's neighbours, which is
 * how you can see the sprite was edited around the zero rather than redrawn.
 */
const MINI_ORDER = [
  0, 9, 11, 7, 17, 5, 15, 3, 13, 1, 10, 12, 8, 18, 6, 16, 4, 14, 2,
] as const;

export const CLASSIC: Wheel = {
  code: "roulette-american",
  title: "Roulette",
  numberCount: 36,
  doubleZero: 37,
  pocketCount: 38,
  third: 12,
  half: 18,
  columns: 12,
  order: CLASSIC_ORDER,
  // 28 pockets round from 12 o'clock — a whole number of pockets on this art.
  zeroOffset: 28 * ((2 * Math.PI) / 38),
};

/**
 * The mini wheel: 19 pockets, a SINGLE zero.
 *
 * It had 20 with a 00 encoded as pocket 19, until that wedge came off the ring,
 * the bowl and the chart. The paytable did not change — every multiplier is
 * still `18 / covered` — so taking a losing pocket away halved the edge from
 * 10.00% to `1 − 18/19` = 5.26%, the same as the classic table.
 */
export const MINI: Wheel = {
  code: "roulette-mini",
  title: "Mini Roulette",
  numberCount: 18,
  doubleZero: null,
  pocketCount: 19,
  third: 6,
  half: 9,
  columns: 6,
  order: MINI_ORDER,
  // NOT a whole number of pockets: the edited art measures 266.00 degrees
  // round, which is 14.04 of its own 18.95-degree pockets. Rounding it would
  // sit the ball off its number, every spin. Within 0.02 degrees of the
  // retired 20-pocket sprite — the editor kept `0` where it was and removed
  // the 00 wedge around it.
  zeroOffset: (266.0 * Math.PI) / 180,
};

/**
 * The pocket the mini wheel USED to encode "00" as.
 *
 * History is not rewritten: rounds settled before the change hold pocket 19 and
 * must still draw as "00" in green. Display only — nothing may bet on it or
 * draw it.
 */
export const MINI_RETIRED_DOUBLE_ZERO = 19;

/** Radians per pocket on the ring. */
export function sweepOf(wheel: Wheel): number {
  return (2 * Math.PI) / wheel.pocketCount;
}

/** "00" for the double zero, the number otherwise. */
/**
 * A pocket the wheel once had but no longer deals — only the mini wheel's
 * retired 00. DISPLAY ONLY: a round settled before the change holds pocket 19
 * and its history entry must still read "00" in green, because that is what
 * the wheel landed on that day.
 */
function isRetiredPocket(wheel: Wheel, pocket: number): boolean {
  return wheel.code === "roulette-mini" && pocket === MINI_RETIRED_DOUBLE_ZERO;
}

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

/** Total return multiplier, stake included: `numberCount / pocketsCovered`. */
export function multiplierFor(wheel: Wheel, type: BetType): number {
  return wheel.numberCount / coveredCount(wheel, type);
}

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

/**
 * The pockets a bet covers.
 *
 * Used to light the covered cells when a chip goes down and to draw the winning
 * layout. It is NOT what the server settles against — the server re-derives
 * coverage from the type and selection it stored — so a disagreement here is a
 * display defect, never a payout one. The parity test is what keeps it from
 * becoming even that.
 *
 * Returns an empty array for a shape this wheel has no bet for, rather than
 * throwing: a chart that threw while drawing would take the screen down.
 */
export function coveredPockets(
  wheel: Wheel,
  type: BetType,
  selection: readonly number[],
): number[] {
  const n = wheel.numberCount;
  const s = selection ?? [];
  const inRange = (p: number | undefined): p is number =>
    typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= n;

  switch (type) {
    case "straight": {
      const p = s[0];
      return typeof p === "number" && p >= 0 && p < wheel.pocketCount ? [p] : [];
    }
    case "split": {
      if (s.length !== 2) return [];
      const pair = [...s].sort((a, b) => a - b) as [number, number];
      return splitIsLegal(wheel, pair) ? pair : [];
    }
    case "street": {
      const a = s[0];
      if (!inRange(a) || a % 3 !== 1) return [];
      return [a, a + 1, a + 2];
    }
    case "sixline": {
      const a = s[0];
      if (!inRange(a) || a % 3 !== 1 || a + 5 > n) return [];
      return [a, a + 1, a + 2, a + 3, a + 4, a + 5];
    }
    case "corner": {
      const a = s[0];
      if (!inRange(a) || a % 3 === 0 || a + 4 > n) return [];
      return [a, a + 1, a + 3, a + 4];
    }
    case "dozen": {
      const d = s[0];
      if (d !== 1 && d !== 2 && d !== 3) return [];
      return Array.from({ length: wheel.third }, (_, i) => (d - 1) * wheel.third + i + 1);
    }
    case "column": {
      const c = s[0];
      if (c !== 1 && c !== 2 && c !== 3) return [];
      return Array.from({ length: wheel.third }, (_, i) => c + i * 3);
    }
    default: {
      if (s.length !== 0) return [];
      const all = Array.from({ length: n }, (_, i) => i + 1);
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
          return [];
      }
    }
  }
}

/**
 * The five splits that touch a zero, and the only ones.
 *
 * There is no five-number bet (0-00-1-2-3) on this table, no basket, no top
 * line, no neighbours and no call bets. The paytable has no line for any of
 * them, so one could only be paid at odds nobody chose.
 */
export function zeroSplits(wheel: Wheel): [number, number][] {
  const dz = wheel.doubleZero;
  if (dz === null) {
    // A SINGLE zero sits above all three columns, so it splits with the whole
    // top row and with nothing else.
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
  if (a < 1 || b > wheel.numberCount) return false;
  // Along a row, without wrapping from one row into the next.
  if (b === a + 1 && a % 3 !== 0) return true;
  // Between rows: same column, one row apart.
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
  for (let p = 1; p + 4 <= wheel.numberCount; p++) if (p % 3 !== 0) out.push(p);
  return out;
}

/** Every legal bet on a wheel: 157 classic, 85 mini. */
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

/** A stable identity for one POSITION on the layout — the thing a chip sits on. */
export function stakeKey(type: BetType, selection: readonly number[]): string {
  return `${type}:${[...selection].sort((a, b) => a - b).join(",")}`;
}

/** How a position reads in a refusal message: "17", "17/18", "red". */
export function positionLabel(
  wheel: Wheel,
  type: BetType,
  selection: readonly number[],
): string {
  switch (type) {
    case "straight":
      return pocketLabel(wheel, selection[0]!);
    case "split":
      return selection.map((p) => pocketLabel(wheel, p)).join("/");
    case "street":
    case "sixline":
    case "corner":
      return coveredPockets(wheel, type, selection)
        .map((p) => pocketLabel(wheel, p))
        .join("/");
    case "dozen":
      return `dozen ${selection[0]}`;
    case "column":
      return `column ${selection[0]}`;
    default:
      return type;
  }
}
