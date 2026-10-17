// Offline authoring: node scripts/recast-teen-patti-face.mjs [preview|render]
// The model/CDN files are authoring dependencies, never runtime dependencies.
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workspace = path.resolve(project, "../..");
const out = path.join(workspace, ".cache/tp-new-dealer/render");
await mkdir(out, { recursive: true });
const vendor = path.join(workspace, ".cache/tp-new-dealer/vendor");
await mkdir(vendor, { recursive: true });
const dependencies = {
  "vision_bundle.mjs":
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs",
  "vision_wasm_internal.js":
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_internal.js",
  "vision_wasm_internal.wasm":
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_internal.wasm",
  "face_landmarker.task":
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "delaunator.min.js":
    "https://cdn.jsdelivr.net/npm/delaunator@5.0.1/delaunator.min.js",
};
for (const [name, url] of Object.entries(dependencies)) {
  const target = path.join(vendor, name);
  if ((await stat(target).catch(() => null))?.size) continue;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok)
    throw Error(`Authoring dependency ${name}: ${response.status}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}
const ffmpeg = path.join(
  workspace,
  ".cache/teen-patti-media/package/ffmpeg.exe",
);
const referenceCrop = path.join(out, "reference.jpg");
execFileSync(ffmpeg, [
  "-v",
  "error",
  "-y",
  "-i",
  path.join(project, "src/assets/teenpatti/dealer-face-reference.png"),
  "-vf",
  "crop=270:310:710:40,scale=216:248",
  "-frames:v",
  "1",
  "-q:v",
  "3",
  referenceCrop,
]);
const routes = {
  "/original.mp4": [
    path.join(project, "src/assets/teenpatti/maya-alternating-turns.mp4"),
    "video/mp4",
  ],
  "/reference.jpg": [referenceCrop, "image/jpeg"],
  "/render.mjs": [
    path.join(project, "scripts/dealer-face-render.mjs"),
    "text/javascript",
  ],
  "/vendor/vision_bundle.mjs": [
    path.join(vendor, "vision_bundle.mjs"),
    "text/javascript",
  ],
  "/vendor/delaunator.min.js": [
    path.join(vendor, "delaunator.min.js"),
    "text/javascript",
  ],
  "/vendor/face_landmarker.task": [
    path.join(vendor, "face_landmarker.task"),
    "application/octet-stream",
  ],
  "/wasm/vision_wasm_internal.js": [
    path.join(vendor, "vision_wasm_internal.js"),
    "text/javascript",
  ],
  "/wasm/vision_wasm_internal.wasm": [
    path.join(vendor, "vision_wasm_internal.wasm"),
    "application/wasm",
  ],
};
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<script src="/vendor/delaunator.min.js"></script><script type="module" src="/render.mjs"></script>',
      );
      return;
    }
    const asset = routes[req.url];
    if (!asset) {
      res.writeHead(404);
      res.end();
      return;
    }
    const bytes = await readFile(asset[0]);
    res.setHeader("Content-Type", asset[1]);
    res.setHeader("Accept-Ranges", "bytes");
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
    if (range) {
      const start = Number(range[1]),
        end = range[2] ? Number(range[2]) : bytes.length - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
        "Content-Length": end - start + 1,
      });
      res.end(bytes.subarray(start, end + 1));
    } else {
      res.setHeader("Content-Length", bytes.length);
      res.end(bytes);
    }
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
let browser, encoder;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "log") console.log(msg.text());
  });
  page.on("pageerror", (error) => console.error(error));
  page.on("requestfailed", (request) =>
    console.error("Asset failed", request.url(), request.failure()?.errorText),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      console.error("Asset HTTP", response.status(), response.url());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.faceReady, {}, { timeout: 120000 });
  const registration = await page.evaluate(() => window.scan());
  await writeFile(
    path.join(out, "face-tracks.json"),
    JSON.stringify(registration),
  );
  const samples = [
    0, 36, 52, 64, 76, 90, 120, 144, 168, 204, 240, 276, 312, 348,
  ];
  const render = process.argv[2] === "render";
  const patches = path.join(out, "patches");
  await mkdir(patches, { recursive: true });
  for (const i of render ? Array.from({ length: 361 }, (_, i) => i) : samples) {
    const result = await page.evaluate(
      ({ i, full }) => window.renderFrame(i, full),
      { i, full: samples.includes(i) },
    );
    if (result.full)
      await writeFile(
        path.join(out, `frame-${i}.png`),
        Buffer.from(result.full, "base64"),
      );
    if (render)
      await writeFile(
        path.join(patches, `face-${String(i).padStart(3, "0")}.png`),
        Buffer.from(result.patch, "base64"),
      );
    if (i % 24 === 0) console.log("Rendered", i);
  }
  await browser.close();
  browser = null;
  if (render) {
    encoder = spawn(
      ffmpeg,
      [
        "-v",
        "error",
        "-y",
        "-i",
        routes["/original.mp4"][0],
        "-framerate",
        "24",
        "-i",
        path.join(patches, "face-%03d.png"),
        "-filter_complex",
        "[0:v][1:v]overlay=375:20:shortest=1",
        "-frames:v",
        "361",
        "-an",
        "-c:v",
        "libx264",
        "-crf",
        "17",
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
        path.join(out, "naina-alternating-turns.mp4"),
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    const [code] = await once(encoder, "exit");
    if (code !== 0) throw Error(`FFmpeg exited ${code}`);
  }
  for (const [frame, name] of [
    [0, "naina-betting-poster.jpg"],
    [144, "naina-opening-poster.jpg"],
    [348, "naina-result.jpg"],
  ]) {
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-i",
      path.join(out, `frame-${frame}.png`),
      "-frames:v",
      "1",
      "-q:v",
      "2",
      path.join(out, name),
    ]);
  }
  console.log("Complete", out);
} finally {
  if (encoder && !encoder.killed && encoder.exitCode === null) encoder.kill();
  await browser?.close();
  server.close();
}
