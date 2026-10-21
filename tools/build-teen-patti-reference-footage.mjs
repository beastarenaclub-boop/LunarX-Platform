import { spawn } from "node:child_process";
import { copyFile, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { handMatte } from "./teen-patti-hand-matte.mjs";

// The user approved using this recording's dealer on 20 October 2026.
// Only the performance is retained: recorded cards are removed before shipping.
// Rebuild: run this with --prepare-only, then track-teen-patti-hands.mjs,
// then run this again with the same source and --reuse-cut.
const source = process.argv[2];
if (!source)
  throw new Error("Pass the reference MP4 path as the first argument");
const ffmpeg = path.resolve(".cache/teen-patti-media/package/ffmpeg.exe");
const directory = path.resolve(
  "artifacts/3d-game/public/media/teen-patti-2020",
);
const cache = path.resolve(".cache/teen-patti-footage");
await mkdir(cache, { recursive: true });
await mkdir(directory, { recursive: true });
const cuts = [
  [38, 56.3],
  [0, 1.1],
  [4.3, 6.2],
  [11, 13],
  [15.7, 17.7],
  [21, 23],
  [26.7, 28.7],
  [28.7, 30.7],
];
async function run(args) {
  const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const [code] = await once(child, "close");
  if (code) throw new Error(errors || `ffmpeg exited ${code}`);
}
const cutFile = path.join(cache, "reference-cut.mp4");
const filter =
  `[0:v]crop=1036:586:174:0,split=${cuts.length}${cuts.map((_, i) => `[v${i}]`).join("")};` +
  cuts
    .map(
      ([start, end], i) =>
        `[v${i}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[s${i}]`,
    )
    .join(";") +
  ";" +
  cuts.map((_, i) => `[s${i}]`).join("") +
  `concat=n=${cuts.length}:v=1:a=0[out]`;
console.log("Preparing the reference dealer performance");
if (!process.argv.includes("--reuse-cut"))
  await run([
    "-i",
    source,
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-y",
    cutFile,
  ]);

// Replace the recorded card area with nearby felt while preserving skin and
// fingertips. This operates on video frames, not on generated dealer artwork.
if (process.argv.includes("--prepare-only")) process.exit(0);
const width = 1036,
  height = 586,
  stride = width * 3;
const patch = { x: 312, y: 316, width: 414, height: 112 };
const decoder = spawn(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    cutFile,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const cleanFile = path.join(cache, "reference-clean-v2.mp4");
const tracks = JSON.parse(
  await readFile(".cache/teen-patti-performance/hand-tracks.json", "utf8"),
);
// Detection can briefly miss a blurred fingertip at an edit. Borrow only the
// missing hand from the nearest detection within that same take; never cross a cut.
const boundaries = [549, 582, 639, 699, 759, 819, 879, 939];
const detected = tracks.frames.slice();
for (let i = 549; i < detected.length; i++) {
  if (detected[i].length === 2) continue;
  const segment = boundaries.findIndex((end) => end > i);
  let nearest = -1;
  for (let d = 1; d < 20 && nearest < 0; d++)
    for (const candidate of [i + d, i - d])
      if (
        candidate >= boundaries[segment - 1] &&
        candidate < boundaries[segment] &&
        detected[candidate].length === 2
      ) {
        nearest = candidate;
        break;
      }
  if (nearest < 0) throw new Error(`Missing hand tracking at frame ${i}`);
  if (!detected[i].length) tracks.frames[i] = detected[nearest];
  else {
    const wrist = detected[i][0][0];
    const alternatives = detected[nearest].map((hand) => ({
      hand,
      distance: Math.hypot(hand[0][0] - wrist[0], hand[0][1] - wrist[1]),
    }));
    tracks.frames[i] = [
      detected[i][0],
      alternatives.sort((a, b) => b.distance - a.distance)[0].hand,
    ];
  }
}
const handPaths = [];
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
    "23",
    "-g",
    "30",
    "-maxrate",
    "1800k",
    "-bufsize",
    "3600k",
    "-threads",
    "4",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-y",
    cleanFile,
  ],
  { stdio: ["pipe", "ignore", "inherit"] },
);
const decodeDone = once(decoder, "close");
const encodeDone = once(encoder, "close");
const size = width * height * 3;
let frame = Buffer.allocUnsafe(size),
  offset = 0,
  count = 0;
function clean(pixels) {
  if (count < 549) return;
  const { mask, path } = handMatte(pixels, tracks.frames[count]);
  handPaths.push(path);
  for (let y = 0; y < patch.height; y++)
    for (let x = 0; x < patch.width; x++) {
      if (x + patch.x > 670 && y + patch.y < 360) continue;
      if (mask[y * patch.width + x]) continue;
      const blend = Math.min(
        1,
        x / 8,
        (patch.width - 1 - x) / 8,
        y / 5,
        (patch.height - 1 - y) / 7,
      );
      const i = (y + patch.y) * stride + (x + patch.x) * 3;
      // Sample inside the felt; sampling farther down crosses the curved rim.
      const sample = (440 + Math.floor(y * 0.22)) * stride + (x + patch.x) * 3;
      for (let c = 0; c < 3; c++)
        pixels[i + c] = Math.round(
          pixels[i + c] * (1 - blend) + pixels[sample + c] * blend,
        );
    }
}
console.log("Removing recorded card values and retaining the dealer hands");
for await (const chunk of decoder.stdout) {
  let read = 0;
  while (read < chunk.length) {
    const length = Math.min(size - offset, chunk.length - read);
    chunk.copy(frame, offset, read, read + length);
    offset += length;
    read += length;
    if (offset === size) {
      clean(frame);
      if (!encoder.stdin.write(frame)) await once(encoder.stdin, "drain");
      frame = Buffer.allocUnsafe(size);
      offset = 0;
      count++;
    }
  }
}
encoder.stdin.end();
if ((await decodeDone)[0] || (await encodeDone)[0])
  throw new Error("Footage processing failed");
await copyFile(cleanFile, path.join(directory, "reference-dealer-v2.mp4"));
await run([
  "-i",
  cleanFile,
  "-vf",
  "scale=720:408",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "23",
  "-g",
  "30",
  "-threads",
  "4",
  "-movflags",
  "+faststart",
  "-y",
  path.join(directory, "reference-dealer-mobile-v2.mp4"),
]);
await writeFile(
  path.join(directory, "reference-hands-v2.json"),
  JSON.stringify({ startFrame: 549, fps: 30, paths: handPaths }),
);
await run([
  "-i",
  path.join(directory, "reference-dealer-v2.mp4"),
  "-frames:v",
  "1",
  "-c:v",
  "libwebp",
  "-quality",
  "88",
  "-y",
  path.join(directory, "reference-poster.webp"),
]);
await writeFile(
  path.join(directory, "footage.json"),
  JSON.stringify(
    {
      source: path.basename(source),
      approved: "2026-10-20",
      crop: { x: 174, y: 0, width, height },
      cuts,
      fps: 30,
      frames: count,
      betting: [0, 18.3],
      reveal: [18.3, 29.3],
      rest: [29.3, 31.3],
      recordedCardReplacement: patch,
      handTracking: {
        model: tracks.model,
        modelUrl: tracks.modelUrl,
        packageVersion: tracks.packageVersion,
        processing:
          "Offline only; native video plus frame-synchronised SVG card occlusion. No browser inference or pixel readback.",
      },
      variants: ["reference-dealer-v2.mp4", "reference-dealer-mobile-v2.mp4"],
      presentation:
        "User-approved recorded dealer performance. Current server cards, round ID, countdown and IST clock are rendered separately. Original recording audio is removed.",
    },
    null,
    2,
  ) + "\n",
);
console.log(`Saved reference dealer footage (${count} frames)`);

console.log(
  JSON.stringify(
    await Promise.all(
      [
        "reference-dealer-v2.mp4",
        "reference-dealer-mobile-v2.mp4",
        "reference-hands-v2.json",
      ].map(async (name) => ({
        name,
        bytes: (await stat(path.join(directory, name))).size,
      })),
    ),
  ),
);
