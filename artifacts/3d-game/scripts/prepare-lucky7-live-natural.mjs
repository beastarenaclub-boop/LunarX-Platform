import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const work = path.join(root, "tmp/lucky7-live");
const media = path.join(root, "artifacts/3d-game/public/media/lucky7-live");
const ffmpeg =
  process.env.FFMPEG ||
  path.join(root, "tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe");
const run = (args) => {
  const result = spawnSync(
    ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`FFmpeg failed: ${result.status}`);
};
for (const [source, reference, output] of [
  ["dealer-idle-source-v5.mp4", "hold-extension-end.jpg", "idle-aligned.mp4"],
  [
    "dealer-continuation-source-v5.mp4",
    "hold-extension-start.jpg",
    "continuation-aligned.mp4",
  ],
]) {
  for (const name of [source, reference])
    if (!existsSync(path.join(work, name)))
      throw new Error(`Missing source: ${name}`);
  // The generator delivered a 21:9 crop. Restore the original camera mapping
  // with its stationary top/bottom borders; never stretch the dealer's body.
  run([
    "-loop",
    "1",
    "-i",
    path.join(work, reference),
    "-i",
    path.join(work, source),
    "-filter_complex",
    "[1:v]scale=1920:824,setsar=1[shot];[0:v][shot]overlay=0:38:shortest=1,format=yuv420p",
    "-t",
    "10",
    "-r",
    "24",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "16",
    path.join(work, output),
  ]);
}
run([
  "-i",
  path.join(work, "idle-aligned.mp4"),
  "-i",
  path.join(work, "dealer-station-source-v4.mp4"),
  "-i",
  path.join(work, "continuation-aligned.mp4"),
  "-filter_complex",
  "[0:v]trim=end_frame=240,setpts=PTS-STARTPTS,setsar=1[i];[1:v]crop=1920:900:0:30,trim=end_frame=240,setpts=PTS-STARTPTS,setsar=1[a];[2:v]trim=end_frame=240,setpts=PTS-STARTPTS,setsar=1[h];[i][a][h]concat=n=3:v=1:a=0[v]",
  "-map",
  "[v]",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-g",
  "24",
  "-keyint_min",
  "24",
  "-sc_threshold",
  "0",
  "-movflags",
  "+faststart",
  path.join(media, "dealer-natural-v5.mp4"),
]);
run([
  "-i",
  path.join(media, "dealer-natural-v5.mp4"),
  "-vf",
  "scale=1280:600:flags=lanczos",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "22",
  "-pix_fmt",
  "yuv420p",
  "-g",
  "24",
  "-keyint_min",
  "24",
  "-sc_threshold",
  "0",
  "-movflags",
  "+faststart",
  path.join(media, "dealer-natural-mobile-v5.mp4"),
]);
run([
  "-i",
  path.join(media, "dealer-natural-v5.mp4"),
  "-frames:v",
  "1",
  "-q:v",
  "2",
  "-update",
  "1",
  path.join(media, "dealer-natural-poster-v5.jpg"),
]);
console.log(
  "Prepared native-speed 30-second dealer timeline, desktop and mobile.",
);
