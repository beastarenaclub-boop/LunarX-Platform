import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "../artifacts/3d-game/node_modules/@playwright/test/index.mjs";
import { execFileSync } from "node:child_process";

const cache = path.resolve(".cache/teen-patti-performance");
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
await mkdir(cache, { recursive: true });
// Keep the model and WASM tooling out of the shipped application's dependencies.
try {
  await stat(path.join(cache, "vision/package/vision_bundle.mjs"));
} catch {
  const response = await fetch(
    "https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.1.1.tgz",
  );
  if (!response.ok) throw new Error(`Tracker download: ${response.status}`);
  const archive = path.join(cache, "vision.tgz");
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  await mkdir(path.join(cache, "vision"), { recursive: true });
  execFileSync("tar", ["-xf", archive, "-C", path.join(cache, "vision")]);
}
const modelFile = path.join(cache, "hand_landmarker.task");
try {
  await stat(modelFile);
} catch {
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`Model download: ${response.status}`);
  await writeFile(modelFile, Buffer.from(await response.arrayBuffer()));
}
const videoFile = path.resolve(".cache/teen-patti-footage/reference-cut.mp4");
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><video id="source" muted playsinline></video>');
      return;
    }
    const filename =
      url.pathname === "/source.mp4"
        ? videoFile
        : path.resolve(cache, "." + url.pathname);
    if (filename !== videoFile && !filename.startsWith(cache + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const info = await stat(filename);
    res.setHeader(
      "Content-Type",
      filename.endsWith(".mjs") || filename.endsWith(".js")
        ? "text/javascript"
        : filename.endsWith(".wasm")
          ? "application/wasm"
          : filename.endsWith(".mp4")
            ? "video/mp4"
            : "application/octet-stream",
    );
    const match = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    if (match) {
      const start = Number(match[1]),
        end = match[2] ? Number(match[2]) : info.size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
      });
      createReadStream(filename, { start, end }).pipe(res);
    } else {
      res.setHeader("Content-Length", info.size);
      createReadStream(filename).pipe(res);
    }
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.text().startsWith("TRACK ")) console.log(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const tracks = await page.evaluate(async () => {
    const { FilesetResolver, HandLandmarker } =
      await import("/vision/package/vision_bundle.mjs");
    const vision = await FilesetResolver.forVisionTasks("/vision/package/wasm");
    const tracker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "/hand_landmarker.task", delegate: "CPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.35,
      minHandPresenceConfidence: 0.35,
      minTrackingConfidence: 0.4,
    });
    const video = document.querySelector("video");
    video.src = "/source.mp4";
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = reject;
    });
    const roi = { x: 270, y: 245, width: 540, height: 220 };
    const canvas = document.createElement("canvas");
    canvas.width = roi.width * 2;
    canvas.height = roi.height * 2;
    const context = canvas.getContext("2d");
    const frames = [];
    for (let frame = 0; frame < Math.round(video.duration * 30); frame++) {
      await new Promise((resolve) => {
        video.onseeked = resolve;
        video.currentTime = (frame + 0.1) / 30;
      });
      context.drawImage(
        video,
        roi.x,
        roi.y,
        roi.width,
        roi.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const result = tracker.detectForVideo(canvas, (frame * 1000) / 30 + 1);
      frames.push(
        result.landmarks.map((hand) =>
          hand.map((point) => [
            Math.round((roi.x + point.x * roi.width) * 100) / 100,
            Math.round((roi.y + point.y * roi.height) * 100) / 100,
          ]),
        ),
      );
      if (frame % 100 === 0)
        console.log(
          `TRACK ${frame}/${Math.round(video.duration * 30)} frames, ${result.landmarks.length} hands`,
        );
    }
    tracker.close();
    return frames;
  });
  await writeFile(
    path.join(cache, "hand-tracks.json"),
    JSON.stringify({
      model: "MediaPipe HandLandmarker float16",
      packageVersion: "1.1.1",
      modelUrl,
      fps: 30,
      frames: tracks,
    }),
  );
  console.log(
    JSON.stringify({
      frames: tracks.length,
      twoHands: tracks.filter((h) => h.length === 2).length,
      noHands: tracks.filter((h) => h.length === 0).length,
    }),
  );
} finally {
  await browser.close();
  server.close();
}
