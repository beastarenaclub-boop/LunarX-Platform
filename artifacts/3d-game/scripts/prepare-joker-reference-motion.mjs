import { execFileSync, spawn } from "node:child_process";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Keeps generated frames at their native cadence; no painted hands, motion
// interpolation, reversed clips or held frames. Stage every artifact before
// publishing the complete set so a refresh cannot read an unfinished MP4.
const root = path.resolve(import.meta.dirname, "../../..");
const ffmpeg =
  process.env.FFMPEG ??
  path.join(root, "tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe");
const source = path.join(root, "tmp/teenpatti-joker/reference-match");
const output = path.join(
  root,
  "artifacts/3d-game/public/media/teenpatti-joker",
);
const staging = path.join(source, "packaged");
await mkdir(staging, { recursive: true });
const scenes = [
  { file: path.join(output, "dealer-cinema-v2.mp4"), seconds: 20 },
  { file: path.join(source, "edited-motion-01.mp4"), seconds: 23 },
  { file: path.join(source, "edited-motion-02.mp4"), seconds: 23 },
  { file: path.join(source, "edited-motion-03.mp4"), seconds: 20 },
];
const ffprobe = path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
function inspect(file) {
  const metadata = JSON.parse(execFileSync(ffprobe, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,nb_frames:format=duration",
    "-of", "json", file,
  ], { encoding: "utf8" }));
  return { ...metadata.streams[0], duration: Number(metadata.format.duration) };
}
for (const scene of scenes) {
  const info = inspect(scene.file);
  if (!info.width || !info.height || info.duration < scene.seconds - 1 / 24)
    throw new Error(`Incomplete video section: ${scene.file}`);
}
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
const inputs = scenes.flatMap(({ file }) => ["-threads", "2", "-i", file]);
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
const main = path.join(staging, "dealer-reference-v3.mp4");
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
  "-threads",
  "2",
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
  path.join(staging, "dealer-reference-mobile-v3.mp4"),
]);
for (const [name, time] of [
  ["poster", 20.5],
  ["result", 70],
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
    path.join(staging, `dealer-reference-${name}-v3.webp`),
  ]);
}
await run([
  "-i",
  main,
  "-vf",
  "fps=1/4,scale=480:-1,tile=4x6",
  "-frames:v",
  "1",
  path.join(source, "sequence-contact.jpg"),
]);
const files = [
  "dealer-reference-v3.mp4",
  "dealer-reference-mobile-v3.mp4",
  "dealer-reference-poster-v3.webp",
  "dealer-reference-result-v3.webp",
];
for (const [file, width, height] of [
  [files[0], 1920, 1080],
  [files[1], 1280, 720],
]) {
  const info = inspect(path.join(staging, file));
  if (info.width !== width || info.height !== height ||
      Math.abs(info.duration - 86) > 1 / 24 || Number(info.nb_frames) !== 86 * 24)
    throw new Error(`Packaged film failed duration/frame validation: ${file}`);
}
const sizes = {};
for (const file of files)
  sizes[file] = (await stat(path.join(staging, file))).size;
for (const file of files)
  await rename(path.join(staging, file), path.join(output, file));
await writeFile(
  path.join(source, "packaged.json"),
  JSON.stringify({ scenes, fps: 24, duration: 86, sizes }, null, 2),
);
console.log(JSON.stringify({ duration: 86, sizes }));
