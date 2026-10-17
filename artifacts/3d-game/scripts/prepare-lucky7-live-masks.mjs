import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CARD_MASK as mask,
  quadAt,
  project,
} from "../src/components/lucky7live/dealerCardTrack.ts";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const media = path.join(root, "artifacts/3d-game/public/media/lucky7-live");
const ffmpeg =
  process.env.FFMPEG ||
  path.join(root, "tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe");
const width = mask.width * mask.columns,
  height = mask.height * mask.rows;
const atlas = Buffer.alloc(width * height * 4, 255);
let tile = 0;
for (const [start, end, x, y, w, h] of [
  [mask.flipStart, mask.flipEnd, 840, 540, 180, 270],
  [mask.clearStart, mask.clearEnd, 480, 350, 560, 440],
]) {
  const frames = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path.join(media, "dealer-natural-v5.mp4"),
      "-vf",
      `trim=start_frame=${start}:end_frame=${end},crop=${w}:${h}:${x}:${y}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { maxBuffer: 100 * 1024 * 1024 },
  );
  if (frames.status !== 0) throw new Error(String(frames.stderr));
  if (frames.stdout.length !== (end - start) * w * h * 3)
    throw new Error("Unexpected mask frame count");
  for (let frame = start; frame < end; frame++, tile++) {
    const p = project(quadAt(frame / 24).map(([x, y]) => [x, y - 30]));
    for (let v = 0; v < mask.height; v++)
      for (let u = 0; u < mask.width; u++) {
        const a = (u + 0.5) / mask.width,
          b = (v + 0.5) / mask.height,
          d = p.g * a + p.h * b + 1;
        const sx = (p.a * a + p.b * b + p.c) / d - x,
          sy = (p.d * a + p.e * b + p.f) / d - y;
        let alpha = 0;
        if (sx >= 0 && sy >= 0 && sx < w - 1 && sy < h - 1) {
          const rgb = [0, 0, 0],
            x0 = Math.floor(sx),
            y0 = Math.floor(sy);
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
              const weight =
                (dx ? sx - x0 : 1 - sx + x0) * (dy ? sy - y0 : 1 - sy + y0);
              const i = ((frame - start) * w * h + (y0 + dy) * w + x0 + dx) * 3;
              for (let c = 0; c < 3; c++)
                rgb[c] += frames.stdout[i + c] * weight;
            }
          const min = Math.min(...rgb),
            chroma = Math.max(...rgb) - min;
          // Neutral paper (including its gray shadows) remains; warm skin
          // occludes the ink. This is baked once, never sampled during playback.
          alpha =
            Math.min(1, Math.max(0, (48 - chroma) / 8)) *
            Math.min(1, Math.max(0, (min - 85) / 25));
        }
        const index =
          ((Math.floor(tile / mask.columns) * mask.height + v) * width +
            (tile % mask.columns) * mask.width +
            u) *
          4;
        atlas[index + 3] = Math.round(alpha * 255);
      }
  }
}
const encoded = spawnSync(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pixel_format",
    "rgba",
    "-video_size",
    `${width}x${height}`,
    "-i",
    "pipe:0",
    "-frames:v",
    "1",
    "-update",
    "1",
    path.join(media, "dealer-hand-masks-v5.png"),
  ],
  { input: atlas, maxBuffer: 1024 * 1024 },
);
if (encoded.status !== 0) throw new Error(String(encoded.stderr));
console.log(`Baked ${tile} fingertip masks into one ${width}x${height} atlas.`);
