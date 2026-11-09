/**
 * The betting chart: where the printed ink is, where the tap zones are, and how
 * a tap becomes a bet.
 *
 * EVERY number here is a FRACTION of the chart art (952 x 270 px), not a pixel.
 * The art is stretched into a slot that moves and grows as the panel opens, so
 * anything expressed in pixels would be right in exactly one panel state.
 *
 * There are TWO grids and they are deliberately different:
 *
 *   the INK grid  — where the rules are actually printed. Splits, corners and
 *                   chip positions are measured against this.
 *   the TAP zones — hand-tuned rectangles over the number boxes, which sit up
 *                   to 12 px of art away from the ink.
 *
 * Collapsing them into one is the obvious simplification and it is wrong: a
 * split resolved against the tap boxes lands on the wrong side of the printed
 * rule, and a chip drawn on the tap box sits visibly off the line.
 */
import { coveredPockets, type BetType, type Wheel } from "./wheelSpec";

/** A rectangle in fractions of the chart art. */
export interface FRect {
  l: number;
  t: number;
  w: number;
  h: number;
}

export interface ChartZone {
  type: BetType;
  selection: number[];
  rect: FRect;
}

// ---------------------------------------------------------------------------
// The ink grid
// ---------------------------------------------------------------------------

/** Left edge of the printed number grid. */
export const CELL_LEFT = 0.0767;
/**
 * Column pitch, per wheel — a LITERAL, not `(0.9233 − 0.0767) / columns`.
 *
 * The exact quotient is 0.070550 and the source's constant is 0.0705, so the
 * derived form drifts a quarter of a base pixel per column and a chip on the
 * far right of the board sits three pixels off its rule. It is the same number
 * to four places and a different board.
 */
const PITCH: Readonly<Record<number, number>> = { 12: 0.0705, 6: 0.1411 };
/**
 * The four horizontal rules, top to bottom. Deliberately UNEVEN — row heights
 * are 0.2111 / 0.2092 / 0.2074 — and listed rather than derived, because the
 * art is what it is and an even split lands the middle rule 2 px off.
 */
export const ROW_EDGES = [0.013, 0.2241, 0.4333, 0.6407] as const;
/** Left edge of the 0/00 column. */
export const ZEROS_LEFT = 0.0042;
/** The one rule inside the zeros column: the 00/0 split, at its midpoint. */
export const ZEROS_SPLIT = (ROW_EDGES[0] + ROW_EDGES[3]) / 2;
/** The top of the dozens row — where the grid's bottom band has to stop. */
export const DOZENS_TOP = 0.6538;
/**
 * How far BELOW the ink grid's bottom rule a street or six-line tap still
 * counts, in cell units: the gutter down to the dozens, so the printed rule is
 * inside the band and the dozens are not (the cabinet's `kBelowLine`).
 */
export const BELOW_LINE = (DOZENS_TOP - ROW_EDGES[3]) / (ROW_EDGES[3] - ROW_EDGES[2]);
/** Half-width of a line band, as a fraction of a cell. The middle 60% of a box stays a box. */
export const EDGE = 0.2;
/** A near-miss inside this many ART pixels snaps to the nearest zone. */
export const SNAP_PX = 20;
export const ART_W = 952;
export const ART_H = 270;

export function cellPitch(wheel: Wheel): number {
  return PITCH[wheel.columns] ?? 0.0705;
}

/** The printed cell of a numbered pocket, as a fraction rect. */
export function numberCell(wheel: Wheel, pocket: number): FRect | null {
  if (pocket === 0) {
    // On a wheel with no 00 the single zero owns the WHOLE column — the mini
    // art prints one `0` down all three rows. The lower half was still being
    // lit on the mini table after the 00 went, so a winning zero flashed half
    // its cell as if the retired pocket were still above it.
    const top = wheel.doubleZero === null ? ROW_EDGES[0] : ZEROS_SPLIT;
    return {
      l: ZEROS_LEFT,
      t: top,
      w: CELL_LEFT - ZEROS_LEFT,
      h: ROW_EDGES[3] - top,
    };
  }
  if (pocket === wheel.doubleZero) {
    return {
      l: ZEROS_LEFT,
      t: ROW_EDGES[0],
      w: CELL_LEFT - ZEROS_LEFT,
      h: ZEROS_SPLIT - ROW_EDGES[0],
    };
  }
  if (pocket < 1 || pocket > wheel.numberCount) return null;
  const col = Math.floor((pocket - 1) / 3);
  // The grid is DRAWN rotated: pocket 3 sits in the top row, 2 in the middle,
  // 1 at the bottom. `p % 3` is what says which.
  const row = pocket % 3 === 0 ? 0 : pocket % 3 === 2 ? 1 : 2;
  const pitch = cellPitch(wheel);
  return {
    l: CELL_LEFT + col * pitch,
    t: ROW_EDGES[row]!,
    w: pitch,
    h: ROW_EDGES[row + 1]! - ROW_EDGES[row]!,
  };
}

/** Cell-unit coordinates inside the ink grid: x 0..columns, y 0..3. */
function unitsAt(wheel: Wheel, fx: number, fy: number): { x: number; y: number } | null {
  const pitch = cellPitch(wheel);
  const x = (fx - CELL_LEFT) / pitch;
  if (x < 0 || x > wheel.columns) return null;
  if (fy < ROW_EDGES[0]! || fy >= DOZENS_TOP) return null;
  // Rows are uneven, so y is interpolated per row rather than scaled.
  for (let r = 0; r < 3; r++) {
    const top = ROW_EDGES[r]!;
    const bottom = ROW_EDGES[r + 1]!;
    if (fy <= bottom) return { x, y: r + (fy - top) / (bottom - top) };
  }
  // The gutter under the grid, in the bottom row's own units: 3 .. 3 + BELOW_LINE.
  return { x, y: 3 + (fy - ROW_EDGES[3]!) / (ROW_EDGES[3]! - ROW_EDGES[2]!) };
}

/** The point on the ink grid for cell-unit coordinates. */
function pointAt(wheel: Wheel, x: number, y: number): { fx: number; fy: number } {
  const pitch = cellPitch(wheel);
  const r = Math.min(2, Math.max(0, Math.floor(y)));
  const top = ROW_EDGES[r]!;
  const bottom = ROW_EDGES[r + 1]!;
  return { fx: CELL_LEFT + x * pitch, fy: top + (y - r) * (bottom - top) };
}

/**
 * What sits under a point on the ink grid: a split on a rule, a corner where two
 * cross, a street or six line on the BOTTOM edge, or nothing.
 *
 * Street and six line resolve on the line under 1, 4, 7 … 34 — the band
 * `y >= 3 − EDGE` running down to the dozens (parity spec 09 §1, third
 * edition): a street over a cell, a six line where two columns meet, both
 * anchored on the row start. They had no tap affordance until they were the
 * one bet a player could not place; the top edge still resolves to nothing,
 * where a near-miss is somebody aiming at a number box.
 */
function lineAt(
  wheel: Wheel,
  fx: number,
  fy: number,
): { type: BetType; selection: number[] } | null {
  // The zeros column has exactly one rule: the 00/0 split — and ONLY on a
  // wheel that has a 00. With a single zero there is no divider inside the
  // column and therefore no in-column split to place, so the whole branch is
  // skipped and the column resolves to straight `[0]` through the boxes.
  if (
    wheel.doubleZero !== null &&
    fx >= ZEROS_LEFT &&
    fx < CELL_LEFT &&
    fy >= ROW_EDGES[0]! &&
    fy < ROW_EDGES[3]!
  ) {
    const half = (ROW_EDGES[3]! - ROW_EDGES[0]!) / 2;
    return Math.abs(fy - ZEROS_SPLIT) < EDGE * half
      ? { type: "split", selection: [0, wheel.doubleZero] }
      : null;
  }

  const u = unitsAt(wheel, fx, fy);
  if (!u) return null;
  const col = Math.floor(u.x);
  const vertical = Math.round(u.x);
  const horizontal = Math.round(u.y);
  const onVertical = Math.abs(u.x - vertical) < EDGE && vertical > 0 && vertical < wheel.columns;
  const onHorizontal = Math.abs(u.y - horizontal) < EDGE && horizontal > 0 && horizontal < 3;

  // The bottom edge FIRST: inside its band a vertical rule is a six line, not
  // the row-two split it would otherwise read as.
  if (u.y >= 3 - EDGE) {
    // A six line joins two streets across a column boundary and is anchored
    // on the LOWER one's row start. `vertical < columns` means the last row
    // can never anchor one — classic tops out at 31, mini at 13.
    if (onVertical) return { type: "sixline", selection: [3 * (vertical - 1) + 1] };
    if (col >= 0 && col < wheel.columns) return { type: "street", selection: [3 * col + 1] };
    return null;
  }

  if (onVertical && onHorizontal) {
    // The lowest pocket of the 2x2 square the two rules cross at.
    return { type: "corner", selection: [3 * vertical - horizontal] };
  }
  if (onVertical) {
    // Two pockets side by side across the rule, in the same drawn row.
    const row = Math.min(2, Math.max(0, Math.floor(u.y)));
    const left = 3 * vertical + (3 - row) - 3;
    return { type: "split", selection: [left, left + 3] };
  }
  if (onHorizontal) {
    // Two pockets one above the other inside the same column.
    const upper = 3 * col + (3 - horizontal) + 1;
    return { type: "split", selection: [upper - 1, upper] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The tuned tap zones
// ---------------------------------------------------------------------------

/**
 * The 38 number boxes on the classic chart, hand-tuned against the art.
 *
 * They are NOT derived, and the small irregularities are the point: the printed
 * boxes are not perfectly regular and a derived grid put several taps in the
 * gutter. The mini boxes below ARE derived, because that art is regular.
 */
const CLASSIC_STRAIGHTS: [number, number, number, number, number][] = [
  // pocket, l, t, w, h
  [37, 0.0119, 0.0281, 0.058, 0.2888],
  [0, 0.011, 0.3407, 0.058, 0.2887],
  [3, 0.0843, 0.0403, 0.056, 0.1647],
  [2, 0.085, 0.2439, 0.056, 0.1647],
  [1, 0.0859, 0.4581, 0.056, 0.1647],
  [6, 0.1555, 0.0396, 0.056, 0.1647],
  [5, 0.155, 0.2416, 0.056, 0.1647],
  [4, 0.155, 0.4585, 0.056, 0.1647],
  [9, 0.2247, 0.042, 0.056, 0.1647],
  [8, 0.2247, 0.2471, 0.056, 0.1647],
  [7, 0.2252, 0.4603, 0.056, 0.1647],
  [12, 0.2971, 0.0431, 0.056, 0.1647],
  [11, 0.296, 0.246, 0.056, 0.1647],
  [10, 0.2952, 0.4585, 0.056, 0.1647],
  [15, 0.3668, 0.041, 0.056, 0.1647],
  [14, 0.3657, 0.2501, 0.056, 0.1647],
  [13, 0.3668, 0.4596, 0.056, 0.1647],
  [18, 0.4367, 0.0418, 0.056, 0.1647],
  [17, 0.4362, 0.2471, 0.056, 0.1647],
  [16, 0.4369, 0.457, 0.056, 0.1647],
  [21, 0.5079, 0.0395, 0.056, 0.1647],
  [20, 0.507, 0.2474, 0.056, 0.1647],
  [19, 0.5065, 0.4577, 0.056, 0.1647],
  [24, 0.577, 0.0392, 0.056, 0.1647],
  [23, 0.5779, 0.2479, 0.056, 0.1647],
  [22, 0.5775, 0.4565, 0.056, 0.1647],
  [27, 0.6473, 0.0404, 0.056, 0.1647],
  [26, 0.6491, 0.2441, 0.056, 0.1647],
  [25, 0.6481, 0.4567, 0.056, 0.1647],
  [30, 0.7189, 0.04, 0.056, 0.1647],
  [29, 0.7182, 0.2484, 0.056, 0.1647],
  [28, 0.7193, 0.4564, 0.056, 0.1647],
  [33, 0.7904, 0.0399, 0.056, 0.1647],
  [32, 0.7895, 0.2478, 0.056, 0.1647],
  [31, 0.7892, 0.458, 0.056, 0.1647],
  [36, 0.8608, 0.0433, 0.056, 0.1647],
  [35, 0.86, 0.2474, 0.056, 0.1647],
  [34, 0.8598, 0.4572, 0.056, 0.1647],
];

/**
 * Everything outside the number grid. Both arts print these at the SAME
 * fractions, to the pixel, so the mini chart reuses them verbatim.
 */
const OUTSIDE: ChartZone[] = [
  { type: "column", selection: [3], rect: { l: 0.9287, t: 0.0289, w: 0.0613, h: 0.1811 } },
  { type: "column", selection: [2], rect: { l: 0.9283, t: 0.2377, w: 0.0613, h: 0.1811 } },
  { type: "column", selection: [1], rect: { l: 0.9287, t: 0.4486, w: 0.0611, h: 0.1811 } },
  { type: "dozen", selection: [1], rect: { l: 0.0823, t: 0.6538, w: 0.272, h: 0.1435 } },
  { type: "dozen", selection: [2], rect: { l: 0.3655, t: 0.6534, w: 0.272, h: 0.1435 } },
  { type: "dozen", selection: [3], rect: { l: 0.6469, t: 0.6558, w: 0.272, h: 0.1435 } },
  { type: "low", selection: [], rect: { l: 0.1214, t: 0.8279, w: 0.132, h: 0.1435 } },
  { type: "even", selection: [], rect: { l: 0.2737, t: 0.8256, w: 0.1017, h: 0.1435 } },
  { type: "red", selection: [], rect: { l: 0.3886, t: 0.8269, w: 0.1073, h: 0.1435 } },
  { type: "black", selection: [], rect: { l: 0.5038, t: 0.8277, w: 0.1111, h: 0.1435 } },
  { type: "odd", selection: [], rect: { l: 0.6229, t: 0.8249, w: 0.1073, h: 0.1435 } },
  { type: "high", selection: [], rect: { l: 0.7497, t: 0.8237, w: 0.132, h: 0.1435 } },
];

/** A mini number box takes 79% of its printed cell, centred — the share the classic boxes measure. */
const BOX_OF_CELL = 0.79;

export function chartZones(wheel: Wheel): ChartZone[] {
  if (wheel.columns === 12) {
    return [
      ...CLASSIC_STRAIGHTS.map(([pocket, l, t, w, h]) => ({
        type: "straight" as const,
        selection: [pocket],
        rect: { l, t, w, h },
      })),
      ...OUTSIDE,
    ];
  }
  /**
   * Mini: ONE zero box, spanning the WHOLE zeros column.
   *
   * It used to be two — the classic art's tuned `00` and `0` boxes, with the
   * upper one re-encoded to this wheel's double zero. The mini table has a
   * single zero now and its art prints one `0` down the whole column, so the
   * box is the UNION of those two rects. Derived from them rather than
   * re-measured, because the column's edges did not move; only the divider
   * between them went.
   */
  const zeroBoxes = CLASSIC_STRAIGHTS.filter(([p]) => p === 37 || p === 0);
  const zl = Math.min(...zeroBoxes.map(([, l]) => l));
  const zt = Math.min(...zeroBoxes.map(([, , t]) => t));
  const zr = Math.max(...zeroBoxes.map(([, l, , w]) => l + w));
  const zb = Math.max(...zeroBoxes.map(([, , t, , h]) => t + h));
  const zeros: ChartZone[] = [
    {
      type: "straight",
      selection: [0],
      rect: { l: zl, t: zt, w: zr - zl, h: zb - zt },
    },
  ];
  const pitch = cellPitch(wheel);
  const numbers: ChartZone[] = [];
  for (let pocket = 1; pocket <= wheel.numberCount; pocket++) {
    const cell = numberCell(wheel, pocket)!;
    const inset = (1 - BOX_OF_CELL) / 2;
    numbers.push({
      type: "straight",
      selection: [pocket],
      rect: {
        l: cell.l + pitch * inset,
        t: cell.t + cell.h * inset,
        w: pitch * BOX_OF_CELL,
        h: cell.h * BOX_OF_CELL,
      },
    });
  }
  return [...zeros, ...numbers, ...OUTSIDE];
}

function contains(r: FRect, fx: number, fy: number): boolean {
  return fx >= r.l && fx < r.l + r.w && fy >= r.t && fy < r.t + r.h;
}

/**
 * Turn a tap into a bet.
 *
 * ORDER IS LOAD-BEARING:
 *
 *   1. LINES FIRST. The tuned boxes tile without gaps, so asking them first
 *      would make every split and corner unreachable.
 *   2. Then the tuned boxes, first match wins.
 *   3. Then a snap to the nearest box within 20 ART pixels — the gutters
 *      between boxes are otherwise dead, and on a phone a 20 px gutter is a lot
 *      of missed taps. Beyond that, nothing.
 */
export function resolveChartTap(
  wheel: Wheel,
  zones: ChartZone[],
  fx: number,
  fy: number,
): { type: BetType; selection: number[] } | null {
  const line = lineAt(wheel, fx, fy);
  if (line) {
    // A line result still has to be a bet this wheel allows: the grid maths
    // produces a shape at every crossing, including ones that run off the
    // layout at the edges.
    if (coveredPockets(wheel, line.type, line.selection).length > 0) return line;
  }

  for (const z of zones) if (contains(z.rect, fx, fy)) return z;

  /**
   * The near-miss snap, measured to the zone's EDGE and in the art's own
   * pixels so the radius means the same thing whatever size the chart is drawn
   * at.
   *
   * It used to measure to the zone's CENTRE, which made the whole step
   * unreachable for the boxes it exists to rescue: a straight zone is
   * 53 x 44.5 art px, so its half-height alone is 22.2 — larger than the 20 px
   * radius. Every point within 20 px of a number's centre is already INSIDE
   * that number and was returned by the `contains` pass above, and the tap that
   * actually needed help — one in the ~14 px gutter between two boxes, or on
   * the rail between Low and Even — measured well over 20 px from every centre
   * and landed on nothing at all. No chip, no message.
   *
   * Distance to the rectangle is zero inside it (already handled) and grows
   * from the edge outwards, which is what "within 20 px of a box" means.
   */
  let best: ChartZone | null = null;
  let bestD = Infinity;
  for (const z of zones) {
    const dx = Math.max(z.rect.l - fx, 0, fx - (z.rect.l + z.rect.w)) * ART_W;
    const dy = Math.max(z.rect.t - fy, 0, fy - (z.rect.t + z.rect.h)) * ART_H;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best && bestD < SNAP_PX * SNAP_PX ? best : null;
}

/**
 * Where a chip sits for a bet.
 *
 * Inside the number grid the INK places it — the cell centre for a straight, ON
 * the rule for a split, on the crossing for a corner. Outside it, the tuned
 * zone's own centre. Returns null for a bet with nowhere to draw, and the
 * caller draws nothing rather than guessing.
 */
export function chipAnchor(
  wheel: Wheel,
  zones: ChartZone[],
  type: BetType,
  selection: readonly number[],
): { fx: number; fy: number } | null {
  const covered = coveredPockets(wheel, type, selection);
  if (covered.length === 0) return null;

  if (type === "straight") {
    const p = selection[0]!;
    // The two zeros sit OUTSIDE the ink grid, so their chip goes on their tuned
    // zone's centre rather than on a printed cell they do not have. Everything
    // else is placed by the ink.
    if (p === 0 || p === wheel.doubleZero) return zoneCentre(zones, type, selection);
    const cell = numberCell(wheel, p);
    if (!cell) return null;
    return { fx: cell.l + cell.w / 2, fy: cell.t + cell.h / 2 };
  }

  if (type === "split" || type === "corner" || type === "street" || type === "sixline") {
    // The zeros' own split has no ink-grid coordinates — it is the rule inside
    // the zeros column.
    if (
      type === "split" &&
      wheel.doubleZero !== null &&
      selection.includes(0) &&
      selection.includes(wheel.doubleZero)
    ) {
      return { fx: (ZEROS_LEFT + CELL_LEFT) / 2, fy: ZEROS_SPLIT };
    }
    const numbers = covered.filter((p) => p >= 1 && p <= wheel.numberCount);
    if (numbers.length !== covered.length) {
      // A split touching a single zero: the source draws no chip for these and
      // offers no way to place one, so there is nothing to anchor.
      return null;
    }
    // The midpoint of the covered cells, in ink coordinates: on the rule for a
    // split, on the crossing for a corner, on the BOTTOM edge for a street or
    // sixline (where the tap that places them lands).
    let sx = 0;
    let sy = 0;
    for (const p of numbers) {
      const c = numberCell(wheel, p)!;
      const u = unitsAtCell(wheel, c);
      sx += u.x;
      sy += u.y;
    }
    // Splits and corners land on the rule (or the crossing) the mean falls on.
    // Streets and sixlines do NOT: their cells are stacked, so the mean would
    // sit in the middle of the column with the chip covering a number. They go
    // on the grid's BOTTOM EDGE — the line under 1, 4, 7 … — which is where
    // they are tapped (they sat on the top edge until they became tappable).
    const uy = type === "street" || type === "sixline" ? 3 : sy / numbers.length;
    const pt = pointAt(wheel, sx / numbers.length, uy);
    return { fx: pt.fx, fy: pt.fy };
  }

  return zoneCentre(zones, type, selection);
}

function zoneCentre(
  zones: ChartZone[],
  type: BetType,
  selection: readonly number[],
): { fx: number; fy: number } | null {
  const key = [...selection].join(",");
  const zone = zones.find((z) => z.type === type && z.selection.join(",") === key);
  if (!zone) return null;
  return { fx: zone.rect.l + zone.rect.w / 2, fy: zone.rect.t + zone.rect.h / 2 };
}

/** The centre of a printed cell, in ink cell units. */
function unitsAtCell(wheel: Wheel, cell: FRect): { x: number; y: number } {
  const pitch = cellPitch(wheel);
  const x = (cell.l - CELL_LEFT) / pitch + 0.5;
  const r = ROW_EDGES.findIndex((e, i) => i < 3 && Math.abs(e - cell.t) < 1e-6);
  return { x, y: (r < 0 ? 0 : r) + 0.5 };
}
