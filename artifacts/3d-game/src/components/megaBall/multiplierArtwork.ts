import * as T from "three";

const GOLD: readonly [number, string][] = [
  [0, "#fff4c3"],
  [0.23, "#d7ad54"],
  [0.42, "#fff1b3"],
  [0.52, "#b17b29"],
  [0.73, "#ebcb76"],
  [1, "#8b6026"],
];
function metal(ctx: CanvasRenderingContext2D, top: number, bottom: number) {
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  GOLD.forEach(([at, color]) => gradient.addColorStop(at, color));
  return gradient;
}
function random(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function texture(canvas: HTMLCanvasElement) {
  const value = new T.CanvasTexture(canvas);
  value.colorSpace = T.SRGBColorSpace;
  value.anisotropy = 4;
  return value;
}

/** Exact server values stay crisp; the bevel and foil are visual artwork only. */
export function multiplierTileArtwork(value: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 320;
  const ctx = canvas.getContext("2d")!;
  const palette =
    value >= 100
      ? ["#9c281e", "#4f080d", "#d47443"]
      : value === 50
        ? ["#a77a25", "#4d300c", "#e1bb61"]
        : value === 25
          ? ["#9d2c6f", "#480d36", "#d471ae"]
          : value === 15 || value === 20
            ? ["#65396d", "#28102e", "#a36fa1"]
            : value === 5
              ? ["#176551", "#062e2c", "#75a88d"]
              : ["#087e79", "#034641", "#42bba2"];
  const enamel = ctx.createLinearGradient(0, 0, 0, 320);
  enamel.addColorStop(0, palette[2]);
  enamel.addColorStop(0.12, palette[0]);
  enamel.addColorStop(0.55, palette[1]);
  enamel.addColorStop(1, palette[0]);
  ctx.fillStyle = enamel;
  ctx.fillRect(0, 0, 768, 320);
  const noise = random(value * 1741 + 79);
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = i % 3 ? "rgba(0,10,5,.16)" : "rgba(246,228,170,.18)";
    ctx.fillRect(
      noise() * 768,
      noise() * 320,
      0.7 + noise() * 1.5,
      0.7 + noise() * 1.5,
    );
  }
  ctx.strokeStyle = metal(ctx, 10, 310);
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.roundRect(12, 12, 744, 296, 16);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(29, 29, 710, 262, 10);
  ctx.stroke();
  ctx.globalAlpha = 0.38;
  for (const side of [-1, 1]) {
    const cx = 384 + side * 302;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, 160);
      ctx.lineTo(cx - side * (40 + Math.abs(i) * 9), 160 + i * 24);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  const text = `${value}x`;
  ctx.font = `900 ${value >= 100 ? 193 : 217}px Georgia`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,.8)";
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 10;
  ctx.strokeStyle = "#35210a";
  ctx.lineWidth = 14;
  ctx.strokeText(text, 383, 168, 590);
  ctx.shadowColor = "transparent";
  for (let depth = 8; depth >= 1; depth--) {
    ctx.fillStyle = depth > 4 ? "#56350e" : "#9d702c";
    ctx.fillText(text, 383 + depth * 0.45, 164 + depth, 590);
  }
  ctx.strokeStyle = "#fff0b0";
  ctx.lineWidth = 2;
  ctx.strokeText(text, 383, 164, 590);
  ctx.fillStyle = metal(ctx, 60, 260);
  ctx.fillText(text, 383, 164, 590);
  const shine = ctx.createLinearGradient(0, 0, 768, 320);
  shine.addColorStop(0, "rgba(255,250,224,.12)");
  shine.addColorStop(0.3, "rgba(255,250,224,0)");
  shine.addColorStop(1, "rgba(0,0,0,.13)");
  ctx.fillStyle = shine;
  ctx.fillRect(0, 0, 768, 320);
  return texture(canvas);
}

/** A hammered gold inlay divided into two leaves; the medallion is separate. */
export function multiplierDoorArtwork() {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 2048;
  const ctx = canvas.getContext("2d")!;
  const finish = ctx.createLinearGradient(0, 0, 768, 0);
  finish.addColorStop(0, "#182b13");
  finish.addColorStop(0.28, "#655d24");
  finish.addColorStop(0.58, "#3b4219");
  finish.addColorStop(1, "#102719");
  ctx.fillStyle = finish;
  ctx.fillRect(0, 0, 768, 2048);
  const noise = random(9317);
  for (let i = 0; i < 90000; i++) {
    const x = noise() * 768,
      y = noise() * 2048,
      size = 0.6 + noise() * 2.7;
    const light = noise();
    ctx.fillStyle =
      light > 0.9
        ? "rgba(255,242,170,.85)"
        : light > 0.52
          ? "rgba(191,167,69,.65)"
          : "rgba(3,21,10,.7)";
    ctx.fillRect(x, y, size, size);
  }
  ctx.strokeStyle = metal(ctx, 0, 2048);
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.roundRect(15, 15, 738, 2018, 72);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(39, 39, 690, 1970, 53);
  ctx.stroke();
  ctx.fillStyle = "rgba(7,18,7,.45)";
  ctx.fillRect(382, 0, 4, 2048);
  return texture(canvas);
}

/** The logo is mounted on the right leaf and travels intact with it. */
export function multiplierLogoArtwork() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 768;
  const ctx = canvas.getContext("2d")!;
  const center = 384,
    radius = 366;
  ctx.fillStyle = metal(ctx, 0, 768);
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();
  const inset = ctx.createRadialGradient(290, 260, 30, 384, 384, radius);
  inset.addColorStop(0, "#11533b");
  inset.addColorStop(0.7, "#063626");
  inset.addColorStop(1, "#021d15");
  ctx.fillStyle = inset;
  ctx.beginPath();
  ctx.arc(center, center, radius - 19, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#a88e49";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(center, center, radius - 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 167px Georgia";
  for (const [word, y] of [
    ["MEGA", 298],
    ["BALL", 477],
  ] as const) {
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1c1607";
    ctx.lineWidth = 10;
    ctx.strokeText(word, 384, y + 8, 632);
    for (let depth = 9; depth > 0; depth--) {
      ctx.fillStyle = "#6e4d1c";
      ctx.fillText(word, 384 + depth * 0.4, y + depth, 632);
    }
    ctx.fillStyle = metal(ctx, y - 95, y + 90);
    ctx.fillText(word, 384, y, 632);
  }
  return texture(canvas);
}

export function multiplierGlassArtwork() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const edge = ctx.createLinearGradient(0, 0, 0, 512);
  edge.addColorStop(0, "rgba(0,7,6,.94)");
  edge.addColorStop(0.15, "rgba(0,7,6,.30)");
  edge.addColorStop(0.34, "rgba(0,7,6,0)");
  edge.addColorStop(0.66, "rgba(0,7,6,0)");
  edge.addColorStop(0.85, "rgba(0,7,6,.30)");
  edge.addColorStop(1, "rgba(0,7,6,.94)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, 128, 512);
  const glint = ctx.createLinearGradient(0, 0, 128, 0);
  glint.addColorStop(0, "rgba(255,249,218,.13)");
  glint.addColorStop(0.09, "rgba(255,249,218,0)");
  glint.addColorStop(0.77, "rgba(255,249,218,0)");
  glint.addColorStop(0.85, "rgba(255,249,218,.12)");
  glint.addColorStop(0.96, "rgba(255,249,218,0)");
  ctx.fillStyle = glint;
  ctx.fillRect(0, 0, 128, 512);
  return texture(canvas);
}
