import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { towerAssets, towerAssetUrl } from "../towerAssets";

export type TowerVisualState = { step: number; drop: { key: number; failed: boolean } | null; motion: boolean; lost: boolean };
type Options = { state: TowerVisualState; onReady: () => void; onFailure: () => void };
const HEIGHT = 1.8;
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
  const camera = new T.PerspectiveCamera(34, 1, .1, 100);
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
  let environment: T.WebGLRenderTarget | undefined;
  const ownGeometry = <G extends T.BufferGeometry>(geometry: G) => { geometries.add(geometry); return geometry; };
  const mat = (color: string, properties: T.MeshStandardMaterialParameters = {}) => {
    const material = new T.MeshStandardMaterial({ color, roughness: .8, ...properties }); materials.add(material); return material;
  };
  try {
    const materialLoads = (["wood", "brick", "stone", "metal", "ground"] as const).map(async kind => {
      const [map, normalMap, roughnessMap] = await Promise.all([load(`${kind}Color`, true), load(`${kind}Normal`), load(`${kind}Roughness`)]);
      maps[kind] = { map, normalMap, roughnessMap };
    });
    const [sky, dust, facades] = await Promise.all([load("environment", true), load("dust"), Promise.all(([0, 1, 2, 3, 4, 5] as const).map(i => load(`facade${i}`, true))), Promise.all(materialLoads)]);
    dustTexture = dust; facadeTextures = facades;
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
  const templates = COLORS.map((color, kind) => {
    const batch = new Batch();
    const surface = kind === 0 || kind === 5 ? "wood" : kind === 1 ? "brick" : kind === 2 || kind === 7 ? "metal" : "stone";
    const wall = mat(color, { ...maps[surface], normalScale: new T.Vector2(.3, .3), roughness: kind === 2 ? .45 : .86 });
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
    batch.add(new T.PlaneGeometry(2.345, 1.625), face, 0, 0, .902);
    // A real projecting sill catches light and anchors the photographic skin.
    batch.box(2.4, .055, .14, 0, -.81, .94, trim);
    return batch.finish();
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
  const rigTemplate = rigBatch.finish();
  const stack = new T.Group(), incoming = new T.Group(); scene.add(stack, incoming);
  let rig = rigTemplate.clone(), incomingModel = templates[0].clone(); incoming.add(incomingModel, rig);
  const rebuild = () => {
    stack.clear();
    for (let n = Math.max(0, state.step - 12); n < state.step; n++) {
      const block = templates[n % 10].clone(); block.position.y = .9 + n * HEIGHT;
      block.rotation.y = Math.sin(n * 2.1) * .012; stack.add(block);
    }
    incoming.clear(); incomingModel = templates[state.step % 10].clone(); rig = rigTemplate.clone(); incoming.add(incomingModel, rig);
    incoming.visible = !state.lost;
  }; rebuild();

  scene.add(new T.HemisphereLight("#d9ecff", "#95806a", .95));
  const sun = new T.DirectionalLight("#fff7ed", 2.2); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12; sun.shadow.camera.near = 1; sun.shadow.camera.far = 45;
  sun.shadow.bias = -.00025; sun.shadow.normalBias = .035; scene.add(sun, sun.target);
  const fill = new T.DirectionalLight("#b6d6ee", .7); fill.position.set(7, 6, -5); scene.add(fill);
  // Nearby architecture shares the photographic skins. Merge its static parts
  // by material so adding a street does not add a draw call for every window.
  const neighborhood = new Batch();
  const neighborhoodFaces = facadeTextures.map(map => mat("#e4e1d9", {
    map, roughness: .9, emissiveMap: map, emissive: "#ffffff", emissiveIntensity: .07,
  }));
  const masonry = mat("#b8b2a4", { ...maps.stone, normalScale: new T.Vector2(.12, .12), roughness: .94 });
  const roofMaterial = mat("#555c5c", { roughness: .92 });
  const neighborhoodSites = [
    [-4.2, -3, 3, 1, 2.8], [4, -4, 4, 3, 3],
    [-7.3, -6, 5, 2, 3], [7, -6, 6, 1, 3],
    [-4, -10, 7, 3, 3], [3.8, -12, 8, 2, 2.8],
    [-10, -9, 4, 3, 4], [10, -11, 5, 2, 4],
  ];
  for (const [x, z, floors, facade, width] of neighborhoodSites) {
    const height = floors * 1.55, depth = 2.6;
    neighborhood.box(width, height, depth, x, height / 2 - .2, z, masonry);
    for (let floor = 0; floor < floors; floor++) {
      const y = floor * 1.55 + .575;
      const face = neighborhoodFaces[floor === 0 && facade !== 2 ? 4 : facade];
      neighborhood.add(new T.PlaneGeometry(width, 1.55), face, x, y, z + depth / 2 + .008);
      neighborhood.add(new T.PlaneGeometry(depth, 1.55), neighborhoodFaces[facade], x + width / 2 + .008, y, z, new T.Euler(0, Math.PI / 2, 0));
      neighborhood.box(width + .12, .065, depth + .12, x, y + .775, z, trim);
    }
    neighborhood.box(width + .2, .13, depth + .2, x, height - .12, z, trim);
    neighborhood.box(width - .18, .025, depth - .18, x, height - .035, z, roofMaterial);
    // Raised parapets, chimney and ventilation housings give rooftops depth.
    for (const edge of [-1, 1]) neighborhood.box(width + .16, .22, .11, x, height + .05, z + edge * depth / 2, trim);
    for (const edge of [-1, 1]) neighborhood.box(.11, .22, depth, x + edge * width / 2, height + .05, z, trim);
    neighborhood.box(.36, .64, .42, x - width * .27, height + .23, z - .4, masonry);
    neighborhood.box(.47, .08, .53, x - width * .27, height + .59, z - .4, trim);
    neighborhood.box(.65, .33, .56, x + width * .2, height + .14, z + .2, dark);
  }
  const paving = mat("#aaa69c", { roughness: .96 });
  for (const x of [-5.3, 5.3]) {
    neighborhood.box(5.5, .1, 36, x, -.18, -9, paving);
    for (let z = -25; z < 8; z += 2.5) neighborhood.box(5.5, .006, .02, x, -.126, z, trim);
  }
  const neighbors = neighborhood.finish(); scene.add(neighbors);

  // Ground the neighboring buildings in a real street plane. Fade its far edge
  // into the photographic horizon instead of showing a hard rectangular edge.
  for (const texture of Object.values(maps.ground)) { texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.set(32, 32); }
  const fade = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const worldX = (x / 63 - .5) * 65, worldZ = (.5 - y / 63) * 65;
    const value = Math.round(255 * T.MathUtils.clamp((worldZ + 30) / 16, 0, 1) * T.MathUtils.clamp((32 - Math.abs(worldX)) / 7, 0, 1));
    const index = (y * 64 + x) * 4; fade[index] = fade[index + 1] = fade[index + 2] = value; fade[index + 3] = 255;
  }
  const groundFade = new T.DataTexture(fade, 64, 64); groundFade.needsUpdate = true;
  groundFade.magFilter = groundFade.minFilter = T.LinearFilter; textures.add(groundFade);
  const roadMaterial = mat("#a4a9ab", { ...maps.ground, alphaMap: groundFade, transparent: true, depthWrite: false, normalScale: new T.Vector2(.15, .15), roughness: .94 });
  const road = new T.Mesh(ownGeometry(new T.PlaneGeometry(65, 65)), roadMaterial);
  road.rotation.x = -Math.PI / 2; road.position.y = -.235; road.receiveShadow = true; scene.add(road);

  const streetDetails = new Batch(), paint = mat("#dedbd1", { roughness: .96 });
  // Lane edges and a crossing make the road readable at phone sizes.
  for (const x of [-2.48, 2.48]) streetDetails.box(.045, .012, 30, x, -.223, -7, paint);
  for (let z = -19; z < 10; z += 3) if (Math.abs(z) > 2) streetDetails.box(.07, .012, 1.25, 0, -.222, z, paint);
  for (let x = -2.1; x < 2.3; x += .55) streetDetails.box(.3, .012, 1.4, x, -.221, 4.3, paint);
  scene.add(streetDetails.finish());
  const tire = mat("#181b1c", { roughness: .97 });
  const vehicleGlass = mat("#283c47", { roughness: .18, metalness: .55 });
  const lamp = mat("#deded0", { emissive: "#fff1c0", emissiveIntensity: .5, roughness: .4 });
  const traffic = ["#394f65", "#8c4137"].map((color, index) => {
    const body = mat(color, { roughness: .3, metalness: .65 }), car = new Batch();
    car.add(new RoundedBoxGeometry(.66, .23, 1.35, 2, .075), body, 0, .08, 0);
    car.add(new RoundedBoxGeometry(.56, .27, .65, 2, .06), vehicleGlass, 0, .29, -.06);
    car.box(.52, .035, .42, 0, .43, -.07, body);
    for (const x of [-.29, .29]) for (const z of [-.43, .43]) car.add(new T.CylinderGeometry(.135, .135, .1, 12), tire, x, -.1, z, new T.Euler(0, 0, Math.PI / 2));
    for (const x of [-.22, .22]) car.box(.12, .055, .025, x, .12, .68, lamp);
    const model = car.finish(); model.rotation.y = index ? Math.PI : 0;
    scene.add(model); return model;
  });

  const foundation = new T.Group();
  const concrete = mat("#92928a", { roughness: .94 });
  const footing = new T.Mesh(ownGeometry(new RoundedBoxGeometry(3.1, .2, 2.7, 2, .035)), concrete);
  footing.position.y = -.12; footing.receiveShadow = true; footing.castShadow = true; foundation.add(footing);
  const bolts = new Batch();
  for (const x of [-1.35, 1.35]) for (const z of [-1.1, 1.1]) {
    bolts.add(new T.CylinderGeometry(.045, .045, .08, 6), dark, x, .02, z);
    bolts.box(.16, .018, .16, x, -.005, z, dark);
  }
  foundation.add(bolts.finish()); scene.add(foundation);

  const dustGeometry = ownGeometry(new T.BufferGeometry());
  const dustPositions = new Float32Array(24 * 3); dustGeometry.setAttribute("position", new T.BufferAttribute(dustPositions, 3));
  const dustMaterial = new T.PointsMaterial({ map: dustTexture, color: "#e7d7bd", size: 27, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }); materials.add(dustMaterial);
  const dust = new T.Points(dustGeometry, dustMaterial); dust.frustumCulled = false; scene.add(dust);

  let lift = Math.max(0, state.step - 2) * HEIGHT, lastTime = performance.now(), dropStart = performance.now(), impact = false;
  let dustStart = -10000, dustHeight = 0, frames = 0, sampleStart = lastTime, smoothedFps = 60, dpr = 1;
  const resize = () => {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height || disposed) return;
    const aspect = rect.width / rect.height;
    camera.aspect = aspect; camera.updateProjectionMatrix();
    dpr = Math.min(window.devicePixelRatio || 1, rect.width < 650 ? 1.25 : 1.5);
    renderer.setPixelRatio(dpr); renderer.setSize(rect.width, rect.height, false); invalidate();
  };
  function draw(now: number) {
    frameId = 0; if (disposed || !visible || document.hidden) return;
    const dt = Math.min((now - lastTime) / 1000, .05); lastTime = now;
    const targetLift = Math.max(0, state.step - 2) * HEIGHT;
    traffic.forEach((car, index) => {
      const position = state.motion ? ((now / 1000 * 1.7 + index * 13) % 29) : 9 + index * 9;
      car.position.set(index ? 1.98 : -1.98, 0, index ? 10 - position : position - 19);
    });
    lift = state.motion ? T.MathUtils.damp(lift, targetLift, 7, dt) : targetLift;
    const idleY = targetLift + 6.8, landingY = .9 + state.step * HEIGHT;
    let shake = 0;
    if (state.drop) {
      const elapsed = Math.max(0, (now - dropStart) / 1000), fallingTime = state.drop.failed ? .62 : .66;
      const p = Math.min(1, elapsed / fallingTime);
      incoming.position.set((state.drop.failed ? .75 : 0) * p * p, T.MathUtils.lerp(idleY, landingY, p * p), 0);
      incoming.rotation.set(0, .035 * (1 - p), (state.drop.failed ? -.24 : .035) * p);
      rig.visible = false;
      if (p >= 1) {
        if (!impact) { impact = true; dustStart = now; dustHeight = landingY - .85; }
        const after = elapsed - fallingTime;
        if (state.drop.failed) { incoming.position.x += after * 5; incoming.position.y -= after * after * 18; incoming.rotation.z -= after * 3.5; incoming.rotation.x = after * .9; }
        else { incoming.position.y += Math.sin(Math.min(1, after / .16) * Math.PI) * .065; incoming.rotation.z *= Math.max(0, 1 - after / .16); }
        shake = Math.sin(after * 65) * .018 * Math.max(0, 1 - after / .18);
      }
    } else {
      const swing = state.motion ? Math.sin(now / 1200) : 0;
      incoming.position.set(swing * .38, idleY + (state.motion ? Math.sin(now / 1700) * .04 : 0), 0);
      incoming.rotation.set(0, .025 + swing * .018, swing * .07); rig.visible = true;
    }
    incoming.visible = !state.lost || !!state.drop;
    const t = (now - dustStart) / 1000;
    dust.visible = t < .65;
    if (dust.visible) {
      dustMaterial.opacity = Math.max(0, 1 - t / .65) * .75;
      for (let n = 0; n < 24; n++) {
        const angle = n * 2.399;
        dustPositions[n * 3] = Math.cos(angle) * (.7 + t * 1.5);
        dustPositions[n * 3 + 1] = dustHeight + .15 + t * (.4 + n % 4 * .12);
        dustPositions[n * 3 + 2] = Math.sin(angle) * (.6 + t);
      }
      dustGeometry.attributes.position.needsUpdate = true;
    }
    foundation.visible = state.step < 6;
    camera.position.set(3.2 + shake, lift + 6 + shake, 17); camera.lookAt(0, lift + 4.5, 0);
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
    if (state.motion || !!state.drop) frameId = requestAnimationFrame(draw);
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
