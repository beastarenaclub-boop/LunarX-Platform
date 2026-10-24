import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

// Offline calibration only; no computer-vision dependency ships to players.
const root = path.resolve(import.meta.dirname, "../../..");
const dir = path.join(root, "tmp/teenpatti-joker/reference-match");
const anchors = process.argv.includes("--anchors");
const selected = process.argv
  .find((arg) => arg.startsWith("--part="))
  ?.split("=")[1];
const ffmpeg = path.join(
  root,
  "tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe",
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const result = [];
try {
  const page = await browser.newPage();
  for (const [id, time, until] of [
    ["01", 21, 43],
    ["02", 21, 66],
    ["03", 6, 86],
  ]) {
    if (selected && id !== selected) continue;
    const frame = anchors
      ? path.join(
          root,
          `artifacts/3d-game/src/assets/teenpatti-joker/reference-motion/anchor-${id}.png`,
        )
      : path.join(dir, `calibration-${id}.png`);
    if (!anchors)
      execFileSync(ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(time),
        "-i",
        path.join(dir, `edited-motion-${id}.mp4`),
        "-vf",
        "scale=960:540",
        "-frames:v",
        "1",
        frame,
      ]);
    const data = `data:image/png;base64,${(await readFile(frame)).toString("base64")}`;
    const components = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 540;
      const ctx = canvas.getContext("2d");
      window.detectPapers = (image) => {
        ctx.drawImage(image, 0, 0, 960, 540);
        const pixels = ctx.getImageData(0, 0, 960, 540).data;
        const mask = new Uint8Array(960 * 540);
        for (let y = 360; y < 515; y++)
          for (let x = 265; x < 690; x++) {
            const i = y * 960 + x,
              r = pixels[i * 4],
              g = pixels[i * 4 + 1],
              b = pixels[i * 4 + 2];
            mask[i] = b > 125 && g > 155 && r - g < 43 && g - b < 65 ? 1 : 0;
          }
        const found = [];
        for (let index = 0; index < mask.length; index++) {
          if (!mask[index]) continue;
          const pending = [index],
            points = [];
          mask[index] = 0;
          while (pending.length) {
            const n = pending.pop(),
              x = n % 960,
              y = Math.floor(n / 960);
            points.push([x, y]);
            for (const step of [-960, -1, 1, 960])
              if (mask[n + step]) {
                mask[n + step] = 0;
                pending.push(n + step);
              }
          }
          if (points.length < 210) continue;
          const xs = points.map((p) => p[0]),
            ys = points.map((p) => p[1]);
          const l = Math.min(...xs),
            r = Math.max(...xs),
            t = Math.min(...ys),
            b = Math.max(...ys);
          // The burn-card position at the left is not one of the seven hands.
          if ((l + r) / 2 < 290) continue;
          const fill = points.length / ((r - l + 1) * (b - t + 1));
          if (
            fill < 0.56 ||
            r - l < 24 ||
            b - t < 15 ||
            r - l > 80 ||
            b - t > 65
          )
            continue;
          const corner = (score, direction = 1) =>
            points.reduce((a, p) =>
              score(p) * direction < score(a) * direction ? p : a,
            );
          const quad = [
            corner((p) => p[0] + p[1]),
            corner((p) => p[1] - p[0]),
            corner((p) => p[0] + p[1], -1),
            corner((p) => p[1] - p[0], -1),
          ];
          found.push({
            center: [(l + r) / 2, (t + b) / 2],
            area: points.length,
            fill,
            quad: quad.map(([x, y]) => [x / 960, y / 540]),
          });
        }
        return found.sort((a, b) => a.center[0] - b.center[0]);
      };
      return window.detectPapers(image);
    }, data);
    if (!anchors && components.length < 7) {
      // Some edits erase previously dealt papers. The approved anchor retains
      // their photographed geometry; use it only for missing, separated slots.
      const anchorCalibration = JSON.parse(await readFile(path.join(dir, "paper-calibration-anchors.json"), "utf8"));
      for (const paper of anchorCalibration.find((scene) => scene.id === id)?.components ?? []) {
        if (components.every((other) => Math.hypot(
          other.center[0] - paper.center[0], other.center[1] - paper.center[1],
        ) > 28)) components.push(paper);
      }
      components.sort((a, b) => a.center[0] - b.center[0]);
    }
    result.push({ id, until, components });
    if (!anchors && process.argv.includes("--track")) {
      if (components.length !== 7)
        throw new Error(
          `Expected 7 reference papers, found ${components.length} in ${id}`,
        );
      const videoData = `data:video/mp4;base64,${(await readFile(path.join(dir, `edited-motion-${id}.mp4`))).toString("base64")}`;
      const tracks = await page.evaluate(
        async ({ src, base, start }) => {
          const video = document.createElement("video");
          video.muted = true;
          video.src = src;
          await new Promise((resolve, reject) => {
            video.onloadeddata = resolve;
            video.onerror = reject;
          });
          const previous = structuredClone(base),
            frames = [];
          const order = [3, 0, 6, 1, 5, 2, 4];
          for (let t = 0; t < video.duration; t += 1 / 6) {
            await new Promise((resolve) => {
              video.onseeked = resolve;
              video.currentTime = Math.min(t + 0.001, video.duration - 0.01);
            });
            const candidates = window.detectPapers(video);
            previous.forEach((paper, i) => {
              const nearby = candidates
                .filter(
                  (c) =>
                    c.area > base[i].area * 0.85 &&
                    c.area < base[i].area * 1.25,
                )
                .sort(
                  (a, b) =>
                    Math.hypot(
                      a.center[0] - paper.center[0],
                      a.center[1] - paper.center[1],
                    ) -
                    Math.hypot(
                      b.center[0] - paper.center[0],
                      b.center[1] - paper.center[1],
                    ),
                );
              const candidate = nearby[0];
              if (
                candidate &&
                Math.hypot(
                  candidate.center[0] - paper.center[0],
                  candidate.center[1] - paper.center[1],
                ) < 24
              )
                previous[i] = candidate;
            });
            frames.push({
              until: Number((start + t + 1 / 6).toFixed(4)),
              quads: order.map((i) =>
                previous[i].quad.map((p) => p.map((n) => Number(n.toFixed(5)))),
              ),
            });
          }
          video.removeAttribute("src");
          video.load();
          return frames;
        },
        {
          src: videoData,
          base: components,
          start: until - (id === "03" ? 20 : 23),
        },
      );
      await writeFile(
        path.join(dir, `paper-tracks-${id}.json`),
        JSON.stringify(tracks),
      );
      console.log(`Tracked ${id}: ${tracks.length} frames`);
    }
  }
  await writeFile(
    path.join(
      dir,
      anchors ? "paper-calibration-anchors.json" : "paper-calibration.json",
    ),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
