import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

// Run after the two reference-footage builders. Reuse the approved performance
// and its offline hand silhouettes; the browser never segments video pixels.
const ffmpeg = path.resolve(".cache/teen-patti-media/package/ffmpeg.exe");
const directory = path.resolve(
  "artifacts/3d-game/public/media/teen-patti-2020",
);
const cache = path.resolve(".cache/teen-patti-sequential");
await mkdir(cache, { recursive: true });
const width = 1036,
  height = 586,
  size = width * height * 3;
async function run(args, capture = false) {
  const p = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args], {
    stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"],
  });
  const chunks = [];
  let errors = "";
  p.stdout?.on("data", (c) => chunks.push(c));
  p.stderr.on("data", (c) => (errors += c));
  if ((await once(p, "close"))[0]) throw new Error(errors);
  return Buffer.concat(chunks);
}
const plate = await run(
  [
    "-i",
    path.join(directory, "reference-natural-v3.mp4"),
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
if (plate.length !== size) throw new Error("Missing clean background");
const felt = Buffer.from(plate);
// The empty take has the dealer's hands above the centre slots. Replace only
// that small part of the plate with the adjacent felt; keep printed slots.
for (let y = 316; y < 370; y++)
  for (let x = 420; x < 620; x++) {
    const t = (x - 420) / 200,
      p = (y * width + x) * 3;
    for (let c = 0; c < 3; c++)
      felt[p + c] = Math.round(
        plate[(y * width + 405) * 3 + c] * (1 - t) +
          plate[(y * width + 650) * 3 + c] * t,
      );
  }
function rasterize(polygons, w, h, ox = 0, oy = 0) {
  const mask = new Uint8Array(w * h);
  for (const points of polygons) {
    for (let y = 0; y < h; y++) {
      const py = y + oy + 0.5,
        crossings = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i],
          b = points[j];
        if (a[1] > py !== b[1] > py)
          crossings.push(a[0] + ((py - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2)
        mask.fill(
          1,
          y * w + Math.max(0, Math.ceil(crossings[i] - ox)),
          y * w + Math.min(w, Math.ceil(crossings[i + 1] - ox)),
        );
    }
  }
  return mask;
}
const foreground = rasterize(
  [
    [
      [490, 78],
      [547, 78],
      [573, 101],
      [581, 157],
      [579, 185],
      [600, 201],
      [639, 285],
      [650, 318],
      [395, 318],
      [407, 258],
      [444, 201],
      [470, 184],
      [472, 116],
    ],
    [
      [253, 310],
      [862, 310],
      [915, 382],
      [905, 475],
      [845, 530],
      [730, 568],
      [355, 581],
      [195, 533],
      [130, 455],
      [135, 380],
      [197, 330],
    ],
  ],
  width,
  height,
);
const hands = JSON.parse(
  await readFile(path.join(directory, "reference-hands-v2.json"), "utf8"),
);
const masks = hands.paths.map((d) =>
  rasterize(
    d
      .split("Z")
      .filter(Boolean)
      .map((p) =>
        [...p.matchAll(/([\d.]+),([\d.]+)/g)].map((m) => [+m[1], +m[2]]),
      ),
    414,
    112,
    312,
    316,
  ),
);
const decoder = spawn(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    "18.3",
    "-i",
    ".cache/teen-patti-footage/reference-cut.mp4",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const opening = path.join(cache, "opening.mp4");
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
    opening,
  ],
  { stdio: ["pipe", "ignore", "inherit"] },
);
const decoded = once(decoder, "close"),
  encoded = once(encoder, "close");
let pixels = Buffer.allocUnsafe(size),
  offset = 0,
  frame = 0;
for await (const chunk of decoder.stdout) {
  for (let at = 0; at < chunk.length; ) {
    const take = Math.min(size - offset, chunk.length - at);
    chunk.copy(pixels, offset, at, at + take);
    offset += take;
    at += take;
    if (offset !== size) continue;
    const mask = masks[Math.min(frame, masks.length - 1)];
    // A clean locked background removes the passer-by throughout every opening.
    // The dealer and her real hands remain the original performance.
    for (let i = 0; i < foreground.length; i++)
      if (!foreground[i]) {
        const p = i * 3;
        pixels[p] = plate[p];
        pixels[p + 1] = plate[p + 1];
        pixels[p + 2] = plate[p + 2];
      }
    for (let y = 322; y < 402; y++)
      for (let x = 363; x < 674; x++) {
        if (mask[(y - 316) * 414 + x - 312]) continue;
        const blend = Math.min(
            1,
            (x - 363) / 5,
            (674 - x) / 5,
            (y - 322) / 5,
            (402 - y) / 4,
          ),
          p = (y * width + x) * 3;
        for (let c = 0; c < 3; c++)
          pixels[p + c] = Math.round(
            pixels[p + c] * (1 - blend) + felt[p + c] * blend,
          );
      }
    if (!encoder.stdin.write(pixels)) await once(encoder.stdin, "drain");
    pixels = Buffer.allocUnsafe(size);
    offset = 0;
    frame++;
  }
}
encoder.stdin.end();
if ((await decoded)[0] || (await encoded)[0])
  throw new Error("Opening encode failed");
const list = path.join(cache, "concat.txt");
await writeFile(
  list,
  [path.join(directory, "reference-natural-v3.mp4"), opening]
    .map((p) => `file '${p.replaceAll("\\", "/")}'`)
    .join("\n"),
);
const full = path.join(directory, "reference-sequential-v4.mp4");
await run([
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  list,
  "-c",
  "copy",
  "-movflags",
  "+faststart",
  "-y",
  full,
]);
const mobile = path.join(directory, "reference-sequential-mobile-v4.mp4");
await run([
  "-i",
  full,
  "-vf",
  "scale=720:408",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "22",
  "-g",
  "30",
  "-threads",
  "3",
  "-movflags",
  "+faststart",
  "-y",
  mobile,
]);
await writeFile(
  path.join(directory, "sequential-footage.json"),
  JSON.stringify(
    {
      source: "Screen Recording 2026-10-19 103224.mp4",
      approved: "2026-10-20",
      updated: "2026-10-21",
      presentation:
        "Original dealer opening gestures; background passer-by removed. Recorded card values replaced with server cards on the felt and in the result rail.",
      betting: [0, 18.3],
      opening: [18.3, 29.3],
      rest: [29.3, 31.3],
      fps: 30,
      handOcclusion:
        "reference-hands-v2.json; precomputed SVG silhouettes; no browser inference or canvas readback",
      variants: await Promise.all(
        [full, mobile].map(async (p) => ({
          file: path.basename(p),
          bytes: (await stat(p)).size,
        })),
      ),
    },
    null,
    2,
  ),
);
console.log(`Built ${frame} opening frames; desktop and mobile ready`);
