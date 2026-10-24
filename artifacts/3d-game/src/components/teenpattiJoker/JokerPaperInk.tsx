import { useEffect, useRef, type RefObject } from "react";
import type { JokerOutcome } from "@workspace/api-zod/teenpatti-joker";
import { CardFace } from "@/components/teenpattiLive/TableCardArt";
import { JOKER_REFERENCE_FILM } from "./jokerReferenceFilm";

type Point = readonly [number, number];
type Quad = readonly [Point, Point, Point, Point];
export type PaperCalibration = readonly {
  until: number;
  // Joker, A1, B1, A2, B2, A3, B3, in normalized film coordinates.
  quads: readonly Quad[];
}[];

const W = 960,
  H = 540;
const triangle = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: readonly Point[],
  target: readonly Point[],
) => {
  const [a, b, c] = source,
    [p, q, r] = target;
  const bx = b[0] - a[0],
    by = b[1] - a[1];
  const cx = c[0] - a[0],
    cy = c[1] - a[1];
  const det = bx * cy - cx * by;
  const xx = ((q[0] - p[0]) * cy - (r[0] - p[0]) * by) / det;
  const xy = ((r[0] - p[0]) * bx - (q[0] - p[0]) * cx) / det;
  const yx = ((q[1] - p[1]) * cy - (r[1] - p[1]) * by) / det;
  const yy = ((r[1] - p[1]) * bx - (q[1] - p[1]) * cx) / det;
  ctx.save();
  ctx.beginPath();
  target.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  ctx.transform(
    xx,
    yx,
    xy,
    yy,
    p[0] - xx * a[0] - xy * a[1],
    p[1] - yx * a[0] - yy * a[1],
  );
  ctx.drawImage(image, 0, 0, 66, 94);
  ctx.restore();
};

function print(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  quad: Quad,
) {
  const [a, b, c, d] = quad.map(([x, y]) => [x * W, y * H]);
  const dx1 = b[0] - c[0],
    dx2 = d[0] - c[0];
  const dy1 = b[1] - c[1],
    dy2 = d[1] - c[1];
  const dx3 = a[0] - b[0] + c[0] - d[0],
    dy3 = a[1] - b[1] + c[1] - d[1];
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det,
    h = (dx1 * dy3 - dx3 * dy1) / det;
  const project = ([x, y]: Point): Point => {
    const u = 0.06 + (x / 66) * 0.88,
      v = 0.07 + (y / 94) * 0.86,
      w = g * u + h * v + 1;
    return [
      ((b[0] - a[0] + g * b[0]) * u + (d[0] - a[0] + h * d[0]) * v + a[0]) / w,
      ((b[1] - a[1] + g * b[1]) * u + (d[1] - a[1] + h * d[1]) * v + a[1]) / w,
    ];
  };
  for (let row = 0; row < 4; row++) {
    const y = row * 23.5,
      end = y + 23.5;
    for (const points of [
      [
        [0, y],
        [66, y],
        [66, end],
      ],
      [
        [0, y],
        [66, end],
        [0, end],
      ],
    ] as Point[][])
      triangle(ctx, image, points, points.map(project));
  }
}

/** Prints server card ink onto filmed paper. Repairs occasional erased paper
 * using the scene's sampled ivory; the color matte keeps hands above it. */
export default function JokerPaperInk({
  video,
  outcome,
  calibration,
}: {
  video: RefObject<HTMLVideoElement | null>;
  outcome?: JokerOutcome | null;
  calibration: PaperCalibration;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sources = useRef<HTMLDivElement>(null);
  const latest = useRef(outcome);
  latest.current = outcome;
  const textures = useRef(new Map<number, HTMLImageElement>());
  const values = outcome
    ? [
        outcome.joker,
        outcome.handACards[0],
        outcome.handBCards[0],
        outcome.handACards[1],
        outcome.handBCards[1],
        outcome.handACards[2],
        outcome.handBCards[2],
      ]
    : [];
  const key = values.join(",");
  useEffect(() => {
    let disposed = false;
    if (!key) canvas.current?.getContext("2d")?.clearRect(0, 0, W, H);
    for (const svg of sources.current?.querySelectorAll("svg") ?? []) {
      const value = Number(svg.dataset.card);
      if (textures.current.has(value)) continue;
      const img = new Image();
      img.onload = () => {
        if (!disposed) textures.current.set(value, img);
      };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    }
    return () => {
      disposed = true;
    };
  }, [key]);
  useEffect(() => {
    const player = video.current,
      surface = canvas.current;
    if (!player || !surface) return;
    const ctx = surface.getContext("2d", { willReadFrequently: true });
    const sample = document.createElement("canvas");
    sample.width = W;
    sample.height = H;
    const matte = sample.getContext("2d", { willReadFrequently: true });
    const coverage = document.createElement("canvas");
    coverage.width = W;
    coverage.height = H;
    const cover = coverage.getContext("2d", { willReadFrequently: true });
    if (!ctx || !matte || !cover) return;
    let frame = 0,
      stopped = false;
    const draw = (time: number) => {
      ctx.clearRect(0, 0, W, H);
      cover.clearRect(0, 0, W, H);
      const o = latest.current;
      if (time < 20 || player.readyState < 2) return;
      const papers = calibration.find((scene) => time < scene.until)?.quads;
      if (!papers) return;
      const cards = o
        ? [
            o.joker,
            o.handACards[0],
            o.handBCards[0],
            o.handACards[1],
            o.handBCards[1],
            o.handACards[2],
            o.handBCards[2],
          ]
        : [];
      matte.drawImage(player, 0, 0, W, H);
      const x = 270,
        y = 370,
        width = 410,
        height = 150;
      const pixels = matte.getImageData(x, y, width, height).data;
      // Preserve a gathered stack or the shoe crossing the former card slots.
      // Those larger connected paper regions are props moving in the footage,
      // not the small stationary pads left by the video edit.
      const movingProps = new Uint8Array(width * height);
      if (time >= 20 + JOKER_REFERENCE_FILM.cardClearings[0]) {
        const candidates = new Uint8Array(width * height);
        for (let p = 0; p < candidates.length; p++) {
          const at = p * 4;
          candidates[p] = pixels[at + 1] > 160 && pixels[at + 2] > 120 &&
            pixels[at] - pixels[at + 1] < 43 ? 1 : 0;
        }
        for (let p = 0; p < candidates.length; p++) {
          if (!candidates[p]) continue;
          const pending = [p], region: number[] = [];
          candidates[p] = 0;
          while (pending.length) {
            const point = pending.pop()!;
            region.push(point);
            for (const next of [point - width, point + width,
              point % width ? point - 1 : -1,
              point % width < width - 1 ? point + 1 : -1]) {
              if (next >= 0 && next < candidates.length && candidates[next]) {
                candidates[next] = 0;
                pending.push(next);
              }
            }
          }
          if (region.length > 1800)
            for (const point of region) movingProps[point] = 1;
        }
      }
      const paperColor = [0, 0, 0];
      let paperSamples = 0;
      for (const quad of papers) {
        const px = Math.round(quad.reduce((n, p) => n + p[0] * W, 0) / 4) - x;
        const py = Math.round(quad.reduce((n, p) => n + p[1] * H, 0) / 4) - y;
        const at = (py * width + px) * 4;
        if (
          px >= 0 &&
          px < width &&
          py >= 0 &&
          py < height &&
          pixels[at + 2] > 125 &&
          pixels[at + 1] > 155 &&
          pixels[at] - pixels[at + 1] < 43
        ) {
          paperColor.forEach((_, i) => (paperColor[i] += pixels[at + i]));
          paperSamples++;
        }
      }
      paperColor.forEach(
        (_, i) =>
          (paperColor[i] = paperSamples
            ? paperColor[i] / paperSamples
            : [224, 196, 154][i]),
      );
      let count = 0;
      papers.forEach((quad, i) => {
        const landing = 20 + JOKER_REFERENCE_FILM.cardLandings[i];
        const clearing = 20 + JOKER_REFERENCE_FILM.cardClearings[i];
        const texture = textures.current.get(cards[i]);
        if (time < landing - 0.55 || time >= clearing) {
          // The video edit sometimes colors an empty marked slot ivory. Restore
          // the surrounding felt through the same hand/paper matte.
          const centerX = quad.reduce((n, p) => n + p[0] * W, 0) / 4;
          const top = Math.min(...quad.map((p) => p[1] * H));
          let r = 0,
            g = 0,
            b = 0,
            samples = 0;
          for (let dy = -12; dy < -3; dy += 2)
            for (let dx = -25; dx <= 25; dx += 3) {
              const px = Math.round(centerX + dx) - x,
                py = Math.round(top + dy) - y;
              if (px < 0 || px >= width || py < 0 || py >= height) continue;
              const at = (py * width + px) * 4;
              const red = pixels[at],
                green = pixels[at + 1],
                blue = pixels[at + 2];
              if (blue > 50 && blue > green * 1.1 && green > red * 1.2) {
                r += red;
                g += green;
                b += blue;
                samples++;
              }
            }
          ctx.fillStyle = samples
            ? `rgb(${r / samples} ${g / samples} ${b / samples})`
            : "#193c60";
          const centerY = quad.reduce((n, p) => n + p[1] * H, 0) / 4;
          ctx.beginPath();
          quad.forEach(([u, v], index) => {
            const px = centerX + (u * W - centerX) * 1.09,
              py = centerY + (v * H - centerY) * 1.12;
            index ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          });
          ctx.closePath();
          ctx.fill();
          count++;
        } else if (texture && time >= landing) {
          cover.fillStyle = "white";
          cover.beginPath();
          quad.forEach(([u, v], index) =>
            index ? cover.lineTo(u * W, v * H) : cover.moveTo(u * W, v * H),
          );
          cover.closePath();
          cover.fill();
          print(ctx, texture, quad);
          count++;
        }
      });
      if (time >= 20 + Math.max(...JOKER_REFERENCE_FILM.cardClearings)) {
        // The collection edit leaves one extra pad between the A/B rows.
        // Continue the adjacent felt repair across that narrow gap.
        const left = Math.max(...papers[5].map((p) => p[0] * W));
        const right = Math.min(...papers[6].map((p) => p[0] * W));
        const top = Math.min(...papers[5].map((p) => p[1] * H)) - 4;
        const bottom = Math.max(...papers[6].map((p) => p[1] * H)) + 4;
        ctx.fillRect(left - 2, top, right - left + 4, bottom - top);
      }
      if (!count) return;
      const ink = ctx.getImageData(x, y, width, height);
      const faceAreas = cover.getImageData(x, y, width, height).data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (movingProps[i / 4]) {
          ink.data[i + 3] = 0;
          continue;
        }
        // Restore already-dealt paper if the video edit erases it to blue felt,
        // or leaves a purple reverse after the source hand turns it. Only the
        // tracked face area qualifies; skin and clothing still occlude it.
        if (
          faceAreas[i + 3] > 200 &&
          pixels[i + 2] > pixels[i + 1] * 1.15 &&
          (pixels[i] > pixels[i + 1] * 1.1 ||
            pixels[i + 1] > pixels[i] * 1.2)
        ) {
          const alpha = ink.data[i + 3] / 255;
          for (let channel = 0; channel < 3; channel++)
            ink.data[i + channel] =
              ink.data[i + channel] * alpha + paperColor[channel] * (1 - alpha);
          ink.data[i + 3] = 255;
          continue;
        }
        const opacity = Math.max(
          0,
          Math.min(
            1,
            (pixels[i + 1] - 150) / 25,
            (48 - pixels[i] + pixels[i + 1]) / 8,
          ),
        );
        ink.data[i + 3] *= opacity;
      }
      ctx.putImageData(ink, x, y);
    };
    const next: VideoFrameRequestCallback = (_, metadata) => {
      draw(metadata.mediaTime);
      if (!stopped) frame = player.requestVideoFrameCallback(next);
    };
    const seeked = () => draw(player.currentTime);
    if (player.requestVideoFrameCallback)
      frame = player.requestVideoFrameCallback(next);
    else player.addEventListener("timeupdate", seeked);
    player.addEventListener("seeked", seeked);
    return () => {
      stopped = true;
      if (frame) player.cancelVideoFrameCallback(frame);
      player.removeEventListener("seeked", seeked);
      player.removeEventListener("timeupdate", seeked);
    };
  }, [video, calibration]);
  return (
    <>
      <canvas
        ref={canvas}
        width={W}
        height={H}
        className="j20-paper-ink"
        aria-hidden="true"
      />
      <div ref={sources} hidden aria-hidden="true">
        {[...new Set(values)].map((value) => (
          <svg
            key={value}
            data-card={value}
            xmlns="http://www.w3.org/2000/svg"
            width="132"
            height="188"
            viewBox="0 0 66 94"
          >
            <CardFace value={value} inkOnly />
          </svg>
        ))}
      </div>
    </>
  );
}
