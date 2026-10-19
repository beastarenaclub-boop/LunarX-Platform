// Usage: node tools/prepare-wheel20-host.mjs path/to/green-screen-source.mp4
// Source: one 30-second performance with welcome / last call / result at 0/10/20s.
// Keep the original generated source outside the public delivery directory.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const source = process.argv[2];
if (!source || !existsSync(source))
  throw new Error("Supply the generated 30-second green-screen source.");
const ffmpeg =
  process.env.FFMPEG_PATH ||
  (existsSync(".cache/teen-patti-media/package/ffmpeg.exe")
    ? path.resolve(".cache/teen-patti-media/package/ffmpeg.exe")
    : "ffmpeg");
const destination = "artifacts/3d-game/public/media/wheel20-live";
for (const [name, start] of [
  ["welcome", 0],
  ["last-call", 10],
  ["result", 20],
  ["idle", 20],
]) {
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(start),
      "-i",
      source,
      "-t",
      "10",
      "-vf",
      // The generated actor is centred. Extract her walking area, then place
      // her at the studio's right-hand mark with feet on the same floor line.
      "crop=iw/2:ih:iw/4:0,scale=410:460,pad=1280:720:720:120:color=0x00ff00,fps=30,setsar=1",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "21",
      "-g",
      "30",
      "-keyint_min",
      "30",
      "-sc_threshold",
      "0",
      "-pix_fmt",
      "yuv420p",
      ...(name === "idle"
        ? ["-an"]
        : [
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=7",
            "-ar",
            "48000",
          ]),
      "-movflags",
      "+faststart",
      `${destination}/host-${name}-v4.mp4`,
    ],
    { stdio: "inherit" },
  );
  console.log(`Prepared host-${name}-v4.mp4`);
}
