import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

// Use the real preparation take, with no animated replacements over the hands.
// The background passer-by is removed using an earlier empty frame from the
// same locked camera. No hand, card, face or foreground-table pixel is replaced.
const source = process.argv[2];
if (!source) throw new Error("Pass the original reference MP4");
const ffmpeg = path.resolve(".cache/teen-patti-media/package/ffmpeg.exe");
const destination = path.resolve(
  "artifacts/3d-game/public/media/teen-patti-2020",
);
await mkdir(destination, { recursive: true });
const width = 1036,
  height = 586,
  frameSize = width * height * 3;
async function run(args, capture = false) {
  const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args], {
    stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"],
  });
  const chunks = [];
  let errors = "";
  child.stdout?.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => (errors += chunk));
  if ((await once(child, "close"))[0]) throw new Error(errors);
  return Buffer.concat(chunks);
}
const background = await run(
  [
    "-ss",
    "6.8",
    "-i",
    source,
    "-vf",
    "crop=1036:586:174:0",
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ],
  true,
);
if (background.length !== frameSize)
  throw new Error("Missing clean background frame");
const decoder = spawn(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    "38",
    "-i",
    source,
    "-t",
    "18.3",
    "-vf",
    "crop=1036:586:174:0",
    "-an",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const output = path.join(destination, "reference-natural-v3.mp4");
const encoder = spawn(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${width}x${height}`,
    "-r",
    "30",
    "-i",
    "pipe:0",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "21",
    "-g",
    "30",
    "-threads",
    "3",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-y",
    output,
  ],
  { stdio: ["pipe", "ignore", "inherit"] },
);
const decoded = once(decoder, "close"),
  encoded = once(encoder, "close");
// The dealer's upper arm occasionally crosses the background patch. Keep its
// connected silhouette; her hands are entirely below this patch, untouched.
const roi = { x: 380, y: 180, w: 100, h: 140 };
function preserveArm(pixels) {
  const skin = new Uint8Array(roi.w * roi.h),
    keep = new Uint8Array(skin.length),
    queue = new Int32Array(skin.length);
  for (let y = 0; y < roi.h; y++)
    for (let x = 0; x < roi.w; x++) {
      const p = ((y + roi.y) * width + x + roi.x) * 3,
        r = pixels[p],
        g = pixels[p + 1],
        b = pixels[p + 2];
      if (
        r > 85 &&
        g > 45 &&
        b > 35 &&
        r - g > 15 &&
        r - b > 8 &&
        r < g * 2.3 &&
        r < b * 2.5
      )
        skin[y * roi.w + x] = 1;
    }
  for (let first = 0; first < skin.length; first++) {
    if (skin[first] !== 1) continue;
    let head = 0,
      tail = 1,
      seed = false;
    queue[0] = first;
    skin[first] = 2;
    while (head < tail) {
      const at = queue[head++],
        x = at % roi.w,
        y = Math.floor(at / roi.w);
      if (x + roi.x > 443) seed = true;
      for (const next of [
        x ? at - 1 : -1,
        x + 1 < roi.w ? at + 1 : -1,
        y ? at - roi.w : -1,
        y + 1 < roi.h ? at + roi.w : -1,
      ]) {
        if (next >= 0 && skin[next] === 1) {
          skin[next] = 2;
          queue[tail++] = next;
        }
      }
    }
    if (!seed || tail < 40) continue;
    for (let n = 0; n < tail; n++) {
      const x = queue[n] % roi.w,
        y = Math.floor(queue[n] / roi.w);
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++)
          if (x + dx >= 0 && x + dx < roi.w && y + dy >= 0 && y + dy < roi.h)
            keep[(y + dy) * roi.w + x + dx] = 1;
    }
  }
  return keep;
}
function cleanBackground(pixels) {
  const arm = preserveArm(pixels);
  for (let y = 0; y < 255; y++)
    for (let x = 0; x < 435; x++) {
      if (x >= 415 && y >= roi.y && arm[(y - roi.y) * roi.w + x - roi.x])
        continue;
      const blend = Math.min(1, (435 - x) / 4, (255 - y) / 4),
        p = (y * width + x) * 3;
      for (let c = 0; c < 3; c++)
        pixels[p + c] = Math.round(
          pixels[p + c] * (1 - blend) + background[p + c] * blend,
        );
    }
}
let pixels = Buffer.allocUnsafe(frameSize),
  offset = 0,
  count = 0;
for await (const chunk of decoder.stdout) {
  for (let at = 0; at < chunk.length; ) {
    const size = Math.min(frameSize - offset, chunk.length - at);
    chunk.copy(pixels, offset, at, at + size);
    at += size;
    offset += size;
    if (offset === frameSize) {
      cleanBackground(pixels);
      if (!encoder.stdin.write(pixels)) await once(encoder.stdin, "drain");
      pixels = Buffer.allocUnsafe(frameSize);
      offset = 0;
      count++;
    }
  }
}
encoder.stdin.end();
if ((await decoded)[0] || (await encoded)[0])
  throw new Error("Natural footage encoding failed");
await run([
  "-i",
  output,
  "-vf",
  "scale=720:408",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "21",
  "-g",
  "30",
  "-threads",
  "3",
  "-movflags",
  "+faststart",
  "-y",
  path.join(destination, "reference-natural-mobile-v3.mp4"),
]);
await run([
  "-i",
  output,
  "-frames:v",
  "1",
  "-c:v",
  "libwebp",
  "-quality",
  "90",
  "-y",
  path.join(destination, "reference-natural-poster-v3.webp"),
]);
await writeFile(
  path.join(destination, "natural-footage.json"),
  JSON.stringify(
    {
      source: path.basename(source),
      created: "2026-10-21",
      crop: { x: 174, y: 0, width, height },
      take: [38, 56.3],
      fps: 30,
      frames: count,
      background: {
        cleanFrame: 6.8,
        patch: { x: 0, y: 0, width: 435, height: 255 },
        foreground:
          "Connected dealer upper arm preserved; all pixels below y=255 untouched before encoding.",
      },
      presentation:
        "User requested removal of the background passer-by and allowed no physical card opening. Native continuous preparation footage, no floating cards, hand masks, generated hands or animated replacements. Authoritative round cards appear only in the result rail; date and time remain live.",
      variants: ["reference-natural-v3.mp4", "reference-natural-mobile-v3.mp4"],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    frames: count,
    desktopBytes: (await stat(output)).size,
    mobileBytes: (
      await stat(path.join(destination, "reference-natural-mobile-v3.mp4"))
    ).size,
  }),
);
