import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { softHandMask } from "./andar-bahar-matte.mjs";

// The extra band contains a synchronized hand matte. Browsers decode one
// video and composite it on the GPU, with no per-frame CPU pixel readbacks.
const source = process.argv[2];
if (!source) throw new Error("Supply the original recording path");
// Optional clearer recording starts at original second 139, six seconds after
// this game take. Its first 7.3 seconds cover all three physical card openings.
const enhancedTail = process.argv[3];
const interpolatedScene = process.argv[4];
const version = interpolatedScene ? "v6" : enhancedTail ? "v5" : "v4";
const encoder =
  process.env.FFMPEG ??
  path.resolve("tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe");
const out = path.resolve("artifacts/3d-game/public/media/andar-bahar-live");
mkdirSync(out, { recursive: true });
const W = 1430,
  H = 610,
  MW = 350,
  MH = 134,
  FPS = interpolatedScene ? 60 : 30;
const decoded = spawn(
  encoder,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    ...(interpolatedScene ? ["-i", interpolatedScene, "-t", "13.3"] : ["-ss",
    "133",
    "-i",
    source,
    "-t",
    "13.3",
    ...(enhancedTail
      ? [
          "-i", enhancedTail,
          "-filter_complex",
          "[0:v]crop=1430:610:30:11,setpts=PTS-STARTPTS[base];" +
            "[1:v]trim=duration=7.3,scale=1430:566:flags=lanczos,crop=1430:565:0:0,setpts=PTS-STARTPTS+6/TB[detail];" +
            "[base][detail]overlay=0:45:enable='gte(t,6)':eof_action=pass[scene]",
          "-map", "[scene]", "-t", "13.3",
        ]
      : ["-vf", "crop=1430:610:30:11"])]),
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
    "14",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "6",
    "-keyint_min",
    "6",
    "-sc_threshold",
    "0",
    "-movflags",
    "+faststart",
    path.join(out, `dealer-native-${version}.pending.mp4`),
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
        // Keep the actual moving card back until the tracked face opens.
        // Restrict by take and location so earlier recorded ranks cannot leak.
        const t = count / FPS;
        const openingBack =
          (t >= 9.02 && t < 9.6 && x > 140 && x < 225 && y < 58) ||
          (t >= 10.1 && t < 10.9667 && x > 40 && x < 140 && y < 105) ||
          (t >= 11.35 && t < 11.8667 && x > 40 && x < 140 && y < 59);
        const back =
          openingBack &&
          r > 90 &&
          g > 35 &&
          r - g > 18 &&
          r - b > 5 &&
          b > g * 0.7;
        const alpha = pink || cuff || back ? 255 : mask[y * MW + x],
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
if (decCode !== 0 || encCode !== 0 || count !== Math.round(13.3 * FPS))
  throw new Error(
    `Media preparation failed (${decCode}/${encCode}, ${count} frames)`,
  );
writeFileSync(
  path.join(out, `native-${version}.json`),
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
      originalPixels: !enhancedTail && !interpolatedScene,
      ...(interpolatedScene ? {
        sourceFps: 30,
        interpolation: "RIFE 4.6 intermediate motion frames; foreground masks recomputed at 60 fps",
        interpolationSource: path.basename(interpolatedScene),
      } : {}),
      ...(enhancedTail ? {
        enhancedSource: path.basename(enhancedTail),
        enhancedFromSeconds: 6,
        enhancedUntilSeconds: 13.3,
        taskId: "2eb41f2a-28bb-48d1-b825-22bb194b4541",
        note: "Original human performance with enhanced detail. Fast motion blur in the source is not fully recoverable.",
      } : {}),
      processing:
        `${enhancedTail ? "Enhanced card-opening frames, original waiting frames" : "Native source frames"}, ${interpolatedScene ? "RIFE intermediate frames" : "no interpolation"}, no frame blending, CRF 14, precomputed hand matte; audio removed.`,
    },
    null,
    2,
  ),
);
renameSync(
  path.join(out, `dealer-native-${version}.pending.mp4`),
  path.join(out, `dealer-native-${version}.mp4`),
);
console.log(`Prepared ${count} frames, ${count / FPS}s`);
