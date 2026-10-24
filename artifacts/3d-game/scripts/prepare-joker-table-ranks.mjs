import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Analyse hands once during asset preparation. The browser only displays SVGs.
const root = path.resolve(import.meta.dirname, "../../..");
const assets = path.join(
  root,
  "artifacts/3d-game/src/assets/teenpatti-joker/reference-motion",
);
const ffmpeg =
  process.env.FFMPEG ??
  path.join(root, "tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe");
const tracks = JSON.parse(
  readFileSync(path.join(assets, "paper-tracks.json"), "utf8"),
);
const left = 270,
  top = 370,
  width = 430,
  height = 150,
  step = 2;
const columns = width / step,
  rows = height / step;
const raw = execFileSync(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-threads",
    "2",
    "-ss",
    "20",
    "-i",
    path.join(
      root,
      "artifacts/3d-game/public/media/teenpatti-joker/dealer-playback-v4.mp4",
    ),
    "-vf",
    `fps=6,crop=${width}:${height}:${left}:${top},format=rgb24`,
    "-f",
    "rawvideo",
    "-",
  ],
  { maxBuffer: 128 * 1024 * 1024 },
);
const frameBytes = width * height * 3;
if (raw.length / frameBytes !== tracks.length)
  throw new Error("Video and card calibration lengths differ");
const frames = tracks.map(({ quads }, frame) => {
  const points = quads.map((quad) =>
    quad.map(([x, y]) => [Math.round(x * 960), Math.round(y * 540)]),
  );
  const skin = new Uint8Array(columns * rows);
  for (const quad of points) {
    const x0 = Math.max(
      0,
      Math.floor((Math.min(...quad.map((p) => p[0])) - left) / step),
    );
    const x1 = Math.min(
      columns,
      Math.ceil((Math.max(...quad.map((p) => p[0])) - left) / step),
    );
    const y0 = Math.max(
      0,
      Math.floor((Math.min(...quad.map((p) => p[1])) - top) / step),
    );
    const y1 = Math.min(
      rows,
      Math.ceil((Math.max(...quad.map((p) => p[1])) - top) / step),
    );
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const at =
          frame * frameBytes + ((y * step + 1) * width + x * step + 1) * 3;
        const r = raw[at],
          g = raw[at + 1],
          b = raw[at + 2];
        if (
          (r > 75 && r - g > 35 && r - b > 45) ||
          (Math.max(r, g, b) < 75 && b < g * 1.1)
        )
          skin[y * columns + x] = 1;
      }
  }
  // Merge equal horizontal runs into rectangles; one small SVG path masks hands.
  const rectangles = [],
    active = new Map();
  for (let y = 0; y < rows; y++) {
    const used = new Set();
    for (let x = 0; x < columns; ) {
      if (!skin[y * columns + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < columns && skin[y * columns + x]) x++;
      const key = `${start}:${x}`;
      used.add(key);
      if (active.has(key)) active.get(key)[3] += step;
      else {
        const rectangle = [
          left + start * step,
          top + y * step,
          (x - start) * step,
          step,
        ];
        rectangles.push(rectangle);
        active.set(key, rectangle);
      }
    }
    for (const key of active.keys()) if (!used.has(key)) active.delete(key);
  }
  return [
    points.flat(2),
    rectangles.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}z`).join(""),
  ];
});
const output = JSON.stringify(frames);
writeFileSync(path.join(assets, "table-rank-frames.json"), output + "\n");
console.log(
  JSON.stringify({
    frames: frames.length,
    bytes: Buffer.byteLength(output),
    browserPixelReadbacks: 0,
  }),
);
