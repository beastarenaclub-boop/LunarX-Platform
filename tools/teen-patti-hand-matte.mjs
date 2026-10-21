// Offline only. Neural landmarks constrain the colour matte so card pips and
// printed lettering cannot become part of the dealer's fingers.
const W = 414,
  H = 112,
  X = 312,
  Y = 316;
const bones = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
function segmentDistance(x, y, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
function inside(x, y, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}
function simplify(points, tolerance = 1) {
  if (points.length < 3) return points;
  let max = 0,
    at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(...points[i], points[0], points.at(-1));
    if (d > max) {
      max = d;
      at = i;
    }
  }
  return max > tolerance
    ? [
        ...simplify(points.slice(0, at + 1), tolerance).slice(0, -1),
        ...simplify(points.slice(at), tolerance),
      ]
    : [points[0], points.at(-1)];
}
function contours(mask) {
  const edges = new Map();
  const edge = (ax, ay, bx, by) => {
    const key = ay * (W + 1) + ax;
    const list = edges.get(key) || [];
    list.push(by * (W + 1) + bx);
    edges.set(key, list);
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      if (!y || !mask[i - W]) edge(x, y, x + 1, y);
      if (x === W - 1 || !mask[i + 1]) edge(x + 1, y, x + 1, y + 1);
      if (y === H - 1 || !mask[i + W]) edge(x + 1, y + 1, x, y + 1);
      if (!x || !mask[i - 1]) edge(x, y + 1, x, y);
    }
  const paths = [];
  while (edges.size) {
    const first = edges.keys().next().value;
    let at = first;
    const points = [];
    do {
      points.push([(at % (W + 1)) + X, Math.floor(at / (W + 1)) + Y]);
      const list = edges.get(at);
      if (!list) break;
      const next = list.pop();
      if (!list.length) edges.delete(at);
      at = next;
    } while (at !== first);
    if (points.length < 16) continue;
    points.push(points[0]);
    const area = points.reduce(
      (s, p, i) =>
        i ? s + points[i - 1][0] * p[1] - p[0] * points[i - 1][1] : s,
      0,
    );
    // Ignore tiny internal gaps/nails. Only outside silhouettes cut the cards.
    if (area < 35) continue;
    const polygon = simplify(points, 0.8);
    paths.push(`M${polygon.map((p) => p.join(",")).join("L")}Z`);
  }
  return paths.join("");
}
export function handMatte(pixels, hands, width = 1036) {
  const core = new Uint8Array(W * H),
    allowed = new Uint8Array(W * H);
  for (const hand of hands) {
    const palm = [0, 1, 2, 5, 9, 13, 17].map((i) => hand[i]);
    const radius = Math.max(
      2.5,
      Math.min(
        5.5,
        Math.hypot(hand[5][0] - hand[17][0], hand[5][1] - hand[17][1]) * 0.115,
      ),
    );
    const segments = bones.map(([a, b]) => [hand[a], hand[b], radius]);
    const wrist = hand[0],
      middle = hand[9];
    const length = Math.hypot(wrist[0] - middle[0], wrist[1] - middle[1]) || 1;
    segments.push([
      wrist,
      [
        wrist[0] + ((wrist[0] - middle[0]) * 70) / length,
        wrist[1] + ((wrist[1] - middle[1]) * 70) / length,
      ],
      radius * 2.7,
    ]);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const px = x + X,
          py = y + Y,
          i = y * W + x;
        if (inside(px, py, palm)) {
          core[i] = 1;
          allowed[i] = 1;
          continue;
        }
        for (const [a, b, r] of segments) {
          if (
            px < Math.min(a[0], b[0]) - r - 6 ||
            px > Math.max(a[0], b[0]) + r + 6 ||
            py < Math.min(a[1], b[1]) - r - 6 ||
            py > Math.max(a[1], b[1]) + r + 6
          )
            continue;
          const d = segmentDistance(px, py, a, b);
          if (d < r * 0.75) core[i] = 1;
          if (d < r + 6) allowed[i] = 1;
        }
      }
  }
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x,
        p = ((y + Y) * width + x + X) * 3;
      const r = pixels[p],
        g = pixels[p + 1],
        b = pixels[p + 2];
      const skin =
        r > 90 &&
        g > 46 &&
        b > 40 &&
        r - g > 22 &&
        r - b > 8 &&
        g > b - 30 &&
        r < g * 2.2 &&
        r < b * 2.3;
      const nail = core[i] && r > 135 && g > 100 && b > 95 && r - g < 80;
      if (allowed[i] && (skin || nail)) mask[i] = 1;
    }
  // Close single-pixel cracks and retain the motion-blurred edge without a
  // second, independently moving copy of the hands in the browser.
  const expanded = new Uint8Array(mask.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x]) {
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H)
              expanded[(y + dy) * W + x + dx] = 1;
      }
  return { mask: expanded, path: contours(expanded) };
}
