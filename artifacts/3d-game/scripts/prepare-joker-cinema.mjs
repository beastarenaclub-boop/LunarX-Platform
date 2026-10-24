import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import path from "node:path";

// Offline only: retain the dealer and moving hands, clear prop cards from felt.
const source = process.argv[2];
if (!source) throw new Error("Supply the source dealer MP4 path");
const root = path.resolve(import.meta.dirname, "../../..");
const ffmpeg =
  process.env.FFMPEG ??
  path.join(root, "tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe");
const clean = path.join(
  root,
  "artifacts/3d-game/src/assets/teenpatti-joker/clean-felt-v1.png",
);
const output = path.join(
  root,
  "artifacts/3d-game/public/media/teenpatti-joker",
);
mkdirSync(output, { recursive: true });
const W = 1920,
  H = 1080,
  FPS = 24,
  frameBytes = W * H * 3;
const background = spawnSync(
  ffmpeg,
  [
    "-v",
    "error",
    "-i",
    clean,
    "-vf",
    `scale=${W}:${H}`,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ],
  { maxBuffer: frameBytes + 1024, windowsHide: true },
);
if (background.status !== 0 || background.stdout.length !== frameBytes)
  throw new Error("Cannot decode clean felt reference");
const reference = spawnSync(ffmpeg, ["-v", "error", "-ss", "0.5", "-i", source, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: frameBytes + 1024, windowsHide: true });
if (reference.status !== 0 || reference.stdout.length !== frameBytes) throw new Error("Cannot decode motion reference");
const ramp = (n) => Math.max(0, Math.min(1, n));
const matte = new Float32Array(W * H);
for (let y = 790; y < H; y++)
  for (let x = 0; x < W; x++) {
    const foreground = ramp((y - 855) / 22);
    const centerCard = Math.min(
      ramp((x - 845) / 18),
      ramp((1075 - x) / 18),
      ramp((y - 790) / 15),
    );
    matte[y * W + x] = Math.max(foreground, centerCard);
  }
const decoded = spawn(
  ffmpeg,
  [
    "-v",
    "error",
    "-i",
    source,
    "-an",
    "-vf",
    `fps=${FPS}`,
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
    "-v",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${W}x${H}`,
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
    "20",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "24",
    "-movflags",
    "+faststart",
    path.join(output, "dealer-cinema-v1.mp4"),
  ],
  { stdio: ["pipe", "ignore", "inherit"], windowsHide: true },
);
const decodedExit = once(decoded, "close"),
  encodedExit = once(encoded, "close");
let pending = Buffer.alloc(0),
  frames = 0;
try {
  for await (const chunk of decoded.stdout) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= frameBytes) {
      const frame = Buffer.from(pending.subarray(0, frameBytes));
      pending = pending.subarray(frameBytes);
      for (let y = 790; y < H; y++)
        for (let x = 0; x < W; x++) {
          const p = y * W + x,
            i = p * 3;
          let alpha = matte[p];
          if (!alpha) continue;
          // Preserve real fingers above the felt; exclude the gold prop-slot row.
          if (y < 885) {
            const r = frame[i],
              g = frame[i + 1],
              b = frame[i + 2];
            const skin = Math.min(
              ramp((r - 65) / 20),
              ramp((g - 28) / 15),
              ramp((r - g - 18) / 12),
              ramp((g - b - 16) / 10),
            );
            const difference = Math.abs(r - reference.stdout[i]) + Math.abs(g - reference.stdout[i + 1]) + Math.abs(b - reference.stdout[i + 2]);
            alpha *= 1 - skin * ramp((difference - 24) / 45);
          }
          for (let c = 0; c < 3; c++)
            frame[i + c] = Math.round(
              frame[i + c] * (1 - alpha) + background.stdout[i + c] * alpha,
            );
        }
      if (!encoded.stdin.write(frame)) await once(encoded.stdin, "drain");
      frames++;
    }
  }
  encoded.stdin.end();
  const [[decodeCode], [encodeCode]] = await Promise.all([
    decodedExit,
    encodedExit,
  ]);
  if (decodeCode || encodeCode || pending.length || frames < 200)
    throw new Error("Incomplete dealer encode");
} catch (error) {
  decoded.kill();
  encoded.kill();
  throw error;
}
function encode(args) {
  const run = spawnSync(ffmpeg, ["-v", "error", "-y", ...args], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (run.error || run.status !== 0)
    throw run.error ?? new Error(`Encoder exited ${run.status}`);
}
const master = path.join(output, "dealer-cinema-v1.mp4");
encode([
  "-i",
  master,
  "-an",
  "-vf",
  "scale=1280:-2",
  "-c:v",
  "libx264",
  "-preset",
  "fast",
  "-crf",
  "24",
  "-pix_fmt",
  "yuv420p",
  "-g",
  "24",
  "-movflags",
  "+faststart",
  path.join(output, "dealer-cinema-mobile-v1.mp4"),
]);
for (const [name, time] of [
  ["poster", 0.5],
  ["result", 9.7],
])
  encode([
    "-ss",
    String(time),
    "-i",
    master,
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-quality",
    "90",
    path.join(output, `dealer-cinema-${name}-v1.webp`),
  ]);
console.log(JSON.stringify({ frames, width: W, height: H, fps: FPS, output }));
