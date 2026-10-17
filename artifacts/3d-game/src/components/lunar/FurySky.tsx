import { useEffect, useRef } from "react";
import { store } from "@/game/store";
import { furyMotion } from "./furyMotion";

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const wrap = (n: number, length: number) => ((n % length) + length) % length;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const colour = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(mix(v, b[i], t))).join(",")})`;

function random(seed: number) {
  return () => {
    seed = Math.imul(seed ^ seed >>> 15, 1 | seed);
    seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed);
    return ((seed ^ seed >>> 14) >>> 0) / 4294967296;
  };
}

// Small, reusable cloud volumes are painted once. No downloaded/replaced artwork,
// per-frame noise generation, WebGL requirement, or React animation state.
function cloudTexture(seed: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const rand = random(seed);
  const grid = Float32Array.from({ length: 4096 }, rand);
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const at = (dx: number, dy: number) => grid[((iy + dy) & 63) * 64 + ((ix + dx) & 63)];
    return mix(mix(at(0, 0), at(1, 0), fx), mix(at(0, 1), at(1, 1), fx), fy);
  };
  const lobes = Array.from({ length: 13 }, (_, i) => {
    const x = 60 + i * 22;
    const centre = Math.sin(i / 12 * Math.PI);
    return { x, y: 130 - centre * (28 + rand() * 32), rx: 27 + rand() * 30, ry: 17 + centre * (22 + rand() * 20) };
  });
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      let body = -Infinity;
      for (const lobe of lobes) {
        body = Math.max(body, 1 - ((x - lobe.x) / lobe.rx) ** 2 - ((y - lobe.y) / lobe.ry) ** 2);
      }
      if (body < -.4) continue;
      const detail = noise(x / 39, y / 39) * .53 + noise(x / 17, y / 17) * .27 + noise(x / 7, y / 7) * .14 + noise(x / 3, y / 3) * .06;
      const density = body + (detail - .48) * .9;
      const alpha = smooth(density * 3.8) * smooth((167 - y) / 29) * smooth(x / 16) * smooth((canvas.width - x) / 16);
      const light = clamp(.91 - smooth((y - 52) / 112) * .49 + (detail - .5) * .48 + (1 - clamp(body)) * .16);
      const p = (y * canvas.width + x) * 4;
      pixels.data[p] = mix(117, 255, light);
      pixels.data[p + 1] = mix(155, 255, light);
      pixels.data[p + 2] = mix(177, 249, light);
      pixels.data[p + 3] = alpha * 247;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

const cloudLayers = [
  { x: .07, y: .17, size: .19, speed: .009, depth: .17, alpha: .52 },
  { x: .63, y: .06, size: .14, speed: .012, depth: .23, alpha: .58 },
  { x: .97, y: .49, size: .22, speed: .016, depth: .29, alpha: .66 },
  { x: .25, y: .28, size: .29, speed: .025, depth: .44, alpha: .92 },
  { x: .8, y: .66, size: .26, speed: .034, depth: .54, alpha: .93 },
  { x: -.11, y: .55, size: .43, speed: .045, depth: .68, alpha: 1 },
  { x: .49, y: .91, size: .49, speed: .06, depth: .83, alpha: .88 },
];
const stars = Array.from({ length: 76 }, (_, i) => ({
  x: ((i * 37.73 + 11) % 100) / 100,
  y: ((i * 19.31 + 7) % 100) / 100,
  size: i % 5 === 0 ? 1.2 : .65,
  alpha: .25 + i % 4 * .14,
}));

/** A live, layered sky following only public flight time. The original sky
 * image stays underneath as a fallback; plane and airfield artwork stay intact. */
export default function FurySky() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const textures = Array.from({ length: 5 }, (_, i) => cloudTexture(137 + i * 947));
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 1, height = 1, dpr = 1, frame = 0, last = 0, wind = 0;
    let previousRound = "", previousPhase = "", previousFlyMs = -1;
    let visible = true;

    function draw(now: number) {
      if (!canvas || !ctx) return;
      const state = store.getState();
      const parked = state.phase === "betting" || state.roundId === "connecting" || state.roundId === "init";
      const elapsed = parked ? 0 : Math.max(0, state.flyMs);
      const flight = furyMotion(elapsed);
      const night = parked ? 0 : smooth((state.multiplier - 2.1) / 4);
      const reset = previousRound !== state.roundId || (parked && previousPhase !== "betting") || elapsed < previousFlyMs;
      if (reset) wind = 0;
      const delta = last ? Math.min((now - last) / 1000, .06) : 0;
      if (!media.matches && state.phase !== "crashed") wind += delta * (parked ? .12 : .35 + flight.travel * .65);
      previousRound = state.roundId;
      previousPhase = parked ? "betting" : state.phase;
      previousFlyMs = elapsed;
      last = now;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      // At takeoff the airfield supplies the background. As it moves down,
      // atmospheric blue fills the exposed sky without a hard cut.
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, colour([42, 115, 158], [5, 32, 51], night));
      gradient.addColorStop(.55, colour([83, 153, 188], [18, 67, 96], night));
      gradient.addColorStop(1, colour([166, 202, 214], [48, 104, 133], night));
      ctx.globalAlpha = 1 - flight.groundOpacity;
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;

      const sunX = width * (.82 - flight.climb * .32);
      const sunY = height * (.26 + flight.climb * .92);
      const radius = Math.min(width, height) * .041;
      ctx.globalAlpha = (1 - night) * (1 - smooth((flight.climb - .68) / .32));
      const glow = ctx.createRadialGradient(sunX, sunY, radius * .2, sunX, sunY, radius * 7);
      glow.addColorStop(0, "#fffdeaee");
      glow.addColorStop(.16, "#fff8ced9");
      glow.addColorStop(.35, "#ffeab35c");
      glow.addColorStop(1, "#fff0c000");
      ctx.fillStyle = glow;
      ctx.fillRect(sunX - radius * 7, sunY - radius * 7, radius * 14, radius * 14);
      ctx.fillStyle = "#ffffee";
      ctx.beginPath();
      ctx.arc(sunX, sunY, radius * .72, 0, Math.PI * 2);
      ctx.fill();

      // Star visibility follows the gradual blue-hour transition, never a
      // hidden outcome or a random event that could suggest a future result.
      for (const star of stars) {
        const twinkle = media.matches ? 1 : .8 + Math.sin(wind * .7 + star.x * 80) * .2;
        ctx.globalAlpha = night * star.alpha * twinkle * (1 - star.y * .5);
        ctx.fillStyle = "#e7f4ff";
        ctx.beginPath();
        ctx.arc(star.x * width, wrap(star.y + flight.climb * .07, 1) * height, star.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // A constant wind direction and different speeds give actual parallax.
      // An entire cloud crosses the edge before wrapping back offscreen.
      cloudLayers.forEach((cloud, i) => {
        const cloudWidth = Math.max(130, Math.min(630, width * cloud.size));
        const cloudHeight = cloudWidth / 2;
        const span = width + cloudWidth * 2;
        const x = wrap(cloud.x * width - wind * cloud.speed * width - flight.travel * cloud.depth * width * .24 + cloudWidth, span) - cloudWidth;
        const y = wrap(cloud.y * height + flight.climb * cloud.depth * height * .64, height + cloudHeight) - cloudHeight * .35;
        ctx.globalAlpha = cloud.alpha * (1 - night * .27) * (1 - flight.groundOpacity);
        ctx.drawImage(textures[i % textures.length], x, y, cloudWidth, cloudHeight);
      });

      // Fine drifting sand and warm ground haze are separate from the runway
      // photograph and settle away as the plane climbs.
      if (flight.groundOpacity > 0) {
        const haze = ctx.createLinearGradient(0, height * .71, 0, height);
        haze.addColorStop(0, "#f3ce9200");
        haze.addColorStop(.5, "#efd0a323");
        haze.addColorStop(1, "#dfad7312");
        ctx.globalAlpha = flight.groundOpacity;
        ctx.fillStyle = haze;
        ctx.fillRect(0, height * .71, width, height * .29);
        ctx.fillStyle = "#f5d8a9";
        for (let i = 0; i < 26; i++) {
          const x = wrap(i * .173 * width - wind * (12 + i % 4 * 9), width);
          const y = height * (.79 + i % 6 * .031) + Math.sin(wind + i) * 3;
          ctx.globalAlpha = flight.groundOpacity * (.12 + i % 3 * .07);
          ctx.fillRect(x, y, i % 3 === 0 ? 2 : 1, 1);
        }
      }
      ctx.globalAlpha = 1;
      canvas.dataset.ready = "true";
    }

    function tick(now: number) {
      frame = 0;
      if (!visible || document.hidden || media.matches) return;
      const interval = store.getState().settings.quality === "low" ? 50 : 1000 / 30;
      if (now - last >= interval) draw(now);
      frame = requestAnimationFrame(tick);
    }
    function resume() {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      if (!visible || document.hidden) return;
      draw(performance.now());
      if (!media.matches) frame = requestAnimationFrame(tick);
    }
    const resize = new ResizeObserver(([entry]) => {
      width = Math.max(1, entry.contentRect.width);
      height = Math.max(1, entry.contentRect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      resume();
    });
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume(); });
    resize.observe(canvas);
    intersection.observe(canvas);
    media.addEventListener("change", resume);
    document.addEventListener("visibilitychange", resume);
    const unsubscribe = store.subscribe(() => {
      // Reduced motion still updates the current phase/lighting, with no drift.
      if (media.matches && visible && !document.hidden) draw(performance.now());
    });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      unsubscribe();
      media.removeEventListener("change", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return <canvas ref={ref} className="fury-live-sky" data-testid="fury-live-sky" aria-hidden="true" />;
}
