// Build continuous stage handoffs from two real walk-out / walk-in takes.
// Usage: node tools/prepare-wheel20-handoff.mjs <source-directory> [spinner|host|assemble]
// Source directory: spinner-walk-source.mp4, spinner-walk-matte.webm,
// host-walk-full-source.mp4. Generated sources are kept outside public assets.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const source = path.resolve(process.argv[2] || "tmp/wheel20-live/v5");
const mode = process.argv[3];
const media = path.resolve("artifacts/3d-game/public/media/wheel20-live");
const ffmpeg =
  process.env.FFMPEG_PATH ||
  path.resolve(".cache/teen-patti-media/package/ffmpeg.exe");
const encode = [
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
  "-movflags",
  "+faststart",
];
function run(args) {
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-filter_complex_threads",
      "2",
      ...args,
    ],
    { stdio: "inherit" },
  );
}
function packGreen(input, output, placement = "", canvas = "") {
  const spill = "clip((g(X,Y)-max(r(X,Y),b(X,Y))-15.3)/45.9,0,1)";
  const alpha = `255*(1-${spill}*${spill}*(3-2*${spill}))`;
  const filter = `[0:v]fps=30,${placement}format=gbrap,geq=r='r(X,Y)':g='min(g(X,Y),max(r(X,Y),b(X,Y)))':b='b(X,Y)':a='${alpha}',format=yuva444p,${canvas}split[r][a];[r]format=yuv420p[rgb];[a]alphaextract,scale=1280:180:flags=area,format=yuv420p[mask];[rgb][mask]vstack=inputs=2,setsar=1[v]`;
  run([
    "-i",
    input,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-an",
    ...encode,
    output,
  ]);
}
if (!mode || mode === "spinner") {
  // Use the exact original colour film and the tracked subject alpha. Exclude
  // the floor reflection and all scenery from the delivered foreground.
  const decoded = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-c:v",
      "libvpx-vp9",
      "-i",
      path.join(source, "spinner-walk-matte.webm"),
      "-vf",
      "alphaextract,fps=30,scale=480:270:flags=area",
      "-pix_fmt",
      "gray",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    { maxBuffer: 60 * 1024 * 1024 },
  );
  if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
  const matte = decoded.stdout;
  const size = 480 * 270;
  for (let i = 0; i < matte.length; i++) {
    const pixel = i % size,
      x = pixel % 480,
      y = Math.floor(pixel / 480);
    if (x < 480 * 0.61 || y < 270 * 0.18 || y > 270 * 0.84) matte[i] = 0;
  }
  const matteFile = path.join(source, "spinner-walk-clean.gray");
  fs.writeFileSync(matteFile, matte);
  run([
    "-i",
    path.join(source, "spinner-walk-source.mp4"),
    "-f",
    "rawvideo",
    "-pixel_format",
    "gray",
    "-video_size",
    "480x270",
    "-framerate",
    "30",
    "-i",
    matteFile,
    "-filter_complex",
    "[0:v]fps=30,scale=1280:720,setsar=1[rgb];[1:v]scale=1280:180:flags=area,format=yuv420p,setsar=1[mask];[rgb][mask]vstack=inputs=2[v]",
    "-map",
    "[v]",
    "-t",
    "10",
    "-an",
    ...encode,
    path.join(source, "spinner-walk-packed.mp4"),
  ]);
}
if (!mode || mode === "host") {
  // Same scale/mark as v4, but retain the full walking area. The source's right
  // edge lies beyond the stage edge, so the actor cannot hit an inset crop.
  packGreen(
    path.join(source, "host-walk-full-source.mp4"),
    path.join(source, "host-walk-packed.mp4"),
    "crop=iw*0.75:ih:iw*0.25:0,scale=615:460,crop=560:460:0:0,setsar=1,",
    "pad=1280:720:720:120:color=0x00000000,",
  );
  packGreen(
    path.join(media, "host-last-call-v4.mp4"),
    path.join(source, "host-last-call-packed.mp4"),
    "crop=410:460:720:120,",
    "pad=1280:720:720:120:color=0x00000000,",
  );
}
if (!mode || mode === "assemble") {
  const report = {};
  for (const role of ["host", "spinner"]) {
    const input = path.join(source, `${role}-walk-packed.mp4`);
    const frames = spawnSync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input,
        "-vf",
        "crop=1280:180:0:720,scale=320:180",
        "-pix_fmt",
        "gray",
        "-f",
        "rawvideo",
        "pipe:1",
      ],
      { maxBuffer: 30 * 1024 * 1024 },
    );
    if (frames.status !== 0) throw new Error(frames.stderr.toString());
    const size = 320 * 180,
      empty = [];
    for (let f = 0; f < frames.stdout.length / size; f++) {
      let visible = 0;
      for (let i = f * size; i < (f + 1) * size; i++)
        if (frames.stdout[i] > 127) visible++;
      if (visible < size * 0.0001 && f > 30 && f < 270) empty.push(f);
    }
    if (empty.length < 6)
      throw new Error(
        `${role} never fully leaves the stage; do not publish this take`,
      );
    const midpoint = Math.round((empty[0] + empty.at(-1)) / 2);
    if (!empty.includes(midpoint))
      throw new Error(`${role}: interrupted empty-stage interval`);
    const split = midpoint / 30;
    report[role] = {
      emptyFrom: empty[0] / 30,
      emptyUntil: empty.at(-1) / 30,
      split,
      emptyFrames: empty.length,
    };
    for (const [name, start, duration] of [
      ["exit", 0, split],
      ["entry", split, 10 - split],
    ]) {
      run([
        "-i",
        input,
        "-vf",
        `trim=start=${start}:duration=${duration},setpts=(PTS-STARTPTS)*${4 / duration},fps=30`,
        "-t",
        "4",
        "-an",
        ...encode,
        path.join(source, `${role}-${name}.mp4`),
      ]);
    }
  }
  for (const [clip, intro, outgoing, incoming, audio] of [
    [
      "last-call",
      path.join(source, "host-last-call-packed.mp4"),
      "host",
      "spinner",
      "host-last-call-v4.mp4",
    ],
    [
      "result",
      path.join(media, "studio-result-v3.mp4"),
      "spinner",
      "host",
      "studio-result-v3.mp4",
    ],
  ]) {
    run([
      "-i",
      intro,
      "-i",
      path.join(source, `${outgoing}-exit.mp4`),
      "-i",
      path.join(source, `${incoming}-entry.mp4`),
      "-i",
      path.join(media, audio),
      "-filter_complex",
      "[0:v]trim=duration=2,setpts=PTS-STARTPTS,fps=30,scale=1280:900,setsar=1[intro];[1:v]setpts=PTS-STARTPTS[out];[2:v]setpts=PTS-STARTPTS[in];[intro][out][in]concat=n=3:v=1:a=0[v]",
      "-map",
      "[v]",
      "-map",
      "3:a:0",
      "-t",
      "10",
      ...encode,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      path.join(media, `studio-${clip}-v5.mp4`),
    ]);
  }
  fs.writeFileSync(
    path.join(source, "handoff-measurements.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
}
