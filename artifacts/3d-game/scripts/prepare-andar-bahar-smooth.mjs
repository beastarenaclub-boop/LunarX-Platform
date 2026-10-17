import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { handMask } from "./andar-bahar-matte.mjs";

// The extra band contains a synchronized hand matte. Browsers decode one
// video and composite it on the GPU, with no per-frame CPU pixel readbacks.
const source = process.argv[2];
if (!source) throw new Error("Supply the original recording path");
const encoder =
  process.env.FFMPEG ??
  path.resolve("tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe");
const out = path.resolve("artifacts/3d-game/public/media/andar-bahar-live");
mkdirSync(out, { recursive: true });
const W = 1430,
  H = 610,
  MW = 350,
  MH = 134,
  FPS = 60;
const decoded = spawn(
  encoder,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    "133",
    "-i",
    source,
    "-t",
    "13.3",
    "-vf",
    "crop=1430:610:30:11,unsharp=3:3:0.25:3:3:0,minterpolate=fps=60:mi_mode=mci:mc_mode=obmc:me_mode=bidir:me=epzs:search_param=4:vsbmc=0",
    "-an",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ],
  { stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
);
const encoded = spawn(
  encoder,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${W}x${H + MH}`,
    "-r",
    String(FPS),
    "-i",
    "pipe:0",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "15",
    "-keyint_min",
    "15",
    "-sc_threshold",
    "0",
    "-movflags",
    "+faststart",
    path.join(out, "dealer-smooth-v2.mp4"),
  ],
  { stdio: ["pipe", "ignore", "inherit"], windowsHide: true },
);
const decodeExit = once(decoded, "close"),
  encodeExit = once(encoded, "close");
const frame = Buffer.alloc(W * H * 3),
  rgba = new Uint8ClampedArray(MW * MH * 4);
let filled = 0,
  count = 0;
for await (const chunk of decoded.stdout) {
  let offset = 0;
  while (offset < chunk.length) {
    const size = Math.min(chunk.length - offset, frame.length - filled);
    chunk.copy(frame, filled, offset, offset + size);
    filled += size;
    offset += size;
    if (filled !== frame.length) continue;
    filled = 0;
    for (let y = 0; y < MH; y++)
      for (let x = 0; x < MW; x++) {
        const i = (y * MW + x) * 4,
          src = ((y + 476) * W + x + 690) * 3;
        rgba[i] = frame[src];
        rgba[i + 1] = frame[src + 1];
        rgba[i + 2] = frame[src + 2];
        rgba[i + 3] = 255;
      }
    const mask = handMask(rgba, MW, MH),
      packed = Buffer.alloc(W * (H + MH) * 3);
    frame.copy(packed);
    for (let y = 0; y < MH; y++)
      for (let x = 0; x < MW; x++) {
        const i = (y * MW + x) * 4,
          r = rgba[i],
          g = rgba[i + 1],
          b = rgba[i + 2];
        const pink =
          y < 12 &&
          x > 110 &&
          x < 270 &&
          r - g > 25 &&
          b > g * 0.94 &&
          r > b * 1.08;
        const cuff = x < 48 && y < 32 && r > 170 && g > 160 && b > 145;
        const alpha = mask[y * MW + x] || pink || cuff ? 255 : 0,
          dst = ((H + y) * W + x) * 3;
        packed[dst] = packed[dst + 1] = packed[dst + 2] = alpha;
      }
    if (!encoded.stdin.write(packed)) await once(encoded.stdin, "drain");
    if (++count % 120 === 0) console.log(`${count / FPS}s prepared`);
  }
}
encoded.stdin.end();
const [decCode] = await decodeExit,
  [encCode] = await encodeExit;
if (decCode !== 0 || encCode !== 0 || count < 760)
  throw new Error(
    `Media preparation failed (${decCode}/${encCode}, ${count} frames)`,
  );
writeFileSync(
  path.join(out, "smooth-v2.json"),
  JSON.stringify(
    {
      source: path.basename(source),
      sourceStartSeconds: 133,
      fps: FPS,
      frames: count,
      frame: [W, H + MH],
      studio: [0, 0, W, H],
      matte: [0, H, MW, MH],
      matteTarget: [690, 476, MW, MH],
      originalPixels: true,
      processing:
        "Light sharpening, motion interpolation, precomputed hand matte; audio removed.",
    },
    null,
    2,
  ),
);
console.log(`Prepared ${count} frames, ${count / FPS}s`);
