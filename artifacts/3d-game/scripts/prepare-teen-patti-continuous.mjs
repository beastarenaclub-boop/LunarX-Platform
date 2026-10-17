// Run with FFMPEG pointing to an installed ffmpeg binary, or use PATH.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const asset = (name) =>
  fileURLToPath(new URL(`../src/assets/teenpatti/${name}`, import.meta.url));
const result = spawnSync(
  process.env.FFMPEG ?? "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    asset("maya-betting-idle.mp4"),
    "-i",
    asset("maya-navy-table.mp4"),
    "-filter_complex",
    "[0:v]trim=end_frame=62,setpts=PTS-STARTPTS[idle];[1:v]setpts=PTS-STARTPTS[opening];[idle][opening]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "fast",
    "-g",
    "24",
    "-keyint_min",
    "24",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    asset("maya-continuous-table.mp4"),
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
