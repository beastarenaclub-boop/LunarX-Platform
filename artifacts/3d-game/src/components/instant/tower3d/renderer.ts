import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { towerAssets, towerAssetUrl } from "../towerAssets";
import { createCollapse } from "./collapse";
import { TOWER_BREAK_SECONDS, TOWER_FLOOR_HEIGHT } from "../towerMotion";

export type TowerVisualState = { step: number; drop: { key: number; failed: boolean } | null; motion: boolean; lost: boolean };
type Options = { state: TowerVisualState; onReady: () => void; onFailure: () => void };
const HEIGHT = TOWER_FLOOR_HEIGHT;
const COLORS = ["#efdfc6", "#eddbce", "#91bdce", "#e2d6bf", "#f5ddb2", "#d9c2a1", "#e8e4d9", "#bd774f", "#a3c1ad", "#b0a3b8"];

/** GPU scene only. All odds, stakes and settlement remain in the existing API. */
export async function createTowerRenderer(canvas: HTMLCanvasElement, options: Options) {
  const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "default" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .96;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>();
  let disposed = false, frameId = 0, visible = true, state = options.state, ready = false;
  const scene = new T.Scene(); scene.fog = new T.Fog("#b6c6cb", 24, 65);
  const camera = new T.OrthographicCamera(-10, 10, 5.75, -5.75, .1, 100);
  const loader = new T.TextureLoader();
  const load = async (key: keyof typeof towerAssets, color = false) => {
    const texture = await loader.loadAsync(towerAssetUrl(key));
    if (disposed) { texture.dispose(); throw new Error("Renderer disposed"); }
    if (color) texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.add(texture); return texture;
  };
  const maps: Record<string, { map: T.Texture; normalMap: T.Texture; roughnessMap: T.Texture }> = {};
  let dustTexture: T.Texture;
  let facadeTextures: T.Texture[] = [];
  let streetTexture: T.Texture, phoneStreetTexture: T.Texture;
  let environment: T.WebGLRenderTarget | undefined;
  const ownGeometry = <G extends T.BufferGeometry>(geometry: G) => { geometries.add(geometry); return geometry; };
  const mat = (color: string, properties: T.MeshStandardMaterialParameters = {}) => {
    const material = new T.MeshStandardMaterial({ color, roughness: .8, ...properties }); materials.add(material); return material;
  };
  try {
    const materialLoads = (["wood", "brick", "stone", "metal"] as const).map(async kind => {
      const [map, normalMap, roughnessMap] = await Promise.all([load(`${kind}Color`, true), load(`${kind}Normal`), load(`${kind}Roughness`)]);
      maps[kind] = { map, normalMap, roughnessMap };
    });
    const [sky, dust, facades, , street, phoneStreet] = await Promise.all([load("environment", true), load("dust"), Promise.all(([0, 1, 2, 4] as const).map(i => load(`facade${i}`, true))).then(([ochre, clock, blue, shop]) => [ochre, clock, blue, ochre, shop, blue]), Promise.all(materialLoads), load("site", true), load("siteMobile", true)]);
    dustTexture = dust; facadeTextures = facades; streetTexture = street; phoneStreetTexture = phoneStreet;
    sky.mapping = T.EquirectangularReflectionMapping;
    const pmrem = new T.PMREMGenerator(renderer);
    environment = pmrem.fromEquirectangular(sky); scene.environment = environment.texture; scene.environmentIntensity = .55; pmrem.dispose();
  } catch (error) {
    disposed = true; textures.forEach(texture => texture.dispose()); environment?.dispose(); renderer.dispose(); throw error;
  }

  const trim = mat("#bfbcb2", { roughness: .78 });
  const dark = mat("#293d43", { metalness: .48, roughness: .4 });
  const brass = mat("#b19455", { metalness: .7, roughness: .35 });
  const glass = mat("#23323a", { metalness: .28, roughness: .12, envMapIntensity: 1.4 });
  const yellow = mat("#dda92d", { roughness: .55, metalness: .15 });

  // Merge static parts by material, reusing the resulting templates for every
  // stacked instance. No React state updates or geometry allocations per frame.
  class Batch {
    parts = new Map<T.Material, T.BufferGeometry[]>();
    add(geometry: T.BufferGeometry, material: T.Material, x = 0, y = 0, z = 0, rotation?: T.Euler) {
      if (rotation) geometry.applyMatrix4(new T.Matrix4().makeRotationFromEuler(rotation));
      geometry.translate(x, y, z);
      const prepared = geometry.index ? geometry.toNonIndexed() : geometry;
      if (prepared !== geometry) geometry.dispose();
      const bucket = this.parts.get(material) ?? []; bucket.push(prepared); this.parts.set(material, bucket);
    }
    box(w: number, h: number, d: number, x: number, y: number, z: number, material: T.Material) { this.add(new T.BoxGeometry(w, h, d), material, x, y, z); }
    finish() {
      const group = new T.Group();
      this.parts.forEach((parts, material) => {
        const geometry = ownGeometry(mergeGeometries(parts)); parts.forEach(part => part.dispose());
        const mesh = new T.Mesh(geometry, material); mesh.castShadow = material !== glass; mesh.receiveShadow = true; group.add(mesh);
      }); return group;
    }
  }
  const wallMaterials: T.Material[] = [], faceMaterials: T.Material[] = [];
  const templates = COLORS.map((color, kind) => {
    const batch = new Batch();
    const surface = kind === 0 || kind === 5 ? "wood" : kind === 1 ? "brick" : kind === 2 || kind === 7 ? "metal" : "stone";
    const wall = mat(color, { ...maps[surface], normalScale: new T.Vector2(.3, .3), roughness: kind === 2 ? .45 : .86 });
    wallMaterials.push(wall);
    batch.add(new RoundedBoxGeometry(2.35, 1.63, 1.8, 2, .045), wall);
    batch.box(2.5, .11, 1.95, 0, .845, 0, kind === 7 ? dark : trim);
    batch.box(2.47, .08, 1.92, 0, -.86, 0, trim);
    batch.box(2.25, .035, 1.65, 0, .92, 0, dark);
    // Recessed windows on the visible side add parallax and physical depth.
    for (const z of [-.48, .38]) {
      batch.box(.07, .79, .49, 1.19, .04, z, trim);
      batch.box(.025, .66, .36, 1.233, .04, z, glass);
      batch.box(.04, .66, .025, 1.25, .04, z, trim);
    }
    const facadeIndex = [0, 1, 2, 3, 4, 5, 3, 2, 2, 1][kind];
    const face = mat(kind === 7 ? "#c4c1b7" : kind === 8 ? "#c0d0c4" : "#ffffff", {
      map: facadeTextures[facadeIndex], roughness: .85,
      // Keep fine photographic surface detail readable under the daylight rig.
      emissiveMap: facadeTextures[facadeIndex], emissive: "#ffffff", emissiveIntensity: .09,
    });
    faceMaterials.push(face);
    batch.add(new T.PlaneGeometry(2.345, 1.625), face, 0, 0, .902);
    // A real projecting sill catches light and anchors the photographic skin.
    batch.box(2.4, .055, .14, 0, -.81, .94, trim);
    const model = batch.finish(); model.scale.set(.912, 1.6, 1.04); return model;
  });

  const rigBatch = new Batch();
  const ropeMaterial = mat("#444b4d", { metalness: .7, roughness: .5 });
  const rope = (a: T.Vector3, b: T.Vector3, radius = .016) => {
    const direction = b.clone().sub(a), geometry = new T.CylinderGeometry(radius, radius, direction.length(), 6);
    geometry.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize()));
    const middle = a.clone().add(b).multiplyScalar(.5); rigBatch.add(geometry, ropeMaterial, middle.x, middle.y, middle.z);
  };
  for (const x of [-1.05, 1.05]) for (const z of [-.65, .65]) rope(new T.Vector3(x, .92, z), new T.Vector3(0, 2.18, 0));
  rope(new T.Vector3(0, 2.5, 0), new T.Vector3(0, 14, 0), .019);
  rigBatch.box(.23, .38, .22, 0, 2.47, 0, yellow);
  rigBatch.add(new T.TorusGeometry(.115, .026, 7, 16, Math.PI * 1.5), brass, 0, 2.2, 0, new T.Euler(0, 0, .5));
  const rigTemplate = rigBatch.finish(); rigTemplate.scale.set(.912, .6, 1.04); rigTemplate.position.y = .92;
  const stack = new T.Group(), incoming = new T.Group(); scene.add(stack, incoming);
  let rig = rigTemplate.clone(), incomingModel = templates[0].clone(); incoming.add(incomingModel, rig);
  let stackStart = -1;
  const stackWindow = (wanted: number) => {
    const first = Math.max(0, Math.min(Math.max(0, state.step - 12), wanted));
    if (first === stackStart) return;
    stackStart = first;
    stack.clear();
    for (let n = first; n < Math.min(state.step, first + 12); n++) {
      const block = templates[n % 10].clone(); block.position.y = 1.44 + n * HEIGHT;
      block.rotation.y = Math.sin(n * 2.1) * .012; stack.add(block);
    }
  };
  const rebuild = () => {
    stackStart = -1; stackWindow(state.step - 12);
    incoming.clear(); incomingModel = templates[state.step % 10].clone(); rig = rigTemplate.clone(); incoming.add(incomingModel, rig);
    incoming.visible = !state.lost;
  }; rebuild();
  const collapse = createCollapse({ walls: wallMaterials, faces: faceMaterials, trim, dark, ownGeometry }); scene.add(collapse.group);

  scene.add(new T.HemisphereLight("#d9ecff", "#95806a", .95));
  const sun = new T.DirectionalLight("#fff7ed", 2.2); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12; sun.shadow.camera.near = 1; sun.shadow.camera.far = 45;
  sun.shadow.bias = -.00025; sun.shadow.normalBias = .035; scene.add(sun, sun.target);
  const fill = new T.DirectionalLight("#b6d6ee", .7); fill.position.set(7, 6, -5); scene.add(fill);
  // Reference-matched Runway scenery is one world-space plate. It descends
  // naturally as the camera climbs; it cannot cover the interactive tower.
  const skyFadeBytes = new Uint8Array(32 * 4);
  for (let i = 0; i < 32; i++) { const a = Math.round(255 * T.MathUtils.clamp((31 - i) / 5, 0, 1)); skyFadeBytes.set([a, a, a, 255], i * 4); }
  const skyFade = new T.DataTexture(skyFadeBytes, 1, 32); skyFade.needsUpdate = true; skyFade.magFilter = T.LinearFilter; textures.add(skyFade);
  const streetMaterial = new T.MeshBasicMaterial({ map: streetTexture, alphaMap: skyFade, transparent: true, depthWrite: false, toneMapped: false, fog: false }); materials.add(streetMaterial);
  const street = new T.Mesh(ownGeometry(new T.PlaneGeometry(1, 1)), streetMaterial);
  street.position.set(0, 4.6, -4); street.scale.set(22, 12.375, 1); scene.add(street);
  const roadShadow = new T.ShadowMaterial({ opacity: .22 }); materials.add(roadShadow);
  const road = new T.Mesh(ownGeometry(new T.PlaneGeometry(28, 12)), roadShadow);
  road.rotation.x = -Math.PI / 2; road.position.y = -.235; road.receiveShadow = true; scene.add(road);

  const foundation = new T.Group();
  const concrete = mat("#92928a", { roughness: .94 });
  const footing = new T.Mesh(ownGeometry(new RoundedBoxGeometry(2.7, .2, 2, 2, .035)), concrete);
  footing.position.y = -.12; footing.receiveShadow = true; footing.castShadow = true; foundation.add(footing);
  const bolts = new Batch();
  for (const x of [-1.15, 1.15]) for (const z of [-.8, .8]) {
    bolts.add(new T.CylinderGeometry(.045, .045, .08, 6), dark, x, .02, z);
    bolts.box(.16, .018, .16, x, -.005, z, dark);
  }
  foundation.add(bolts.finish()); scene.add(foundation);

  const dustGeometry = ownGeometry(new T.BufferGeometry());
  const dustPositions = new Float32Array(24 * 3); dustGeometry.setAttribute("position", new T.BufferAttribute(dustPositions, 3));
  const dustMaterial = new T.PointsMaterial({ map: dustTexture, color: "#e7d7bd", size: 27, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }); materials.add(dustMaterial);
  const dust = new T.Points(dustGeometry, dustMaterial); dust.frustumCulled = false; scene.add(dust);

  let lift = Math.max(0, state.step - 1) * HEIGHT, lastTime = performance.now(), dropStart = performance.now(), impact = false;
  let dustStart = -10000, dustHeight = 0, frames = 0, sampleStart = lastTime, smoothedFps = 60, dpr = 1;
  const resize = () => {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height || disposed) return;
    const aspect = rect.width / rect.height;
    camera.left = -5.75 * aspect; camera.right = 5.75 * aspect; camera.updateProjectionMatrix();
    const portrait = aspect < 1.1;
    streetMaterial.map = portrait ? phoneStreetTexture : streetTexture;
    street.scale.x = portrait ? Math.max(9.3, 11.5 * aspect + 1) : Math.max(22, 11.5 * aspect + 1);
    dpr = Math.min(window.devicePixelRatio || 1, rect.width < 650 ? 1.25 : 1.5);
    renderer.setPixelRatio(dpr); renderer.setSize(rect.width, rect.height, false); invalidate();
  };
  function draw(now: number) {
    frameId = 0; if (disposed || !visible || document.hidden) return;
    const dt = Math.min((now - lastTime) / 1000, .05); lastTime = now;
    const targetLift = Math.max(0, state.step - 1) * HEIGHT;
    const falling = !!state.drop?.failed || state.lost;
    const elapsed = Math.max(0, (now - dropStart) / 1000);
    const wreck = falling ? collapse.update(state.step, elapsed, state.lost || !state.motion) : null;
    if (!falling) collapse.clear();
    lift = state.motion ? T.MathUtils.damp(lift, targetLift, 7, dt) : targetLift;
    const idleY = targetLift + 7.7, landingY = 1.44 + state.step * HEIGHT;
    let shake = 0;
    if (falling) {
      const approach = Math.min(1, elapsed / .52), tip = T.MathUtils.clamp((elapsed - .52) / (TOWER_BREAK_SECONDS - .52), 0, 1);
      incoming.position.set(.65 * approach * approach + .4 * tip, T.MathUtils.lerp(idleY, landingY, approach * approach), .55 * tip);
      incoming.rotation.set(.24 * tip, .06 * tip, -.38 * tip);
      rig.visible = false;
      incoming.visible = !wreck!.fractured;
      if (wreck!.impactElapsed >= 0) shake = Math.sin(wreck!.impactElapsed * 55) * .07 * Math.max(0, 1 - wreck!.impactElapsed / .35);
    } else if (state.drop) {
      const fallingTime = .66;
      const p = Math.min(1, elapsed / fallingTime);
      incoming.position.set((state.drop.failed ? .75 : 0) * p * p, T.MathUtils.lerp(idleY, landingY, p * p), 0);
      incoming.rotation.set(0, .035 * (1 - p), (state.drop.failed ? -.24 : .035) * p);
      rig.visible = false;
      if (p >= 1) {
        if (!impact) { impact = true; dustStart = now; dustHeight = landingY - .85; }
        const after = elapsed - fallingTime;
        incoming.position.y += Math.sin(Math.min(1, after / .16) * Math.PI) * .065; incoming.rotation.z *= Math.max(0, 1 - after / .16);
        shake = Math.sin(after * 65) * .018 * Math.max(0, 1 - after / .18);
      }
    } else {
      const swing = state.motion ? Math.sin(now / 1200) : 0;
      incoming.position.set(swing * .38, idleY + (state.motion ? Math.sin(now / 1700) * .04 : 0), 0);
      incoming.rotation.set(0, .025 + swing * .018, swing * .07); rig.visible = true;
    }
    if (!falling) incoming.visible = true;
    const t = wreck ? wreck.impactElapsed : (now - dustStart) / 1000, dustLife = falling ? 1.4 : .65;
    dust.visible = !state.lost && t >= 0 && t < dustLife;
    dust.position.z = falling ? 1.3 : 0; dustMaterial.size = falling ? 48 : 27;
    if (dust.visible) {
      dustMaterial.opacity = Math.max(0, 1 - t / dustLife) * .75;
      for (let n = 0; n < 24; n++) {
        const angle = n * 2.399;
        dustPositions[n * 3] = Math.cos(angle) * (.7 + t * (falling ? 2.3 : 1.5));
        dustPositions[n * 3 + 1] = (falling ? 0 : dustHeight) + .15 + t * (.4 + n % 4 * .12);
        dustPositions[n * 3 + 2] = Math.sin(angle) * (.6 + t);
      }
      dustGeometry.attributes.position.needsUpdate = true;
    }
    if (wreck) {
      const follow = state.lost || !state.motion ? 1 : T.MathUtils.smoothstep(elapsed, TOWER_BREAK_SECONDS, TOWER_BREAK_SECONDS + .25);
      const focus = Math.max(1.4, wreck.focusY);
      camera.position.set(.6 + shake, T.MathUtils.lerp(targetLift + 4.8, focus + 3.4, follow) + shake, 17);
      camera.lookAt(0, T.MathUtils.lerp(targetLift + 4.5, focus + 3.1, follow), 0);
      lift = Math.max(0, camera.position.y - 4.8);
      stackWindow(Math.floor(Math.max(0, focus - 8) / HEIGHT));
      canvas.dataset.collapsePhase = wreck.settled ? "settled" : wreck.impact ? "impact" : wreck.fractured ? "falling" : "tipping";
      canvas.dataset.debrisCount = String(wreck.fractured ? collapse.count : 0);
      canvas.dataset.debrisMinY = wreck.minY.toFixed(3); canvas.dataset.debrisMaxY = wreck.maxY.toFixed(3);
      canvas.dataset.fallStartY = wreck.startY.toFixed(3);
    } else {
      camera.position.set(.6 + shake, lift + 4.8 + shake, 17); camera.lookAt(0, lift + 4.5, 0);
      stackWindow(state.step - 12); canvas.dataset.collapsePhase = "none"; canvas.dataset.debrisCount = "0";
    }
    canvas.dataset.cameraLift = lift.toFixed(3);
    canvas.dataset.artStyle = "runway-reference-v4";
    canvas.parentElement?.style.setProperty("--tr-sky-offset", `${Math.min(lift / HEIGHT * 12, 40)}%`);
    foundation.visible = lift < 8;
    sun.position.set(-6, lift + 14, 7); sun.target.position.set(0, lift + 2, 0);
    renderer.render(scene, camera);
    if (!ready) { ready = true; sampleStart = performance.now(); frames = 0; options.onReady(); }
    frames++;
    if (state.motion && now - sampleStart >= 1800) {
      smoothedFps = frames * 1000 / (now - sampleStart);
      if (state.motion && smoothedFps < 36 && dpr > 1) { dpr = 1; renderer.setPixelRatio(dpr); }
      canvas.dataset.fps = smoothedFps.toFixed(0); canvas.dataset.drawCalls = String(renderer.info.render.calls); canvas.dataset.triangles = String(renderer.info.render.triangles);
      canvas.dataset.pixelRatio = String(dpr); frames = 0; sampleStart = now;
    }
    if ((state.motion && (!state.lost || (wreck && !wreck.settled))) || !!state.drop) frameId = requestAnimationFrame(draw);
  }
  function invalidate() { if (!frameId && !disposed && visible && !document.hidden) frameId = requestAnimationFrame(draw); }
  const visibility = () => { if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; } else { lastTime = performance.now(); sampleStart = lastTime; frames = 0; invalidate(); } };
  const contextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frameId); frameId = 0; options.onFailure(); };
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) { lastTime = performance.now(); sampleStart = lastTime; frames = 0; invalidate(); } else { cancelAnimationFrame(frameId); frameId = 0; } }); intersection.observe(canvas);
  canvas.addEventListener("webglcontextlost", contextLost); document.addEventListener("visibilitychange", visibility);
  resize();
  return {
    update(next: TowerVisualState) {
      const rebuildNeeded = next.step !== state.step;
      if (next.motion !== state.motion) { lastTime = performance.now(); sampleStart = lastTime; frames = 0; }
      if (next.drop?.key !== state.drop?.key && next.drop) { dropStart = performance.now(); impact = false; }
      state = next; if (rebuildNeeded) rebuild(); invalidate();
    },
    dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(frameId);
      observer.disconnect(); intersection.disconnect(); canvas.removeEventListener("webglcontextlost", contextLost); document.removeEventListener("visibilitychange", visibility);
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose()); environment?.dispose();
      sun.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss();
    },
  };
}
