/**
 * The game screen's fixed canvas and every rectangle on it.
 *
 * The whole screen is authored at 2316 x 1080 and STRETCHED to the window —
 * non-uniformly, with no letterbox. Every number below is a pixel on that
 * canvas, and nothing in this game is laid out any other way.
 *
 * The one exception is the wheel, which is counter-scaled so it stays circular
 * on any aspect ratio. See `unstretch()`.
 */

export const CANVAS_W = 2316;
export const CANVAS_H = 1080;

/** A rectangle on the design canvas. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  };
}

/** A slot is a rectangle that moves as the bet panel opens. */
export interface Slot {
  closed: Rect;
  open: Rect;
}

export const at = (s: Slot, t: number): Rect => lerpRect(s.closed, s.open, t);

/**
 * The panel's own numbers.
 *
 * `SPEC_TO_DESIGN` is 1.5 because the open layout was tuned on a 1544 x 720
 * canvas and this one is 2316 x 1080 — exactly 1.5x on both axes. Everything
 * that MOVES when the panel opens also grows by `OPEN_SCALE`; the HUD around it
 * does not move at all.
 */
export const PANEL_MS = 330;
export const OPEN_SCALE = 1.08;

/** Centre a box of `w x h` scaled by OPEN_SCALE on a design-px centre. */
function openBox(cx: number, cy: number, w: number, h: number): Rect {
  const ow = w * OPEN_SCALE;
  const oh = h * OPEN_SCALE;
  return { x: cx - ow / 2, y: cy - oh / 2, w: ow, h: oh };
}

/** The betting chart. Closed it sits low and narrow; open it is nearly full width. */
export const TABLE_SLOT: Slot = {
  closed: rect(82, 594, 2155, 406),
  // LTRB(7.5, 460.5, 2313, 888) — the spec rect (5, 307, 1542, 592) x 1.5.
  open: rect(7.5, 460.5, 2305.5, 427.5),
};

/** #013D01, painted UNDER the chart because the art is transparent between cells. */
export const PANEL_BACKING = "#013D01";

/**
 * The eight chip denominations, in tray order. The 1 and 5 chips came OFF the
 * rack and 10000 / 20000 went on (operator request, 2026-10-10) — eight slots
 * still, so every rect below keeps its place; only which chip sits in it
 * moved. The cabinet's own `coin_1` / `coin_5` art stays on disk, unimported.
 */
export const CHIPS = [10, 50, 100, 500, 1000, 5000, 10000, 20000] as const;
export type ChipValue = (typeof CHIPS)[number];

/**
 * Default selection: the smallest chip, which is the smallest thing a player
 * can commit by accident (parity spec 09, third edition — it was 5, then 1;
 * 10 since the rack lost its two smallest chips).
 */
export const DEFAULT_CHIP: ChipValue = 10;

const CHIP_CLOSED: Record<ChipValue, Rect> = {
  10: rect(39, 405, 121, 54),
  50: rect(202, 405, 121, 54),
  100: rect(366, 405, 121, 54),
  500: rect(529, 405, 121, 54),
  1000: rect(39, 485, 121, 54),
  5000: rect(202, 485, 121, 54),
  10000: rect(366, 485, 121, 54),
  20000: rect(529, 485, 121, 54),
};

/**
 * Open tray: top row [10, 50, 100] and bottom row [500, 1000, 5000, 10000,
 * 20000], each row centred on the same midline. The rows are NOT the same
 * length, which is why they are centred rather than laid out from a common
 * left edge.
 */
const OPEN_ROWS: [ChipValue[], number][] = [
  [[10, 50, 100], 184.5 * 1.5],
  [[500, 1000, 5000, 10000, 20000], 246.5 * 1.5],
];
const OPEN_PITCH = 117.25 * 1.5;
const OPEN_MID_X = 773.5 * 1.5;

const CHIP_OPEN: Record<ChipValue, Rect> = (() => {
  const out = {} as Record<ChipValue, Rect>;
  for (const [row, cy] of OPEN_ROWS) {
    const startX = OPEN_MID_X - ((row.length - 1) * OPEN_PITCH) / 2;
    row.forEach((chip, i) => {
      out[chip] = openBox(startX + i * OPEN_PITCH, cy, 121, 54);
    });
  }
  return out;
})();

export const CHIP_SLOTS: Record<ChipValue, Slot> = Object.fromEntries(
  CHIPS.map((c) => [c, { closed: CHIP_CLOSED[c], open: CHIP_OPEN[c] }]),
) as Record<ChipValue, Slot>;

/**
 * The selection halo, drawn UNDER the chips so only the ring outside the coin
 * shows. Its rect is the chip's, scaled about the chip's own centre.
 */
export function chipRingRect(r: Rect): Rect {
  const w = r.w * (141 / 114);
  const h = r.h * (99 / 72);
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/** The HUD buttons that move with the panel. `take` does not — it cross-fades. */
/**
 * Closed rects RETUNED in the third edition's third pass (15 L-11): the
 * cabinet's plates were re-read along one row through their middle, and
 * wheelZoom, cancelBet and cancelSpecific all moved. Open rects lerp to the
 * unchanged ×1.5-spec centres.
 */
export const HUD_SLOTS = {
  wheelZoom: { closed: rect(1793, 389.1, 456.1, 66.9), open: openBox(283.5, 424.5, 456.1, 66.9) },
  betOk: { closed: rect(2052, 488, 252, 54), open: openBox(2001, 420, 252, 54) },
  cancelBet: { closed: rect(1826.6, 538, 386, 52), open: openBox(1695, 943.5, 386, 52) },
  cancelSpecific: {
    closed: rect(117, 532.6, 385.4, 57.5),
    open: openBox(648, 943.5, 385.4, 57.5),
  },
} satisfies Record<string, Slot>;

/** TAKE is baked into the backdrop art; only its lit frame and touch box are ours. */
export const TAKE_LIT = rect(1720.9, 469.7, 267.1, 77.7);
export const TAKE_TOUCH = rect(1728, 476, 254, 68);

export const TITLE_ZONE = rect(748, -4, 799, 127);
export const TIMER_FLASH = rect(13, 295, 553, 86);

/** The text meters. `boxFill` means the glyphs are stretched to fill the box. */
export interface TextZone {
  rect: Rect;
  family: string;
  weight: 400 | 700;
  /** null = fill the box; a number = that design-px size, scaled down to fit. */
  size: number | null;
  stretchX: number;
  color: string;
}

/**
 * Glyphs are stretched globally by (1.24, 0.89).
 *
 * That is the cabinet's own aspect and it is not decoration: at 1:1 the meters
 * read noticeably narrower than the recording and the clock no longer fills its
 * bar.
 */
export const TEXT_STRETCH = { x: 1.24, y: 0.89 };

/**
 * The x-scale a SIZED label carries: the global stretch over the y it already
 * has in its font size, times the label's own.
 *
 * One definition because three surfaces had drifted off it — the history strip
 * and the Exit label applied no stretch at all (28% and 35% too narrow) and
 * their declared `stretchX` values were read by nobody.
 */
export const glyphScaleX = (stretchX = 1): number =>
  (TEXT_STRETCH.x / TEXT_STRETCH.y) * stretchX;

/**
 * The one face the cabinet uses that its own asset export does not ship.
 *
 * `wheelZoom` is TimesBold. There is no `TIMESBD.ttf` in the handoff's 77
 * files, so this label has no bundled face and must fall back to a real serif.
 * It used to name the family `"serif"` — QUOTED, which CSS reads as a family
 * NAME and not the generic keyword, so it matched nothing and landed on
 * `system-ui`: the one label drawn in a serif on the cabinet was the only one
 * drawn in the same sans as everything else.
 */
export const SERIF_LABEL_FAMILY = "TimesBold";

/** The CSS `font-family` value for a face, with the right fallback tail. */
export const fontStack = (family: string): string =>
  family === SERIF_LABEL_FAMILY
    ? `"Times New Roman", Times, serif`
    : `"${family}", system-ui, sans-serif`;

export const TEXT_ZONES = {
  score: {
    rect: rect(257, 168, 122, 35),
    family: "RouletteLegacy",
    weight: 400,
    // SIZED, not box-filled, the same as `win` (user decision, 2026-09-05).
    // The spec fills this bar, but the bar is 122px and the text is a number
    // of any length: "10" was stretched to five digits' width and read as a
    // broken font, while a long balance scaled down as intended. A sized
    // meter keeps every amount in one glyph shape and only shrinks when it
    // would overflow. 34 fills the 35px bar at the cabinet's own aspect.
    size: 34,
    stretchX: 1,
    color: "#FFFFFF",
  },
  win: {
    rect: rect(1865, 168, 267, 39),
    family: "RouletteLegacy",
    weight: 400,
    size: 38,
    stretchX: 1,
    color: "#FFFFFF",
  },
  timer: {
    // 130 → 280, widened on its own centre (x 290). SIZED at 37 with
    // scale-down, the Score's own treatment: box-filled, `0 : 9` is one
    // character shorter than `0 : 10` with the same width to fill, so the clock
    // stretched on every tick past ten once the seconds stopped being padded.
    // The box only bounds now (parity spec 03 §6, third edition).
    rect: rect(150, 319, 280, 37),
    family: "RouletteDigiface",
    weight: 400,
    size: 37,
    stretchX: 1,
    color: "#FFFFFF",
  },
  history: {
    rect: rect(1843, 316, 374, 43),
    family: "RouletteLegacy",
    weight: 700,
    size: 38.5,
    stretchX: 1,
    color: "#FFFFFF",
  },
  totalBet: {
    rect: rect(87, 1051, 179, 27),
    family: "RouletteLegacy",
    weight: 400,
    size: 29,
    stretchX: 1,
    color: "#FFFFFF",
  },
  status: {
    rect: rect(560, 1031, 1200, 38),
    family: "RouletteComic",
    weight: 400,
    // ONE size for every message, never stretched to the box: a long refusal
    // and a short prompt have to read as the same voice.
    size: 36,
    stretchX: 1.1,
    color: "#2ED74A",
  },
  exit: {
    rect: rect(2056, 1043, 190, 36),
    family: "RouletteNews706",
    weight: 700,
    size: 23,
    stretchX: 1.1,
    color: "#FFFFFF",
  },
} satisfies Record<string, TextZone>;

/** Button labels: size, x-stretch, and offset from the button box's centre. */
export const BUTTON_LABELS = {
  take: { size: 28, stretchX: 0.87, dx: 38, dy: 7, family: "RouletteNews706" },
  betOk: { size: 26, stretchX: 0.93, dx: -38, dy: 1, family: "RouletteNews706" },
  cancelBet: { size: 25, stretchX: 1.03, dx: -5, dy: 1, family: "RouletteNews706" },
  cancelSpecific: { size: 23, stretchX: 1.1, dx: -7, dy: 0, family: "RouletteNews706" },
  wheelZoom: { size: 25, stretchX: 1.01, dx: 0, dy: 10, family: SERIF_LABEL_FAMILY },
} as const;

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export const COLORS = {
  /** The winning cell's blink, painted under the chart. */
  winFlash: "#1B8303",
  /** The green over every pocket a just-staked chip covers. 60% alpha. */
  betFlash: "rgba(33, 208, 122, 0.6)",
  stakePillFill: "#D4AF37",
  stakePillBorder: "rgba(0, 0, 0, 0.87)",
  stakePillShadow: "rgba(0, 0, 0, 0.45)",
  stakePillText: "#000000",
  historyRed: "#E23A3A",
  historyGreen: "#2DE330",
  historyBlack: "#FFFFFF",
  status: "#2ED74A",
  offline: "#FFAB40",
} as const;

// ---------------------------------------------------------------------------
// The wheel stage
// ---------------------------------------------------------------------------

export const WHEEL = {
  idleCentre: { x: 1156, y: 365 },
  /**
   * The composite's DRAWN footprint — NOT the 660 x 432 box its geometry is
   * expressed in. The whole composite (bowl, ring, diamond, ball) is squashed
   * into this together; resizing the geometry box instead would resize the bowl
   * art alone and leave the ball orbiting outside it.
   */
  idleSize: { w: 647, h: 403 },
  zoomCentre: { x: 1158, y: 470 },
  zoomScale: 1.7,
  zoomInMs: 520,
  spinMs: 6000,
  holdMs: 1600,
  zoomOutMs: 1100,
  /** Exactly five turns, so the ring ends every spin in its one canonical pose. */
  turns: 5,
  /** The dim behind a zoomed wheel, at full zoom. */
  scrimAlpha: 0.5,
  /** Frames per second of the hub diamond's sparkle while the ring turns. */
  sparkleMs: 70,
  sparkleFrames: 18,
} as const;

/** The 660 x 432 box the ring, diamond and ball geometry is expressed in. */
export const BOWL = {
  w: 660,
  h: 432,
  /** The ring's centre, offset from the bowl's. */
  discOffset: { x: 7, y: -51 },
  /** The ring sprite's design square. Every radius below is in these units. */
  discBase: 500,
  discW: 492,
  discH: 533.1,
  discTiltDeg: 59.3,
  /**
   * CSS-style perspective distance. The sign matters: the projection matrix
   * entry is -1/d, and a positive one reads FLAT rather than tilted.
   */
  discPerspective: 1625,
  diamondOffset: { x: 6, y: -85 },
  diamondW: 96,
  diamondH: 145,
  diamondScale: 1.21,
  diamondTiltDeg: 60,
  diamondPerspective: 1000,
  // 30, raised from 20: the ball is `coin.png` (19x20 native) drawn contain in
  // a 30x30 box in the 660x432 bowl space, then foreshortened by the disc
  // projection's local patch scale. Second-edition hand-off, V-10.
  ballSize: 30,
  /** Outer digit band, where the ball is thrown. */
  ballRadiusStart: 237,
  /** Centre of the pocket band, where it comes to rest. */
  ballRadiusEnd: 163,
} as const;

/**
 * The screen angle pocket 0 rests at, measured off a cabinet recording.
 *
 * `discPoint` convention: 0 rad is +x (3 o'clock) and a positive angle turns
 * CLOCKWISE on screen, because the canvas y-axis points down.
 */
export const POCKET_ZERO_REST_ANGLE = 1.4295;

/**
 * The counter-scale that keeps the wheel circular.
 *
 * The canvas stretches non-uniformly, so a circle drawn on it becomes an
 * ellipse. This undoes exactly that much and NOTHING else — it only ever
 * shrinks, so the wheel never grows past its slot on an extreme aspect.
 */
export function unstretch(
  windowW: number,
  windowH: number,
): { x: number; y: number } {
  const sx = windowW / CANVAS_W;
  const sy = windowH / CANVAS_H;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) {
    return { x: 1, y: 1 };
  }
  const tighter = Math.min(sx, sy);
  return { x: tighter / sx, y: tighter / sy };
}

// ---------------------------------------------------------------------------
// Timing constants that are not geometry
// ---------------------------------------------------------------------------

/** The shared blink: winning cell, TAKE, Bet Ok / Prev Bet. One beat for all three. */
export const FLASH_MS = 334;
/** The clock bar's own, slower beat. Deliberately NOT the shared one. */
export const BAR_FLASH_HALF_MS = 233.333;
/** How long a passing notice holds the status line. */
export const NOTICE_MS = 4000;
/** A staked chip lights its covered cells for this long; each new chip restarts it. */
export const BET_FLASH_MS = 350;
/** Hold-to-repeat cadence while a finger stays on one zone. */
export const BET_REPEAT_MS = 90;
/**
 * How long a finger must stay down before the repeat starts.
 *
 * The cabinet gets this from the framework's long-press recogniser, whose
 * default threshold is 500 ms; the tap itself has already placed one chip by
 * then. Without it the repeat armed on pointerdown, so an ordinary tap that
 * dwelled 200 ms put three chips on a number.
 */
export const BET_HOLD_START_MS = 500;
/** With this long left in the window and chips still staged, the layout sends itself. */
export const AUTO_SEND_AT_MS = 2000;
/**
 * A placement the server has not ANSWERED is re-sent this often, same key,
 * until it answers or the round moves on (parity spec 09 §"Resent until the
 * server answers"). Silence used to be left standing.
 */
export const BATCH_ACK_TIMEOUT_MS = 3000;
/** The closing stretch the clock bar flashes through. */
export const LAST_SECONDS = 5;
/**
 * A count sitting at zero for longer than this means the board has stopped
 * updating, not that the table is between rounds.
 *
 * A healthy stream opens the next round the instant this one's settle deadline
 * passes, so the honest window is about a second. Fifteen leaves room for a
 * slow refetch, a backgrounded tab waking up and a socket reconnect before the
 * screen accuses anything.
 */
export const STALE_BOARD_MS = 15_000;
/** TAKE's drain: dead air before the first chunk, then one chunk per tick. */
export const TAKE_PRE_DELAY_MS = 470;
export const TAKE_TICK_MS = 100;
