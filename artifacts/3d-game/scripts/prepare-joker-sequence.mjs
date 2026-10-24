import { spawn } from "node:child_process";
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

// Native photographic motion only: trim and concatenate performances. No
// painted-over hands, felt replacement, reversed motion, or frozen video frames.
const root = path.resolve(import.meta.dirname, "../../..");
const ffmpeg =
  process.env.FFMPEG ??
  path.join(root, "tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe");
const source = path.resolve(process.argv[2] ?? "tmp/teenpatti-joker/cinema-v2");
const output = path.join(
  root,
  "artifacts/3d-game/public/media/teenpatti-joker",
);
await mkdir(output, { recursive: true });
const scenes = [
  { name: "shuffle", seconds: 10 },
  { name: "cut", seconds: 10 },
  { name: "deal", seconds: 7 },
  { name: "collect", seconds: 6 },
];
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-y", ...args],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let errors = "";
    child.stderr.on("data", (data) => {
      errors += data;
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code ? reject(new Error(errors)) : resolve(),
    );
  });
}
const inputs = scenes.flatMap(({ name }) => [
  "-threads",
  "2",
  "-i",
  path.join(source, `${name}.mp4`),
]);
const filters =
  scenes
    .map(
      ({ seconds }, i) =>
        `[${i}:v]trim=start=0:duration=${seconds},setpts=PTS-STARTPTS,scale=1920:1080:flags=lanczos,setsar=1,fps=24,format=yuv420p[v${i}]`,
    )
    .join(";") +
  ";" +
  scenes.map((_, i) => `[v${i}]`).join("") +
  "concat=n=4:v=1:a=0[out]";
const main = path.join(output, "dealer-cinema-v2.mp4");
await run([
  ...inputs,
  "-filter_complex_threads",
  "1",
  "-filter_complex",
  filters,
  "-map",
  "[out]",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "fast",
  "-threads",
  "4",
  "-crf",
  "20",
  "-g",
  "24",
  "-movflags",
  "+faststart",
  main,
]);
await run([
  "-i",
  main,
  "-vf",
  "scale=1280:720:flags=lanczos",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "fast",
  "-threads",
  "4",
  "-crf",
  "24",
  "-g",
  "24",
  "-movflags",
  "+faststart",
  path.join(output, "dealer-cinema-mobile-v2.mp4"),
]);
for (const [name, time] of [
  ["poster", 0.5],
  ["result", 26.8],
]) {
  await run([
    "-ss",
    String(time),
    "-i",
    main,
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-quality",
    "87",
    path.join(output, `dealer-cinema-${name}-v2.webp`),
  ]);
}
await run([
  "-i",
  main,
  "-vf",
  "fps=1/2,scale=480:-1,tile=4x5",
  "-frames:v",
  "1",
  path.join(source, "sequence-contact.jpg"),
]);
const sizes = {};
for (const name of [
  "dealer-cinema-v2.mp4",
  "dealer-cinema-mobile-v2.mp4",
  "dealer-cinema-poster-v2.webp",
  "dealer-cinema-result-v2.webp",
]) {
  sizes[name] = (await stat(path.join(output, name))).size;
}
await writeFile(
  path.join(source, "packaged.json"),
  JSON.stringify({ scenes, fps: 24, duration: 33, sizes }, null, 2),
);
console.log(JSON.stringify({ scenes, sizes }));
