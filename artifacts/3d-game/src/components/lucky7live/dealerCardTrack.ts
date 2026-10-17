import { DEALER } from "./dealerTimeline.ts";

export const CARD_MASK = {
  width: 100,
  height: 140,
  columns: 12,
  rows: 10,
  flipStart: 389,
  flipEnd: 432,
  clearStart: 564,
  clearEnd: 636,
};
export function cardMaskFrame(time: number) {
  const frame = Math.round(time * DEALER.fps);
  if (frame >= CARD_MASK.flipStart && frame < CARD_MASK.flipEnd)
    return frame - CARD_MASK.flipStart;
  if (frame >= CARD_MASK.clearStart && frame < CARD_MASK.clearEnd)
    return (
      CARD_MASK.flipEnd - CARD_MASK.flipStart + frame - CARD_MASK.clearStart
    );
  return -1;
}

type Point = [number, number];
export type Quad = [Point, Point, Point, Point];
// Native 24 fps source coordinates. Delivery adds a 10s waiting take and
// crops 30px from the top. The video supplies paper, edges and shadows;
// only transparent ink is projected, never an opaque replacement card.
export const resting: Quad = [
  [896, 734],
  [965, 734],
  [970, 784],
  [893, 786],
];
const sourceFrames: [number, Quad][] = [
  [
    148,
    [
      [893, 724],
      [961, 728],
      [962, 741],
      [890, 738],
    ],
  ],
  [
    149,
    [
      [893, 716],
      [960, 720],
      [963, 741],
      [891, 742],
    ],
  ],
  [
    150,
    [
      [893, 703],
      [960, 702],
      [966, 742],
      [891, 743],
    ],
  ],
  [
    151,
    [
      [895, 674],
      [955, 675],
      [970, 742],
      [897, 745],
    ],
  ],
  [
    152,
    [
      [893, 660],
      [956, 659],
      [970, 743],
      [899, 746],
    ],
  ],
  [
    153,
    [
      [894, 649],
      [957, 650],
      [969, 744],
      [897, 747],
    ],
  ],
  [
    154,
    [
      [892, 644],
      [957, 642],
      [970, 745],
      [895, 750],
    ],
  ],
  [
    155,
    [
      [893, 642],
      [956, 642],
      [970, 749],
      [891, 754],
    ],
  ],
  [
    156,
    [
      [891, 644],
      [957, 643],
      [972, 752],
      [891, 757],
    ],
  ],
  [
    157,
    [
      [893, 655],
      [959, 655],
      [974, 760],
      [892, 762],
    ],
  ],
  [
    158,
    [
      [894, 674],
      [960, 672],
      [977, 773],
      [893, 776],
    ],
  ],
  [
    159,
    [
      [895, 721],
      [960, 718],
      [976, 788],
      [900, 789],
    ],
  ],
  [
    160,
    [
      [895, 731],
      [961, 727],
      [972, 785],
      [900, 788],
    ],
  ],
  [
    161,
    [
      [897, 732],
      [962, 731],
      [970, 784],
      [898, 786],
    ],
  ],
  [163, resting],
];
// Delivered 1920x900 coordinates, following the pickup until the paper
// turns edge-on toward the tray. No screen-space floating replacement.
const clearFrames: [number, Quad][] = [
  [
    24.4,
    [
      [896, 704],
      [965, 704],
      [970, 754],
      [893, 756],
    ],
  ],
  [
    24.6,
    [
      [899, 697],
      [962, 695],
      [972, 746],
      [896, 748],
    ],
  ],
  [
    24.8,
    [
      [901, 688],
      [963, 686],
      [974, 738],
      [898, 742],
    ],
  ],
  [
    25,
    [
      [898, 676],
      [963, 674],
      [971, 730],
      [896, 732],
    ],
  ],
  [
    25.2,
    [
      [898, 618],
      [963, 620],
      [970, 711],
      [896, 712],
    ],
  ],
  [
    611 / 24,
    [
      [898, 508],
      [968, 513],
      [971, 625],
      [898, 626],
    ],
  ],
  [
    616 / 24,
    [
      [891, 452],
      [963, 445],
      [968, 562],
      [897, 566],
    ],
  ],
  [
    621 / 24,
    [
      [871, 450],
      [943, 442],
      [952, 545],
      [883, 554],
    ],
  ],
  [
    626 / 24,
    [
      [779, 442],
      [844, 427],
      [869, 526],
      [801, 541],
    ],
  ],
  [
    631 / 24,
    [
      [633, 408],
      [694, 392],
      [725, 497],
      [677, 504],
    ],
  ],
  [
    636 / 24,
    [
      [509, 370],
      [535, 365],
      [553, 423],
      [528, 429],
    ],
  ],
];
function interpolate(frames: [number, Quad][], time: number, end: Quad): Quad {
  const next = frames.findIndex(([f]) => f >= time);
  if (next <= 0) return next === 0 ? frames[0][1] : end;
  const [f0, q0] = frames[next - 1],
    [f1, q1] = frames[next];
  const a = (time - f0) / (f1 - f0);
  return q0.map((p, i) =>
    p.map((v, axis) => v + (q1[i][axis] - v) * a),
  ) as Quad;
}
export function quadAt(time: number): Quad {
  if (time >= clearFrames[0][0]) {
    return interpolate(clearFrames, time, clearFrames.at(-1)![1]).map(
      ([x, y]) => [x, y + 30],
    ) as Quad;
  }
  const frame = (time - DEALER.actionOffset) * 24;
  const next = sourceFrames.findIndex(([f]) => f >= frame);
  if (next <= 0) return next === 0 ? sourceFrames[0][1] : resting;
  const [f0, q0] = sourceFrames[next - 1],
    [f1, q1] = sourceFrames[next];
  const a = (frame - f0) / (f1 - f0);
  return q0.map((p, i) =>
    p.map((v, axis) => v + (q1[i][axis] - v) * a),
  ) as Quad;
}
export function project(quad: Quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2,
    dy2 = y3 - y2,
    dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det,
    h = (dx1 * dy3 - dx3 * dy1) / det;
  return {
    a: x1 - x0 + g * x1,
    b: x3 - x0 + h * x3,
    c: x0,
    d: y1 - y0 + g * y1,
    e: y3 - y0 + h * y3,
    f: y0,
    g,
    h,
  };
}
