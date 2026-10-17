import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import {
  RACING_HORSES,
  makeHorsePlan,
  horseOrder,
  type RacingLiveRound,
} from "@workspace/api-zod/horse-racing-game";
import { activeCamera, type RaceCameraMode } from "./raceCamera";
import { packCamera } from "./packCamera3d";
import { raceLens } from "./raceLens3d";
import { raceAtmosphere } from "./raceAtmosphere3d";
import {
  loadBroadcastHorses,
  broadcastHorse,
  RUNNER_HEIGHT,
} from "./broadcastHorse3d";
import { presentationHorse } from "./racePresentation";
import { hoofSpray3d } from "./hoofSpray3d";
import { buildWorld, disposeWorld, loadWorldTextures } from "./raceWorld3d";
import {
  displayedProgress,
  raceFinish,
  trackPoint,
  venue3d,
} from "./race3dMath";

export interface Race3dState {
  race: RacingLiveRound | null;
  venueId: string;
  serverOffset: number;
  selected: number[];
  camera: RaceCameraMode;
}
function numberTexture(id: number, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 120, 24);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.font = "bold 85px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(id), 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function contactTexture(color = "#10180b") {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const c = canvas.getContext("2d")!,
    gradient = c.createRadialGradient(32, 32, 3, 32, 32, 32);
  gradient.addColorStop(0, `${color}e0`);
  gradient.addColorStop(0.45, `${color}66`);
  gradient.addColorStop(1, `${color}00`);
  c.fillStyle = gradient;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
export async function createHorse3d(
  canvas: HTMLCanvasElement,
  getState: () => Race3dState,
  onFrame: (winner: number | null) => void,
) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  });
  const phone = window.matchMedia("(max-width: 767px)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, phone ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const atmosphere = raceAtmosphere();
  scene.add(atmosphere.mesh);
  let models: Awaited<ReturnType<typeof loadBroadcastHorses>>;
  let environment: THREE.DataTexture;
  try {
    [models, environment] = await Promise.all([
      loadBroadcastHorses(),
      new RGBELoader().loadAsync("/assets/horse-racing/realistic/daylight.hdr"),
      loadWorldTextures(),
    ]);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  environment.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = environment;
  scene.environmentIntensity = 0.65;
  const camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.12, 1400);
  const lens = raceLens(renderer, phone);
  renderer.info.autoReset = false;
  const hemisphere = new THREE.HemisphereLight("#e4f2ff", "#686447", 2.0);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight("#fff1d6", 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
  Object.assign(sun.shadow.camera, {
    left: -32,
    right: 32,
    top: 32,
    bottom: -32,
    near: 1,
    far: 150,
  });
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight("#ccdeff", 0.24);
  fill.position.set(-40, 25, 50);
  scene.add(fill);
  const contact = contactTexture();
  const horses = RACING_HORSES.map((h) => {
    const root = new THREE.Group();
    const character = broadcastHorse(models, h.color, h.coat, h.id);
    scene.add(root, character.mesh);
    const marker = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: numberTexture(h.id, h.color),
        depthTest: true,
      }),
    );
    marker.scale.set(0.4, 0.4, 1);
    marker.position.set(0, RUNNER_HEIGHT + 0.25, 0);
    root.add(marker);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 3.1),
      new THREE.MeshBasicMaterial({
        map: contact,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.035;
    root.add(shadow);
    return {
      id: h.id,
      root,
      character,
      marker,
    };
  });
  const spray = hoofSpray3d(phone);
  scene.add(spray.root);
  let world: THREE.Group | null = null,
    venueId = "",
    frame = 0,
    disposed = false,
    previous = performance.now(),
    lastStats = 0;
  let frameCount = 0;
  let qualitySampleStart = 0,
    qualityFrames = 0,
    slowSamples = 0;
  let frameMs = 16.7;
  const maxPixelRatio = Math.min(window.devicePixelRatio, phone ? 1.25 : 1.5);
  let renderScale = 1;
  let shot = "",
    reportedWinner: number | null = null,
    roundId = "";
  let idlePlan = makeHorsePlan("paddock", getState().venueId);
  const desired = new THREE.Vector3(),
    target = new THREE.Vector3(),
    look = new THREE.Vector3(),
    previousTarget = new THREE.Vector3();
  const framePack = packCamera();
  const gates = new THREE.Group();
  scene.add(gates);
  const doors: THREE.Group[] = [];
  const gateMaterial = new THREE.MeshStandardMaterial({
    color: "#e3e6d5",
    metalness: 0.35,
    roughness: 0.6,
  });
  const gateBox = (
    parent: THREE.Group,
    position: [number, number, number],
    size: [number, number, number],
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), gateMaterial);
    mesh.position.set(...position);
    mesh.castShadow = true;
    parent.add(mesh);
  };
  for (let i = 0; i < 9; i++) {
    const z = -33.925 - i * 2.15;
    gateBox(gates, [-5.4, 2, z], [0.09, 4, 0.09]);
    gateBox(gates, [-0.1, 2, z], [0.09, 4, 0.09]);
    gateBox(gates, [-2.7, 4, z], [5.4, 0.12, 0.12]);
    if (i < 8) {
      const door = new THREE.Group();
      door.position.set(-0.05, 0, z);
      gates.add(door);
      doors.push(door);
      for (const y of [1, 2, 3])
        gateBox(door, [0, y, -1.02], [0.09, 0.09, 2.04]);
      gateBox(door, [0, 2, -2.04], [0.09, 2, 0.09]);
    }
  }
  const resize = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  });
  resize.observe(canvas);
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  function draw(time: number) {
    if (disposed) return;
    frame = requestAnimationFrame(draw);
    if (document.hidden) {
      previous = time;
      qualitySampleStart = time;
      qualityFrames = 0;
      return;
    }
    // Use every display refresh. A strict 16.667 ms threshold used to discard
    // valid 16.6 ms callbacks, producing alternating 30/60 fps judder.
    frameCount++;
    const interval = time - previous;
    if (interval > 0 && interval < 150) frameMs += (interval - frameMs) * 0.05;
    // A suspended tab, debugger pause or initial shader compile is not sustained
    // GPU load. Do not permanently blur the race after one long clock gap.
    if (interval > 2000) {
      qualitySampleStart = time;
      qualityFrames = 0;
      slowSamples = 0;
    }
    if (!qualitySampleStart) qualitySampleStart = time;
    qualityFrames++;
    if (time - qualitySampleStart > 2000) {
      const fps = (qualityFrames * 1000) / (time - qualitySampleStart);
      slowSamples = fps < 48 ? slowSamples + 1 : 0;
      // Sustained load reduces pixel shading, never animation frequency. Keep
      // headroom/hysteresis so a shader compile or camera cut cannot oscillate.
      if (slowSamples >= 2 && renderScale > 0.7) {
        renderScale = Math.max(0.7, renderScale - 0.15);
        renderer.setPixelRatio(maxPixelRatio * renderScale);
        slowSamples = 0;
      }
      qualityFrames = 0;
      qualitySampleStart = time;
    }
    const dt = Math.min(0.08, Math.max(0.001, (time - previous) / 1000));
    previous = time;
    const state = getState(),
      venue = venue3d(state.venueId);
    if (venueId !== venue.id) {
      if (world) {
        scene.remove(world);
        disposeWorld(world);
      }
      world = buildWorld(venue, phone);
      spray.configure(world.userData.trackSurface === "turf");
      scene.add(world);
      // Scenery is static; wind/audience use shader uniforms. Only the runners
      // need a moving shadow map over the track, not the whole seating bowl.
      world.updateMatrixWorld(true);
      world.traverse((object) => {
        object.matrixAutoUpdate = false;
        object.matrixWorldAutoUpdate = false;
        if (object instanceof THREE.Mesh) object.castShadow = false;
      });
      venueId = venue.id;
      idlePlan = makeHorsePlan("paddock", venue.id);
      const horizon = atmosphere.configure(venue);
      scene.background = horizon.clone();
      scene.environmentIntensity = venue.id === "night" ? 0.26 : 0.58;
      scene.fog = new THREE.Fog(horizon, venue.id === "dubai" ? 100 : 200, 900);
      const night = venue.id === "night";
      hemisphere.intensity = night ? 0.5 : 1.15;
      hemisphere.color.set(night ? "#91aaff" : "#c7e0f2");
      hemisphere.groundColor.set(night ? "#262d35" : "#5c6241");
      sun.color.set(
        night ? "#dce7ff" : venue.id === "dubai" ? "#ffd9a0" : "#fff1d6",
      );
      sun.intensity = night ? 2.2 : 3.1;
      renderer.toneMappingExposure = night ? 1.1 : 1.08;
      shot = "";
    }
    const race = state.race?.venueId === venue.id ? state.race : null;
    if (world) world.userData.wind.value = reducedMotion ? 0 : time / 1000;
    const plan = race?.plan ?? idlePlan;
    const elapsed = race?.plan
      ? (Date.now() + state.serverOffset - race.startedAt) / 1000
      : -1;
    const finish = raceFinish(race?.plan, elapsed),
      winner = finish?.id ?? null;
    const key = race?.id ?? "idle";
    if (roundId !== key) {
      roundId = key;
      shot = "";
    }
    if (winner !== reportedWinner) {
      reportedWinner = winner;
      onFrame(winner);
    }
    const order = horseOrder(plan, Math.max(0, elapsed));
    const featured =
      state.camera === "auto"
        ? presentationHorse(race, Date.now() + state.serverOffset)
        : null;
    const mode = winner
      ? "winner"
      : featured
        ? "parade"
        : activeCamera(state.camera, Math.max(0, elapsed));
    const focus = winner ?? featured ?? order[0];
    const positions = plan.runners.map((h) =>
      displayedProgress(plan, h.id, elapsed),
    );
    // The gate spacing fans into a tighter field over the opening strides.
    // Longitudinal progress and exact finish times still come from the server.
    const pack = THREE.MathUtils.smoothstep(elapsed, 0.4, 3.4);
    const points = plan.runners.map((h) =>
      trackPoint(
        positions[h.id - 1] * venue.laps,
        h.lane * (1 - pack * 0.26) + pack * 0.35,
      ),
    );
    if (featured) points[featured - 1] = trackPoint(0.08, 3.2);
    for (const h of horses) {
      h.root.visible = !featured || h.id === featured;
      h.marker.visible = !featured && !winner && state.selected.includes(h.id);
      (h.marker.material as THREE.SpriteMaterial).color.set(
        winner === h.id || state.selected.includes(h.id)
          ? "#fff4b6"
          : "#ffffff",
      );
    }
    gates.visible = !featured && elapsed < 1.2;
    doors.forEach((d) => {
      d.rotation.y = -Math.max(0, Math.min(Math.PI / 2, elapsed * 6));
    });
    const fov = framePack(
      featured || winner ? [points[focus - 1]] : points,
      mode,
      camera.aspect,
      target,
      desired,
    );
    const shotKey = `${venue.id}:${mode}:${featured ?? "field"}`;
    // Move with the tracked subject before smoothing the viewing angle. A lerped
    // world position alone trails behind fast runners and crops them off screen.
    if (shot === shotKey) {
      camera.position.add(target).sub(previousTarget);
      look.add(target).sub(previousTarget);
    }
    if (shotKey !== shot || reducedMotion) {
      camera.position.copy(desired);
      look.copy(target);
      camera.fov = fov;
    } else {
      const blend = 1 - Math.exp(-dt * (mode === "winner" ? 12 : 7));
      camera.position.lerp(desired, blend);
      look.lerp(target, blend);
      camera.fov += (fov - camera.fov) * blend;
    }
    shot = shotKey;
    previousTarget.copy(target);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
    // A near finish support must not cover the featured horse's head/body.
    // Restore both supports immediately when returning to a field camera.
    for (const post of (world?.userData.finishPosts ?? []) as THREE.Mesh[]) {
      const along =
        (post.position.z - camera.position.z) / (target.z - camera.position.z);
      const crossingX =
        camera.position.x + (target.x - camera.position.x) * along;
      post.visible = !(
        (mode === "closeup" || mode === "winner" || mode === "parade") &&
        along > 0 &&
        along < 1 &&
        Math.abs(crossingX - post.position.x) < 4
      );
    }
    horses.forEach((horse, i) => {
      const { character, root } = horse;
      character.mesh.visible = root.visible;
      if (!character.mesh.visible) return;
      const runner = plan.runners[i];
      const after = Math.max(0, elapsed - runner.finishTime);
      const gaitTime =
        after > 0
          ? runner.finishTime +
            (1 - Math.exp(-after * 1.5)) * 0.55 +
            after * 0.3
          : elapsed;
      character.update(
        points[i],
        elapsed < 0 ? time / 1000 : gaitTime,
        elapsed >= 0,
        runner.phase,
        runner.stride,
      );
      character.setDetail(
        !phone &&
          (mode === "parade" || mode === "winner") &&
          horse.id === focus,
      );
      root.position.copy(character.groundCenter);
      root.rotation.y = character.mesh.rotation.y;
    });
    spray.update(
      time / 1000,
      horses.map((h) => ({
        id: h.id,
        root: h.character.mesh,
        hoofPositions: h.character.hoofPositions,
      })),
      camera,
      elapsed >= 0 && !winner,
      null,
    );
    sun.target.position.copy(target);
    sun.position.copy(target).add(atmosphere.sunOffset);
    sun.target.updateMatrixWorld();
    renderer.info.reset();
    atmosphere.mesh.position.copy(camera.position);
    lens.render(
      scene,
      camera,
      camera.position.distanceTo(look),
      mode === "parade" || mode === "winner",
      !phone && renderScale === 1,
    );
    if (time - lastStats > 120) {
      lastStats = time;
      const data = canvas.dataset;
      data.renderer = "webgl-3d";
      data.characterSet = "broadcast-thoroughbreds-v1";
      data.characterDetail = "animated-3d-horse-jockey";
      data.characterAsset = "thoroughbred-v2";
      data.characterPresentation = "skinned-3d";
      data.animationFrames = horses
        .map((horse) => horse.character.frame)
        .join(",");
      data.visualQuality = phone ? "cinematic-mobile" : "cinematic-desktop";
      data.graphicsRevision = "turf-broadcast-v1";
      data.horseOrientation = "track-tangent";
      data.packView = "8";
      data.frontAvailable = "true";
      data.horseHeight = String(RUNNER_HEIGHT);
      data.headingError = String(
        Math.max(
          ...horses
            .filter((h) => h.root.visible)
            .map((h) =>
              Math.abs(h.character.mesh.rotation.y - points[h.id - 1].heading),
            ),
        ),
      );
      data.frameCount = String(frameCount);
      data.frameTimeMs = frameMs.toFixed(1);
      data.renderScale = renderScale.toFixed(2);
      data.horseDetail = "skinned-lod";
      data.pixelRatio = renderer.getPixelRatio().toFixed(2);
      data.riderOutfits = String(horses.length);
      data.advertisingRevision = world?.userData.advertising?.revision;
      data.advertisingBoards = String(world?.userData.advertising?.boards ?? 0);
      data.advertisingGroundAds = String(
        world?.userData.advertising?.groundAds ?? 0,
      );
      data.advertisingSlots = String(world?.userData.advertising?.slots ?? 0);
      data.advertisingCampaigns = world?.userData.advertising?.activeCampaigns;
      data.advertisingImages = String(
        world?.userData.advertising?.loadedImages ?? 0,
      );
      data.advertisingStatus = world?.userData.advertising?.configStatus;
      data.stadiumRevision = world?.userData.stadium?.revision;
      data.spectatorCount = String(
        world?.userData.stadium?.spectatorCount ?? 0,
      );
      data.audienceSections = String(
        world?.userData.stadium?.audienceSections ?? 0,
      );
      data.trackSurface = world?.userData.trackSurface;
      data.trackDetail = world?.userData.trackDetail;
      data.raceId = race?.id ?? "paddock";
      data.venue = venue.id;
      data.elapsed = elapsed.toFixed(2);
      data.positions = positions.map((v) => v.toFixed(5)).join(",");
      data.order = order.join(",");
      data.camera = mode;
      data.cameraMode = state.camera;
      data.focusHorse = String(focus);
      data.winner = winner ? String(winner) : "";
      data.visibleRunners = horses
        .filter((h) => h.root.visible)
        .map((h) => h.id)
        .join(",");
      data.pose = elapsed < 0 ? "standing" : winner ? "winner" : "galloping";
      data.triangles = String(renderer.info.render.triangles);
      data.drawCalls = String(renderer.info.render.calls);
      data.cameraPosition = camera.position
        .toArray()
        .map((v) => v.toFixed(2))
        .join(",");
      data.elevation = (
        (Math.atan2(
          camera.position.y - look.y,
          Math.hypot(camera.position.x - look.x, camera.position.z - look.z),
        ) *
          180) /
        Math.PI
      ).toFixed(2);
      data.runnerBounds = JSON.stringify(
        horses
          .filter((h) => h.root.visible)
          .map((h) =>
            [h.id, ...h.character.screenBounds(camera)].map(Math.round),
          ),
      );
    }
  }
  frame = requestAnimationFrame(draw);
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    horses.forEach(({ character }) => {
      character.dispose();
    });
    disposeWorld(scene);
    contact.dispose();
    lens.dispose();
    environment.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
}
