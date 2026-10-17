import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { softHandMask } from "./andar-bahar-matte.mjs";

// Keep the filmed card turns at normal speed. Use the unused time in each
// server slot for a motion-interpolated approach/return to one resting pose.
// The last frame of every opening matches the first frame of the next one.
const root = path.resolve("tmp/andar-bahar-live/continuous-v7");
const frames = path.resolve("tmp/andar-bahar-live/rife/full/output");
const tool = path.resolve("tmp/andar-bahar-live/rife/tool");
const ffmpeg =
  process.env.FFMPEG ??
  path.resolve("tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe");
const out = path.resolve("artifacts/3d-game/public/media/andar-bahar-live");
const W = 1430,
  H = 610,
  MW = 350,
  MH = 134,
  FPS = 60,
  REST = 756;
const frameFile = (n) =>
  path.join(frames, `${String(n + 1).padStart(8, "0")}.png`);
mkdirSync(root, { recursive: true });
async function run(exe, args) {
  const child = spawn(exe, args, {
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`${path.basename(exe)} exited ${code}`);
}
async function bridge(name, from, to, count) {
  const input = path.join(root, name, "input"),
    output = path.join(root, name, "output");
  mkdirSync(input, { recursive: true });
  mkdirSync(output, { recursive: true });
  copyFileSync(frameFile(from), path.join(input, "00000001.png"));
  copyFileSync(frameFile(to), path.join(input, "00000002.png"));
  if (readdirSync(output).length !== count + 1) {
    await run(path.join(tool, "rife-ncnn-vulkan.exe"), [
      "-i",
      input,
      "-o",
      output,
      "-n",
      String(count + 1),
      "-m",
      path.join(tool, "rife-v4.6"),
      "-g",
      "1",
      "-j",
      "1:1:1",
    ]);
  }
  const names = readdirSync(output)
    .filter((n) => n.endsWith(".png"))
    .sort();
  if (names.length !== count + 1) throw new Error(`Incomplete bridge ${name}`);
  return names
    .slice(0, count)
    .map((n) => ({ file: path.join(output, n), source: REST / FPS }));
}
const native = (start, count) =>
  Array.from({ length: count }, (_, i) => ({
    file: frameFile(start + i),
    source: (start + i) / FPS,
  }));
const sequence = native(0, 798);
const takes = {};
for (const [name, first, count, approach, retract] of [
  ["joker", 541, 65, 25, 24],
  ["bahar", 606, 75, 14, 13],
  ["andar", 681, 75, 27, 0],
]) {
  console.log(`Preparing ${name} approach and return`);
  const start = sequence.length / FPS;
  sequence.push(...(await bridge(`${name}-approach`, REST, first, approach)));
  sequence.push(...native(first, count));
  if (retract)
    sequence.push(
      ...(await bridge(`${name}-return`, first + count, REST, retract)),
    );
  takes[name] = {
    start,
    end: sequence.length / FPS,
    actionStart: start + approach / FPS,
    sourceStart: first / FPS,
    sourceEnd: (first + count) / FPS,
  };
}
const ordered = path.join(root, "frames");
mkdirSync(ordered, { recursive: true });
sequence.forEach((entry, i) =>
  copyFileSync(
    entry.file,
    path.join(ordered, `${String(i + 1).padStart(8, "0")}.png`),
  ),
);
const decoded = spawn(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-framerate",
    "60",
    "-i",
    path.join(ordered, "%08d.png"),
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ],
  { stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
);
const encoded = spawn(
  ffmpeg,
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
    "60",
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
    "12",
    "-keyint_min",
    "12",
    "-sc_threshold",
    "0",
    "-movflags",
    "+faststart",
    path.join(out, "dealer-continuous-v7.pending.mp4"),
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
    const mask = softHandMask(rgba, MW, MH),
      packed = Buffer.alloc(W * (H + MH) * 3);
    frame.copy(packed);
    const t = sequence[count].source;
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
        const opening =
          (t >= 9.02 && t < 9.6 && x > 140 && x < 225 && y < 58) ||
          (t >= 10.1 && t < 10.9667 && x > 40 && x < 140 && y < 105) ||
          (t >= 11.35 && t < 11.8667 && x > 40 && x < 140 && y < 59);
        const back =
          opening && r > 90 && g > 35 && r - g > 18 && r - b > 5 && b > g * 0.7;
        const alpha = pink || cuff || back ? 255 : mask[y * MW + x],
          dst = ((H + y) * W + x) * 3;
        packed[dst] = packed[dst + 1] = packed[dst + 2] = alpha;
      }
    if (!encoded.stdin.write(packed)) await once(encoded.stdin, "drain");
    count++;
  }
}
encoded.stdin.end();
const [dec] = await decodeExit,
  [enc] = await encodeExit;
if (dec !== 0 || enc !== 0 || count !== sequence.length)
  throw new Error(`Encoding failed ${dec}/${enc}: ${count} frames`);
renameSync(
  path.join(out, "dealer-continuous-v7.pending.mp4"),
  path.join(out, "dealer-continuous-v7.mp4"),
);
writeFileSync(
  path.join(out, "continuous-v7.json"),
  JSON.stringify(
    {
      fps: FPS,
      frames: count,
      restingSourceTime: REST / FPS,
      takes,
      processing:
        "Recorded turns at 1x speed; RIFE 4.6 approach/return between matched resting poses; recomputed hand mattes. Waiting joins use a short dissolve in the player.",
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ frames: count, takes }));
