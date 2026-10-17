import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const source = process.argv[2];
if (!source)
  throw new Error("Supply the Andar Bahar reference recording path.");
const encoder =
  process.env.FFMPEG ??
  path.resolve("tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe");
const destination = path.resolve(
  "artifacts/3d-game/public/media/andar-bahar-live",
);
mkdirSync(destination, { recursive: true });
function encode(args) {
  const result = spawnSync(
    encoder,
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("Dealer media preparation failed.");
}
encode([
  "-ss",
  "133",
  "-i",
  source,
  "-t",
  "36",
  "-vf",
  "crop=1430:610:30:11,fps=30",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "fast",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-g",
  "30",
  "-movflags",
  "+faststart",
  path.join(destination, "dealer-v1.mp4"),
]);
encode([
  "-ss",
  "1",
  "-i",
  path.join(destination, "dealer-v1.mp4"),
  "-frames:v",
  "1",
  "-q:v",
  "2",
  path.join(destination, "poster-v1.jpg"),
]);
encode([
  "-ss",
  "124",
  "-i",
  source,
  "-frames:v",
  "1",
  "-vf",
  "crop=1430:610:30:11",
  "-q:v",
  "2",
  path.join(destination, "felt-plate-v1.jpg"),
]);
writeFileSync(
  path.join(destination, "provenance.json"),
  JSON.stringify(
    {
      source: path.basename(source),
      sourceStartSeconds: 133,
      sourceEndSeconds: 169,
      crop: [1430, 610, 30, 11],
      audio: false,
      presentation:
        "Recorded studio backdrop. Original table cards are masked; game cards and results are rendered from the authenticated server round.",
    },
    null,
    2,
  ),
);
