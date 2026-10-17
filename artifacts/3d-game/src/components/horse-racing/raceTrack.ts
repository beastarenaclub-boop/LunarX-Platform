import {
  RACING_HORSES,
  horseProgress,
  seededRandom,
  type HorsePlan,
} from "@workspace/api-zod/horse-racing-game";
import type { HorseAssetPack } from "./horseAssets";
import {
  WORLD_METRES,
  TRACK_HALF_WIDTH,
  type RaceProjection,
} from "./raceCamera";

type Material = { dirt: CanvasPattern; grass: CanvasPattern };
export type TrackMaterials = Map<string, Material>;
const WIDTH = 1280,
  HEIGHT = 720,
  TEXELS_PER_METRE = 64;
const laneZ = (lane: number) => (lane - 3.5) * 2.7;
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

function materials(
  ctx: CanvasRenderingContext2D,
  photo: HTMLImageElement,
  key: string,
  cache: TrackMaterials,
): Material {
  const cached = cache.get(key);
  if (cached) return cached;
  // Mirror a small photographic soil patch to remove repeating tile seams.
  const tile = document.createElement("canvas");
  tile.width = tile.height = 512;
  const tc = tile.getContext("2d")!;
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 2; col++) {
      tc.save();
      tc.translate(col ? 512 : 0, row ? 512 : 0);
      tc.scale(col ? -1 : 1, row ? -1 : 1);
      tc.drawImage(
        photo,
        photo.width * 0.16,
        photo.height * 0.63,
        photo.width * 0.66,
        photo.height * 0.3,
        0,
        0,
        256,
        256,
      );
      tc.restore();
    }
  const grass = document.createElement("canvas");
  grass.width = grass.height = 256;
  const gc = grass.getContext("2d")!,
    random = seededRandom("racecourse-grass");
  gc.fillStyle = key === "dubai" ? "#566635" : "#3c642e";
  gc.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9500; i++) {
    const x = random() * 256,
      y = random() * 256;
    gc.strokeStyle = ["#8b9b51", "#668642", "#2d4c26", "#476931", "#b4ad642b"][
      Math.floor(random() * 5)
    ];
    gc.lineWidth = 0.5 + random();
    gc.beginPath();
    gc.moveTo(x, y);
    gc.lineTo(x + random() * 3 - 1.5, y - 2 - random() * 5);
    gc.stroke();
  }
  const result = {
    dirt: ctx.createPattern(tile, "repeat")!,
    grass: ctx.createPattern(grass, "repeat")!,
  };
  cache.set(key, result);
  return result;
}

function polygon(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  fill: string,
) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
}
function segment(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  color: string,
  width: number,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
function board(
  ctx: CanvasRenderingContext2D,
  p: RaceProjection,
  x: number,
  z: number,
  label: string,
) {
  const top = p.point(x, z, 1.9),
    bottom = p.point(x, z, 0),
    s = clamp(p.scale * top.k, 10, 26);
  if (top.x < -80 || top.x > WIDTH + 80) return;
  segment(ctx, bottom, top, "#bcc6b1", 2.5);
  ctx.fillStyle = "#0f3329";
  ctx.beginPath();
  ctx.roundRect(top.x - s * 1.6, top.y - s * 0.48, s * 3.2, s * 0.96, 3);
  ctx.fill();
  ctx.strokeStyle = "#d5c99a";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = "bold " + Math.max(10, s * 0.57) + "px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff5cd";
  ctx.fillText(label, top.x, top.y + s * 0.2);
  ctx.textAlign = "left";
}

function rail(ctx: CanvasRenderingContext2D, p: RaceProjection, z: number) {
  const left = p.focus - p.span * 1.1,
    right = p.focus + p.span * 1.1,
    k = p.factor(z),
    size = clamp(p.scale * k * 0.12, 1.7, 4.5);
  // Rail supports cast soft shadows onto the ground.
  for (let x = Math.floor(left / 6) * 6; x < right; x += 6) {
    const foot = p.point(x, z),
      top = p.point(x, z, 1.3),
      shadow = p.point(x + 1.2, z + 0.8);
    segment(ctx, foot, shadow, "#26311720", size * 2);
    segment(
      ctx,
      { x: foot.x + 2, y: foot.y },
      { x: top.x + 2, y: top.y },
      "#68715d",
      size + 1,
    );
    segment(ctx, foot, top, "#ebecdd", size);
  }
  for (const y of [0.64, 1.22]) {
    const a = p.point(left, z, y),
      b = p.point(right, z, y);
    segment(
      ctx,
      { x: a.x, y: a.y + 2 },
      { x: b.x, y: b.y + 2 },
      "#626c555c",
      size + 3,
    );
    segment(ctx, a, b, "#f3f0dd", size + 1);
    segment(
      ctx,
      { x: a.x, y: a.y - 1 },
      { x: b.x, y: b.y - 1 },
      "#ffffffc2",
      Math.max(1, size * 0.35),
    );
  }
}

function drawGround(
  ctx: CanvasRenderingContext2D,
  p: RaceProjection,
  photo: HTMLImageElement,
  venueId: string,
  cache: TrackMaterials,
) {
  const m = materials(ctx, photo, venueId, cache),
    farZ = -TRACK_HALF_WIDTH - 3,
    farY = p.point(p.focus, farZ).y;
  // Preserve the photographic skyline, with camera-dependent framing.
  const photoHeight = Math.max(HEIGHT, farY / 0.39),
    photoWidth = (photoHeight * photo.width) / photo.height;
  const parallax =
    Math.sin(p.focus * 0.0015) * Math.max(0, photoWidth - WIDTH) * 0.12;
  ctx.drawImage(
    photo,
    (WIDTH - photoWidth) * 0.5 + parallax,
    farY - photoHeight * 0.395,
    photoWidth,
    photoHeight,
  );
  // Scanline projection maps fine soil and grass into the same perspective as the horses.
  // Each strip samples continuous world coordinates, so the surface cannot slide under a stationary hoof.
  for (let y = Math.max(0, Math.floor(farY)); y < HEIGHT; y += 3) {
    const z = p.groundAt(y + 1.5),
      nextZ = p.groundAt(y + 4.5),
      k = p.factor(z);
    const isDirt = Math.abs(z) < TRACK_HALF_WIDTH;
    const pattern = isDirt ? m.dirt : m.grass;
    const sx = (p.scale * k) / TEXELS_PER_METRE,
      sy = 3 / Math.max(0.0001, (nextZ - z) * TEXELS_PER_METRE);
    const tx = WIDTH * 0.5 - p.focus * p.scale * k,
      ty = y - z * TEXELS_PER_METRE * sy;
    pattern.setTransform(new DOMMatrix([sx, 0, 0, sy, tx, ty]));
    ctx.fillStyle = pattern;
    ctx.fillRect(0, y, WIDTH, 3.5);
  }
  const left = p.focus - p.span,
    right = p.focus + p.span;
  // Grooming runs along the course, not across the direction of travel.
  for (let z = -TRACK_HALF_WIDTH; z <= TRACK_HALF_WIDTH; z += 0.27) {
    const a = p.point(left, z),
      b = p.point(right, z);
    segment(
      ctx,
      a,
      b,
      "#47371f12",
      Math.max(0.3, p.scale * p.factor(z) * 0.013),
    );
  }
  // A damp racing line and freshly groomed outside edges break up flat colour.
  for (const [z, width] of [
    [-TRACK_HALF_WIDTH + 0.24, 0.35],
    [TRACK_HALF_WIDTH - 0.24, 0.35],
  ]) {
    polygon(
      ctx,
      [
        p.point(left, z - width),
        p.point(right, z - width),
        p.point(right, z + width),
        p.point(left, z + width),
      ],
      "#f2ddad24",
    );
  }
  const shade = ctx.createLinearGradient(0, farY, 0, HEIGHT);
  shade.addColorStop(0, "#a1ac8333");
  shade.addColorStop(0.2, "#ffe9c407");
  shade.addColorStop(1, "#141b0c28");
  ctx.fillStyle = shade;
  ctx.fillRect(0, farY, WIDTH, HEIGHT - farY);
  // Closely mown infield stripes sit beyond the near running rail.
  const nearY = p.point(p.focus, TRACK_HALF_WIDTH + 0.2).y;
  if (nearY < HEIGHT) {
    for (let x = Math.floor(left / 9) * 9; x < right; x += 18) {
      const bottom = p.groundAt(HEIGHT + 5);
      polygon(
        ctx,
        [
          p.point(x, TRACK_HALF_WIDTH + 0.2),
          p.point(x + 9, TRACK_HALF_WIDTH + 0.2),
          p.point(x + 9, bottom),
          p.point(x, bottom),
        ],
        "#cfdf8c0b",
      );
    }
  }
}

function hoofprints(
  ctx: CanvasRenderingContext2D,
  p: RaceProjection,
  plan: HorsePlan,
  elapsed: number,
  distance: number,
) {
  if (elapsed < 0) return;
  for (const horse of plan.runners) {
    for (let step = 1; step <= 13; step++) {
      // Fixed time samples leave imprints attached to the track while the camera follows.
      const stamped = Math.floor(elapsed / 0.24) * 0.24 - step * 0.24;
      if (stamped < 0) continue;
      const x = horseProgress(horse, stamped) * distance - 1.6,
        z = laneZ(horse.lane) + (step % 2 ? 0.3 : -0.3),
        a = p.point(x, z);
      if (a.x < -10 || a.x > WIDTH + 10) continue;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.scale(p.scale * a.k, p.scale * a.k * p.sin);
      ctx.fillStyle = "#3c2c1e28";
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.16, 0.1, -0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f4d4a225";
      ctx.lineWidth = 0.035;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function finishLine(
  ctx: CanvasRenderingContext2D,
  p: RaceProjection,
  distance: number,
) {
  const centre = p.point(distance, 0);
  if (centre.x < -WIDTH * 0.5 || centre.x > WIDTH * 1.5) return;
  for (let row = 0; row < 32; row++)
    for (let col = 0; col < 2; col++) {
      const x = distance + col * 0.22,
        z = -TRACK_HALF_WIDTH + row * ((TRACK_HALF_WIDTH * 2) / 32),
        length = (TRACK_HALF_WIDTH * 2) / 32;
      polygon(
        ctx,
        [
          p.point(x, z),
          p.point(x + 0.22, z),
          p.point(x + 0.22, z + length),
          p.point(x, z + length),
        ],
        (row + col) % 2 ? "#ffffe5e8" : "#132b27dc",
      );
    }
  const far = p.point(distance, -TRACK_HALF_WIDTH, 0),
    top = p.point(distance, -TRACK_HALF_WIDTH, 5);
  segment(ctx, far, top, "#edf2e8", 5);
  ctx.fillStyle = "#19392b";
  ctx.fillRect(top.x - 50, top.y - 26, 100, 30);
  ctx.strokeStyle = "#e1c279";
  ctx.lineWidth = 1;
  ctx.strokeRect(top.x - 50, top.y - 26, 100, 30);
  ctx.font = "bold 14px Arial";
  ctx.fillStyle = "#fff2c7";
  ctx.textAlign = "center";
  ctx.fillText("FINISH", top.x, top.y - 6);
  ctx.textAlign = "left";
}

function gates(
  ctx: CanvasRenderingContext2D,
  p: RaceProjection,
  plan: HorsePlan,
  elapsed: number,
  front: boolean,
) {
  if (p.point(0, 0).x < -250) return;
  const open = clamp(elapsed * 2.2, 0, 1);
  const roofHeight = 8;
  for (const h of [...plan.runners].sort((a, b) => a.lane - b.lane)) {
    const z = laneZ(h.lane),
      k = p.factor(z),
      size = clamp(p.scale * k * 0.095, 1.5, 3);
    if (!front) {
      for (const side of [-1.15, 1.15]) {
        segment(
          ctx,
          p.point(-6.4, z + side),
          p.point(-6.4, z + side, roofHeight),
          "#b8c1ac",
          size,
        );
        segment(
          ctx,
          p.point(-6.4, z + side, roofHeight),
          p.point(0.12, z + side, roofHeight),
          "#426650",
          size * 2,
        );
      }
      const roof = [
        p.point(-6.4, z - 1.15, roofHeight),
        p.point(0.12, z - 1.15, roofHeight),
        p.point(0.12, z + 1.15, roofHeight),
        p.point(-6.4, z + 1.15, roofHeight),
      ];
      polygon(ctx, roof, "#2e543fed");
    } else {
      for (const side of [-1.15, 1.15]) {
        segment(
          ctx,
          p.point(0.12, z + side),
          p.point(0.12, z + side, roofHeight),
          "#dbe0c9",
          size,
        );
      }
      if (open < 1)
        for (const side of [-1, 1]) {
          const xx = 0.12 + Math.sin((open * Math.PI) / 2) * 1.15,
            zz = z + side * (1.15 - Math.cos((open * Math.PI) / 2) * 1.15);
          segment(
            ctx,
            p.point(0.12, z + side * 1.15, 0.7),
            p.point(xx, zz, 0.7),
            "#cfd8c6",
            size,
          );
          segment(
            ctx,
            p.point(0.12, z + side * 1.15, 1.6),
            p.point(xx, zz, 1.6),
            "#cfd8c6",
            size,
          );
        }
    }
  }
}

export interface TrackFrame {
  plan: HorsePlan;
  elapsed: number;
  distance: number;
  venueId: string;
  selected: number[];
  running: boolean;
  focusHorse: number;
}
export function paintRaceTrack(
  ctx: CanvasRenderingContext2D,
  pack: HorseAssetPack,
  p: RaceProjection,
  cache: TrackMaterials,
  frame: TrackFrame,
) {
  const { plan, elapsed, venueId, selected, running } = frame,
    distance = frame.distance * WORLD_METRES;
  drawGround(ctx, p, pack.tracks[venueId], venueId, cache);
  hoofprints(ctx, p, plan, elapsed, distance);
  finishLine(ctx, p, distance);
  rail(ctx, p, -TRACK_HALF_WIDTH);
  for (let remaining = 200; remaining < frame.distance; remaining += 200) {
    board(
      ctx,
      p,
      distance - remaining * WORLD_METRES,
      -TRACK_HALF_WIDTH - 1.2,
      remaining + "m",
    );
  }
  ctx.save();
  ctx.globalAlpha = 1 - p.follow;
  gates(ctx, p, plan, elapsed, false);
  ctx.restore();
  const runnerBounds: number[][] = [];
  for (const h of [...plan.runners].sort((a, b) => a.lane - b.lane)) {
    const z = laneZ(h.lane),
      worldX = horseProgress(h, elapsed) * distance,
      nose = p.point(worldX, z),
      scale = p.scale * nose.k;
    const character = pack.horses[h.id - 1],
      atlas = character.atlas,
      standing = elapsed < 0;
    const index =
      elapsed >= 0
        ? Math.floor(
            (Math.max(0, elapsed) * atlas.fps * h.stride +
              h.phase * atlas.count) %
              atlas.count,
          )
        : 0;
    const source = standing ? character.idle : atlas;
    const horseWidth = 4.25 * scale,
      horseHeight = (horseWidth * source.height) / source.width;
    const x =
        nose.x -
        horseWidth *
          (standing ? character.idle.nose : atlas.noseAnchors[index]),
      y = nose.y - horseHeight * source.ground;
    runnerBounds.push([h.id, x, y, horseWidth, horseHeight]);
    // The runner camera isolates its subject so foreground runners cannot obscure it.
    // All eight retain their real race positions and remain visible in the field cameras.
    const visibility = h.id === frame.focusHorse ? 1 : 1 - p.follow;
    if (visibility < 0.01) continue;
    ctx.save();
    ctx.globalAlpha = visibility;
    const body = p.point(worldX - 1.45, z);
    // Soft ground contact plus the longer shadow cast by the venue light.
    ctx.save();
    ctx.translate(body.x, body.y + 1);
    ctx.scale(scale, scale * p.sin);
    const shadow = ctx.createRadialGradient(-0.2, 0.1, 0.15, -0.2, 0.1, 2.5);
    shadow.addColorStop(0, "#1e231044");
    shadow.addColorStop(0.62, "#1e231025");
    shadow.addColorStop(1, "#1e231000");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(-0.2, 0.1, 1.55, 0.45, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (running)
      for (let j = 0; j < 9; j++) {
        const age = (elapsed * 1.5 + j * 0.193 + h.phase) % 1,
          dust = p.point(
            worldX - 4.2 - age * 3,
            z + ((j % 3) - 1) * 0.2,
            0.04 + age * 0.25,
          );
        const radius = (0.05 + age * 0.24) * scale;
        ctx.fillStyle = "rgba(188,157,111," + (1 - age) * 0.13 + ")";
        ctx.beginPath();
        ctx.ellipse(dust.x, dust.y, radius * 1.6, radius, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    const sx = standing ? 0 : (index % atlas.columns) * atlas.width,
      sy = standing ? 0 : Math.floor(index / atlas.columns) * atlas.height;
    ctx.save();
    ctx.drawImage(
      standing ? character.still : character.motion,
      sx,
      sy,
      source.width,
      source.height,
      x,
      y,
      horseWidth,
      horseHeight,
    );
    ctx.restore();
    const labelX = x + horseWidth * 0.49,
      labelY = y - 8,
      labelSize = clamp(horseWidth * 0.07, 12, 19);
    ctx.fillStyle = RACING_HORSES[h.id - 1].color;
    ctx.beginPath();
    ctx.roundRect(
      labelX - labelSize * 0.5,
      labelY - labelSize * 0.5,
      labelSize,
      labelSize,
      3,
    );
    ctx.fill();
    if (selected.includes(h.id)) {
      ctx.strokeStyle = "#ffe5a0";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.fillStyle = [2, 4, 7].includes(h.id) ? "#16241b" : "#fff";
    ctx.font = "bold " + labelSize * 0.76 + "px Arial";
    ctx.textAlign = "center";
    ctx.fillText(String(h.id), labelX, labelY + labelSize * 0.28);
    ctx.textAlign = "left";
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = 1 - p.follow;
  gates(ctx, p, plan, elapsed, true);
  ctx.restore();
  rail(ctx, p, TRACK_HALF_WIDTH);
  if (venueId === "dubai") {
    ctx.fillStyle = "#d2962910";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  if (venueId === "night") {
    ctx.fillStyle = "#10254d14";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  const vignette = ctx.createRadialGradient(
    WIDTH * 0.5,
    HEIGHT * 0.48,
    HEIGHT * 0.35,
    WIDTH * 0.5,
    HEIGHT * 0.48,
    WIDTH * 0.67,
  );
  vignette.addColorStop(0, "#08130900");
  vignette.addColorStop(1, "#06120938");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return runnerBounds;
}
