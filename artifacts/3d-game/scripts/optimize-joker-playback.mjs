import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const ffmpeg =
  process.env.FFMPEG ??
  path.join(root, "tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe");
const ffprobe = path.join(
  path.dirname(ffmpeg),
  process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
);
const media = path.join(root, "artifacts/3d-game/public/media/teenpatti-joker");
const staging = path.join(root, "tmp/teenpatti-joker/light-playback");
mkdirSync(staging, { recursive: true });
const film = "dealer-playback-v4.mp4",
  poster = "dealer-playback-v4.webp";
const run = (args) =>
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "inherit",
  });
run([
  "-threads",
  "2",
  "-i",
  path.join(media, "dealer-reference-v3.mp4"),
  "-vf",
  "scale=960:540:flags=lanczos,setsar=1",
  "-an",
  "-c:v",
  "libx264",
  "-profile:v",
  "main",
  "-level:v",
  "3.1",
  "-preset",
  "fast",
  "-crf",
  "25",
  "-threads",
  "2",
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
  path.join(staging, film),
]);
const info = JSON.parse(
  execFileSync(
    ffprobe,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,nb_frames:format=duration",
      "-of",
      "json",
      path.join(staging, film),
    ],
    { encoding: "utf8" },
  ),
);
if (
  info.streams[0].width !== 960 ||
  info.streams[0].height !== 540 ||
  Math.abs(Number(info.format.duration) - 86) > 0.1
)
  throw new Error("Incomplete optimized dealer film");
run([
  "-i",
  path.join(staging, film),
  "-frames:v",
  "1",
  "-quality",
  "85",
  path.join(staging, poster),
]);
for (const name of [film, poster])
  renameSync(path.join(staging, name), path.join(media, name));
console.log(
  JSON.stringify({ ...info, bytes: statSync(path.join(media, film)).size }),
);
