import * as T from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { RACING_BIKES, bikeProgress, bikeOrder } from "@workspace/api-zod/bike-racing-game";
import { loadRider, createBike } from "./bike";
import { createWorld, loadWorldAssets } from "./world";
import { sampleTrack, TRACK_LENGTH } from "./track";
import { activeCamera } from "./raceCamera";
import type { BikeSceneState } from "./BikeRaceScene";

let prepared: Promise<T.DataTexture> | undefined;
function prepare() {
  return prepared ??= Promise.all([loadRider(), loadWorldAssets(),
    new HDRLoader().loadAsync("/assets/bike-racing/environment/daylight.hdr")])
    .then(([, , texture]) => texture).catch(error => { prepared = undefined; throw error; });
}
function numberPlate(id: number, color: string) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(10, 10, 108, 108, 28); ctx.fill();
  ctx.font = "900 76px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#071323"; ctx.fillText(String(id), 64, 69);
  const texture = new T.CanvasTexture(c); texture.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.position.y = 2.35; sprite.scale.set(.8, .8, 1); return sprite;
}
export async function createBike3d(canvas: HTMLCanvasElement, latest: () => BikeSceneState, signal?: AbortSignal) {
  const daylight = await prepare();
  if (signal?.aborted) return () => {};
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.1 : 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  const scene = new T.Scene(); scene.fog = new T.Fog("#b2cbd3", 260, 1700);
  daylight.mapping = T.EquirectangularReflectionMapping; scene.background = daylight;
  scene.backgroundIntensity = .75; scene.backgroundBlurriness = .035;
  const pmrem = new T.PMREMGenerator(renderer), environment = pmrem.fromEquirectangular(daylight);
  scene.environment = environment.texture; scene.environmentIntensity = .65; pmrem.dispose();
  scene.add(new T.HemisphereLight("#cce6ff", "#5c6341", .65));
  const sun = new T.DirectionalLight("#fff2d7", 2.8); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 10, far: 300 });
  sun.shadow.bias = -.00025; sun.shadow.normalBias = .025; scene.add(sun, sun.target);
  const world = createWorld(scene);
  const bikes = RACING_BIKES.map(b => {
    const model = createBike(b.color, b.accent); scene.add(model.root);
    // Billboard numbers remain readable while the riders lean into the circuit.
    const label = numberPlate(b.id, b.color); scene.add(label);
    return { model, label, distance: 0 };
  });
  const camera = new T.PerspectiveCamera(48, 1, .08, 3500);
  const focus = new T.Vector3(), target = new T.Vector3(), desired = new T.Vector3();
  const previousSubject = new T.Vector3(), movement = new T.Vector3(), projected = new T.Vector3();
  const resize = () => {
    const rect = canvas.parentElement!.getBoundingClientRect();
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    camera.aspect = rect.width / Math.max(1, rect.height); camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas.parentElement!); resize();
  let frame = 0, previous = performance.now(), previousView = "", stopped = false;
  const render = (time: number) => {
    if (stopped) return;
    const dt = Math.min(.05, Math.max(.001, (time - previous) / 1000)); previous = time;
    const state = latest(), race = state.race;
    const elapsed = race ? (Date.now() + state.serverOffset - race.startedAt) / 1000 : -1;
    const plan = elapsed >= 0 ? race?.plan : null;
    const order = plan ? bikeOrder(plan, elapsed) : RACING_BIKES.map(b => b.id);
    const finished = !!plan && elapsed >= plan.runners[plan.order[0] - 1].finishTime;
    const selectedView = activeCamera(state.camera, Math.max(0, elapsed));
    const view = finished ? "winner" : !plan && selectedView === "broadcast" ? "grid" : selectedView;
    const focusId = finished ? (race?.winnerId ?? plan!.order[0]) : selectedView === "closeup" ? state.focusBike : order[0];
    const poses = bikes.map((b, i) => {
      const gridOffset = 8 + Math.floor(i / 2) * 2.3;
      const progress = plan ? bikeProgress(plan.runners[i], elapsed) : 0;
      // Preserve finishing gaps on the result shot. Clamping every runner to the
      // same progress would regroup them and put later grid slots ahead again.
      const runner = plan?.runners[i];
      const coastTime = runner ? Math.max(0, Math.min(elapsed, plan!.duration) - runner.finishTime) : 0;
      const distance = runner && elapsed >= runner.finishTime
        ? TRACK_LENGTH + 65 * coastTime
        : progress * (TRACK_LENGTH + gridOffset) - gridOffset;
      const speed = plan ? Math.max(0, (distance - b.distance) / dt) : 0;
      b.distance = distance;
      const p = sampleTrack(distance), lane = (i - 2.5) * 1.68;
      b.model.root.position.set(p.x + p.nx * lane, .043, p.z + p.nz * lane);
      const lean = plan ? T.MathUtils.clamp(-p.curvature * 52, -.48, .48) : -.035;
      b.model.root.rotation.set(0, Math.atan2(p.tx, p.tz), lean, "YXZ");
      b.model.body.position.y = plan && speed > 0 ? Math.sin(elapsed * 42 + i) * .007 : 0;
      for (const wheel of b.model.wheels) wheel.rotation.x += Math.min(100, speed) * dt / .365;
      b.label.position.copy(b.model.root.position); b.label.position.y = 2.45;
      b.label.scale.setScalar(state.selected.includes(i + 1) ? .95 : .72);
      return p;
    });
    const subject = bikes[focusId - 1], p = poses[focusId - 1];
    const pos = subject.model.root.position;
    const forward = new T.Vector3(p.tx, 0, p.tz), right = new T.Vector3(p.nx, 0, p.nz);
    target.copy(pos); target.y = 1.1; desired.copy(pos);
    const narrow = camera.aspect < 1.2;
    if (view === "grid") {
      // Six-bike starting grid: an oblique, low broadcast angle.
      const center = sampleTrack(-10); target.set(center.x, .8, center.z);
      desired.copy(target).addScaledVector(right, 13).addScaledVector(forward, 13); desired.y = 5;
      camera.fov = narrow ? 60 : 46;
    } else if (view === "winner" || view === "closeup") {
      desired.addScaledVector(right, 4.4).addScaledVector(forward, 4.3); desired.y = 1.95; camera.fov = 43;
    } else if (view === "headon") {
      desired.addScaledVector(forward, 24).addScaledVector(right, 1); desired.y = 2.2; camera.fov = 43;
    } else if (view === "rail") {
      desired.addScaledVector(right, 14).addScaledVector(forward, 7); desired.y = 2.2; camera.fov = 50;
    } else if (view === "grandstand") {
      desired.addScaledVector(right, 27).addScaledVector(forward, -15); desired.y = 34; camera.fov = 55;
      target.addScaledVector(forward, -12);
    } else {
      desired.addScaledVector(right, 15).addScaledVector(forward, -18); desired.y = 8.5; camera.fov = narrow ? 67 : 54;
      target.addScaledVector(forward, -5);
    }
    const cameraKey = `${race?.id}:${view}:${focusId}`;
    if (cameraKey !== previousView) { camera.position.copy(desired); focus.copy(target); previousView = cameraKey; }
    else {
      // Follow translation immediately; smooth only the camera's relative offset.
      // A world-space spring trails a fast bike by more than the close-up distance.
      movement.copy(pos).sub(previousSubject);
      camera.position.add(movement).lerp(desired, 1 - Math.exp(-dt * 10));
      focus.add(movement).lerp(target, 1 - Math.exp(-dt * 14));
    }
    previousSubject.copy(pos);
    camera.lookAt(focus); camera.updateProjectionMatrix();
    sun.position.set(pos.x - 90, 140, pos.z + 70); sun.target.position.set(pos.x, 0, pos.z);
    for (const light of world.lights.children) (light as T.Mesh<T.SphereGeometry, T.MeshStandardMaterial>).material.emissive.set(plan ? "#55ff45" : "#9e1515");
    if (!document.hidden) {
      renderer.render(scene, camera);
      projected.copy(pos); projected.y += 1; projected.project(camera);
      canvas.dataset.focusVisible = String(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && projected.z > -1 && projected.z < 1);
      canvas.dataset.focusBike = String(focusId);
      canvas.dataset.camera = view;
      canvas.dataset.elapsed = Math.max(0, elapsed).toFixed(2);
      canvas.dataset.order = order.join(",");
      canvas.dataset.distances = bikes.map(b => b.distance.toFixed(2)).join(",");
    }
    frame = requestAnimationFrame(render);
  };
  render(performance.now());
  return () => {
    stopped = true; cancelAnimationFrame(frame); observer.disconnect();
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>();
    scene.traverse(obj => {
      if (obj instanceof T.Mesh || obj instanceof T.Line) {
        geometries.add(obj.geometry);
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(m);
        if (obj instanceof T.Mesh && obj.customDepthMaterial) materials.add(obj.customDepthMaterial);
      }
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => {
      for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
      m.dispose();
    });
    textures.forEach(t => t.dispose());
    bikes.forEach(b => { b.label.material.map?.dispose(); b.label.material.dispose(); });
    sun.shadow.dispose(); environment.dispose(); renderer.dispose(); renderer.forceContextLoss();
  };
}
