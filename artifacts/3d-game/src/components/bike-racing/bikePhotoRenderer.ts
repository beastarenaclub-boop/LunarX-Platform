import { RACING_BIKES, bikeProgress } from "@workspace/api-zod/bike-racing-game";
import type { BikeSceneState } from "./BikeRaceScene";
import { activeCamera } from "./raceCamera";
import { BIKE_PHOTO, CIRCUIT_PHOTO } from "./photoAssets";

// Photographic sprites only: this scene never creates a WebGL context or model.
function loadPhoto(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const photo = new Image();
    const timeout = window.setTimeout(() => reject(new Error("Race photo timed out")), 12_000);
    photo.onload = () => { clearTimeout(timeout); resolve(photo); };
    photo.onerror = () => { clearTimeout(timeout); reject(new Error("Race photo unavailable")); };
    photo.src = url;
  });
}

export async function createBikePhotoRace(canvas: HTMLCanvasElement, state: () => BikeSceneState) {
  const [bike, circuit] = await Promise.all([loadPhoto(BIKE_PHOTO), loadPhoto(CIRCUIT_PHOTO)]);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas unavailable");
  const ctx = context;
  let width = 1, height = 1, frame = 0, stopped = false, lastPaint = -Infinity;
  const resize = () => {
    const box = canvas.getBoundingClientRect();
    width = Math.max(1, box.width); height = Math.max(1, box.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  const bikeAspect = bike.naturalWidth / bike.naturalHeight;

  function background(seconds: number) {
    const tile = Math.max(width, height * 1.8), travel = Math.max(0, seconds) * 65;
    const offset = travel % (tile * 2);
    ctx.fillStyle = "#72797f"; ctx.fillRect(0, 0, width, height);
    // Mirrored adjoining photographs join without a hard edge while the camera tracks left.
    for (let i = -2; i <= 2; i++) {
      const x = i * tile + offset;
      if (x > width || x + tile < 0) continue;
      ctx.save(); ctx.translate(x, 0);
      if (Math.abs(i % 2) === 1) { ctx.translate(tile, 0); ctx.scale(-1, 1); }
      ctx.drawImage(circuit, 0, 0, tile, height); ctx.restore();
    }
    const shade = ctx.createLinearGradient(0, height * .72, 0, height);
    shade.addColorStop(0, "#07122100"); shade.addColorStop(1, "#07122185");
    ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height);
  }

  function drawBike(id: number, frontX: number, bottom: number, size: number, selected: boolean, seconds: number, hero = false) {
    const spec = RACING_BIKES[id - 1], h = size / bikeAspect;
    // The photo's front contact patch anchors the runner to its race distance.
    const left = frontX - size * .285, top = bottom - h * .98;
    ctx.save();
    ctx.fillStyle = "#07101948";
    ctx.beginPath(); ctx.ellipse(frontX + size * .25, bottom - h * .025, size * .39, h * .065, -.07, 0, Math.PI * 2); ctx.fill();
    if (selected) {
      ctx.strokeStyle = spec.color; ctx.lineWidth = hero ? 2 : 1.5;
      ctx.beginPath(); ctx.ellipse(frontX + size * .22, bottom - h * .02, size * .41, h * .067, -.07, 0, Math.PI * 2); ctx.stroke();
    }
    const vibration = seconds > 0 ? Math.sin(seconds * 45 + id) * .45 : 0;
    ctx.drawImage(bike, left, top + vibration, size, h);
    const labelSize = Math.max(17, Math.min(hero ? 28 : 23, h * .16));
    const labelX = left + size * .39, labelY = top + h * .04;
    ctx.fillStyle = spec.color;
    ctx.beginPath(); ctx.roundRect(labelX - labelSize / 2, labelY - labelSize / 2, labelSize, labelSize, 5); ctx.fill();
    ctx.strokeStyle = "#ffffffdd"; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.fillStyle = "#071522"; ctx.font = `900 ${labelSize * .65}px Arial`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(id), labelX, labelY + .5);
    ctx.restore();
    return left >= 0 && left + size <= width && top >= 0 && bottom <= height;
  }

  function finishLine(x: number) {
    if (x < -50 || x > width + 50) return;
    const top = height * .4, bottom = height * .96, stripe = Math.max(5, width * .008);
    ctx.save(); ctx.globalAlpha = .8;
    const count = 20, cell = (bottom - top) / count;
    for (let row = 0; row < count; row++) for (let column = 0; column < 2; column++) {
      ctx.fillStyle = (row + column) % 2 ? "#f4f5ee" : "#17232d";
      ctx.fillRect(x + column * stripe, top + row * cell, stripe + .5, cell + .5);
    }
    ctx.restore();
  }

  function draw(time = 0) {
    if (stopped) return;
    // Limit expensive photographic resampling on phones and software canvases.
    if (document.hidden || time - lastPaint < 1000 / 30) {
      frame = requestAnimationFrame(draw); return;
    }
    lastPaint = time;
    const current = state(), race = current.race;
    const elapsed = race ? (Date.now() + current.serverOffset - race.startedAt) / 1000 : -1;
    const plan = race?.plan, racing = !!plan && elapsed >= 0 && elapsed < 20;
    const finished = !!plan && elapsed >= 20;
    const camera = activeCamera(current.camera, elapsed);
    const progress = RACING_BIKES.map(b => plan ? bikeProgress(plan.runners.find(r => r.id === b.id)!, Math.max(0, elapsed)) : 0);
    const order = RACING_BIKES.map(b => b.id).sort((a, b) => progress[b - 1] - progress[a - 1]);
    const hero = finished || camera === "closeup";
    const focus = finished ? plan!.order[0] : current.focusBike;
    const seconds = racing ? elapsed : finished ? 20 : 0;
    background(seconds);
    let visible = false;
    if (hero) {
      // Keep the exact supplied angle; these are crop/track views, never fake 3D rotations.
      const size = Math.min(width * .63, height * .77 * bikeAspect);
      const front = width * .49 - size * .215;
      visible = drawBike(focus, front, height * .87, size, current.selected.includes(focus), racing ? elapsed : 0, true);
      canvas.dataset.focusBike = String(focus);
    } else {
      const isWide = camera === "grandstand", isLeaders = camera === "headon", isTrackside = camera === "rail";
      const ids = isLeaders && racing ? order.slice(0, 3) : RACING_BIKES.map(b => b.id);
      const distances = progress.map((p, index) => p * 1700 - Math.floor(index / 2) * 27 * Math.pow(Math.max(0, 1 - p), 3));
      const lead = Math.max(...ids.map(id => distances[id - 1]));
      const last = Math.min(...ids.map(id => distances[id - 1]));
      const scale = width * (isWide ? .63 : .61) / Math.max(54, lead - last);
      const leaderX = width * (isWide ? .12 : .14);
      const line = leaderX + (lead - 1700) * scale;
      if (plan && elapsed >= 0) finishLine(line);
      const positions = ids.map(id => {
        const far = id % 2 === 0;
        const bottom = height * (far ? .64 : .91) - ((id - 1) % 3) * height * .012;
        const h = height * (far ? .43 : .56) * (isWide ? .83 : isTrackside ? 1.06 : 1);
        const size = Math.min(width * (isLeaders ? .32 : .27), h * bikeAspect);
        // Far row is offset in the grid but converges to the same finish coordinate at p=1.
        const stagger = far ? width * .07 * Math.max(0, 1 - progress[id - 1]) : 0;
        return { id, bottom, size, x: leaderX + (lead - distances[id - 1]) * scale + stagger };
      }).sort((a, b) => a.bottom - b.bottom);
      for (const p of positions) {
        const inFrame = drawBike(p.id, p.x, p.bottom, p.size, current.selected.includes(p.id), racing ? elapsed : 0);
        if (p.id === (racing ? order[0] : current.focusBike)) visible = inFrame;
      }
      canvas.dataset.focusBike = String(racing ? order[0] : current.focusBike);
    }
    canvas.dataset.finishOrder = plan && elapsed >= 0 ? plan.runners.filter(r => elapsed >= r.finishTime).sort((a, b) => a.finishTime - b.finishTime).map(r => r.id).join(",") : "";
    canvas.dataset.focusVisible = String(visible);
    canvas.dataset.presentation = "photographic";
    canvas.dataset.camera = camera;
    frame = requestAnimationFrame(draw);
  }
  draw();
  return () => { stopped = true; cancelAnimationFrame(frame); observer.disconnect(); };
}
