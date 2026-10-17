import * as THREE from "three";
import { trackPoint, type Venue } from "./race3dMath";
import { buildStadium, loadStadiumAssets } from "./raceStadium3d";
import { stadiumAdvertising } from "./stadiumAdvertising3d";
import {
  loadRacingDirt,
  racingDirtMaterial,
  racingDirtDetails,
} from "./raceDirt3d";

const temp = new THREE.Object3D();
type Placement = { p: number[]; s?: number[]; r?: number; c?: string };
type Surface = "raked_dirt" | "grass_ground" | "aerial_rocks_02";
const surfaceTextures = new Map<string, THREE.Texture>();
let surfaceLoading: Promise<void> | undefined;
const canopyTextures: THREE.Texture[] = [];
export function loadWorldTextures() {
  return (surfaceLoading ??= Promise.all([
    loadStadiumAssets(),
    loadRacingDirt(),
    ...(["raked_dirt", "grass_ground", "aerial_rocks_02"] as Surface[]).flatMap(
      (surface) =>
        ["diff", "nor_gl", "rough"].map(async (kind) => {
          const key = `${surface}-${kind}`;
          const texture = await new THREE.TextureLoader().loadAsync(
            `/assets/horse-racing/realistic/${key}.jpg`,
          );
          texture.colorSpace =
            kind === "diff" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.anisotropy = 8;
          surfaceTextures.set(key, texture);
        }),
    ),
    ...[0, 1].map(async (index) => {
      const map = await new THREE.TextureLoader().loadAsync(
        `/assets/horse-racing/realistic/tree-canopy-${index}.png`,
      );
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 4;
      canopyTextures[index] = map;
    }),
  ])
    .then(() => undefined)
    .catch((error) => {
      surfaceLoading = undefined;
      throw error;
    }));
}
function surfaceMaterial(
  surface: Surface,
  repeat: [number, number],
  color = "#ffffff",
) {
  const texture = (kind: string) => {
    const t = surfaceTextures.get(`${surface}-${kind}`)!.clone();
    t.repeat.set(...repeat);
    t.needsUpdate = true;
    return t;
  };
  const mat = new THREE.MeshStandardMaterial({
    color,
    map: texture("diff"),
    normalMap: texture("nor_gl"),
    roughnessMap: texture("rough"),
    roughness: 1,
    normalScale: new THREE.Vector2(0.65, 0.65),
  });
  // World-space variation breaks the repeating photographs at two scales.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader =
      `varying vec3 groundPosition;\n${shader.vertexShader}`.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
       vec4 groundVertex = vec4(transformed, 1.);
       #ifdef USE_INSTANCING
         groundVertex = instanceMatrix * groundVertex;
       #endif
       groundPosition = (modelMatrix * groundVertex).xyz;`,
      );
    shader.fragmentShader =
      `varying vec3 groundPosition;\n${shader.fragmentShader}`.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
       float macro = sin(groundPosition.x * .073 + sin(groundPosition.z * .047) * 2.)
         * sin(groundPosition.z * .12 + cos(groundPosition.x * .063));
       float micro = sin(groundPosition.x * 1.32 + groundPosition.z * .63)
         * sin(groundPosition.z * 1.71 - groundPosition.x * .74);
       diffuseColor.rgb *= 1. + macro * .16 + micro * .045;`,
      );
  };
  mat.customProgramCacheKey = () => "race-ground-macro-v3";
  return mat;
}
function turfMaterial(repeat: [number, number], color = "#d8e0b8") {
  const mat = surfaceMaterial("grass_ground", repeat, color);
  mat.normalScale.set(0.42, 0.42);
  // Retain the photographed surface detail while grading the dry source lawn
  // towards the denser, irrigated turf maintained at a racecourse.
  const groundShader = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    groundShader.call(mat, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
       float lawnLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
       float mowing = smoothstep(-.18, .18, sin(groundPosition.z * .80));
       float lawnVariation = .80 + mowing * .32;
       vec3 maintainedTurf = vec3(.030, .065, .012) * clamp(lawnLuma / .080, .65, 1.5) * lawnVariation;
       diffuseColor.rgb = mix(diffuseColor.rgb, maintainedTurf, .90);`,
    );
  };
  mat.customProgramCacheKey = () => "racecourse-broadcast-turf-v4";
  return mat;
}
function material(color: string, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.88, ...extra });
}
function box(
  group: THREE.Group,
  p: number[],
  s: number[],
  mat: THREE.Material,
  rotation = 0,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...(s as [number, number, number])),
    mat,
  );
  mesh.position.set(...(p as [number, number, number]));
  mesh.rotation.y = rotation;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function instances(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  mat: THREE.Material,
  placements: Placement[],
  shadow = false,
) {
  const mesh = new THREE.InstancedMesh(geometry, mat, placements.length);
  placements.forEach(({ p, s = [1, 1, 1], r = 0, c }, i) => {
    temp.position.set(...(p as [number, number, number]));
    temp.scale.set(...(s as [number, number, number]));
    temp.rotation.set(0, r, 0);
    temp.updateMatrix();
    mesh.setMatrixAt(i, temp.matrix);
    if (c) mesh.setColorAt(i, new THREE.Color(c));
  });
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function rng(seed = 28) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function labelTexture(text: string, bg = "#173d32", fg = "#f8f4df") {
  const canvas = document.createElement("canvas");
  canvas.width = text.length === 1 ? 128 : 1024;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, 128);
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = text.length === 1 ? "bold 96px Arial" : "bold 55px Georgia";
  ctx.fillText(text, canvas.width / 2, 65);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function ovalShape(radius: number) {
  const points: THREE.Vector2[] = [];
  const lane = (radius - 35) / 2.15;
  for (let i = 0; i < 240; i++) {
    const p = trackPoint(i / 240, lane);
    points.push(new THREE.Vector2(p.x, p.z));
  }
  return points;
}
function landElevation(x: number, z: number) {
  const fade = THREE.MathUtils.smoothstep(Math.hypot(x / 1.5, z), 100, 260);
  return (
    fade *
    (Math.sin(x * 0.018) * Math.cos(z * 0.023) * 6 +
      Math.sin(z * 0.041 - x * 0.014) * -3)
  );
}
function woodland(world: THREE.Group, trees: Placement[], phone: boolean) {
  for (let variant = 0; variant < 2; variant++) {
    const map = canopyTextures[variant].clone();
    map.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map,
      color: "#f1f3dc",
      alphaTest: 0.14,
      side: THREE.DoubleSide,
      alphaToCoverage: !phone,
    });
    mat.onBeforeCompile = (shader) => {
      // Upright distant impostors retain scanned leaves at a fraction of the
      // geometry cost. Reconstruct each card around its own world-space anchor.
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        `
        vec4 anchor = modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
        vec3 cameraRight = normalize(vec3(viewMatrix[0][0], 0., viewMatrix[2][0]));
        float width = length(instanceMatrix[0].xyz);
        float height = length(instanceMatrix[1].xyz);
        vec3 billboard = anchor.xyz + cameraRight * position.x * width + vec3(0., position.y * height, 0.);
        vec4 mvPosition = viewMatrix * vec4(billboard, 1.);
        gl_Position = projectionMatrix * mvPosition;
      `,
      );
    };
    mat.customProgramCacheKey = () => "race-distant-canopy-v1";
    for (const side of [-1, 1]) {
      const placements = trees.filter(
        (tree, index) => index % 2 === variant && Math.sign(tree.p[0]) === side,
      );
      if (!placements.length) continue;
      const mesh = instances(
        world,
        new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0),
        mat,
        placements,
      );
      // The billboard rotates in the shader; its CPU bounds would be too thin.
      mesh.frustumCulled = false;
    }
  }
}
export function buildWorld(venue: Venue, phone = false) {
  const world = new THREE.Group(),
    random = rng(91),
    night = venue.theme === "night",
    turf = venue.theme === "alpine" || venue.theme === "royal";
  world.userData.trackSurface = turf ? "turf" : "dirt";
  world.userData.wind = { value: 0 };
  const white = material("#e8e9df", { roughness: 0.56 }),
    steel = material(night ? "#394255" : "#50615c", { metalness: 0.35 });
  const dark = material("#183c32"),
    glass = material(night ? "#facb70" : "#627b7e", {
      metalness: 0.4,
      roughness: 0.2,
      emissive: night ? "#ad7540" : "#111e20",
      emissiveIntensity: night ? 0.8 : 0.15,
    });
  const terrainMat =
    venue.theme === "desert"
      ? surfaceMaterial("raked_dirt", [640, 640], "#c6b487")
      : turfMaterial([320, 320], "#c2d1a2");
  const groundGeometry = new THREE.PlaneGeometry(1800, 1800, 128, 128);
  const groundPoints = groundGeometry.attributes.position;
  for (let i = 0; i < groundPoints.count; i++) {
    const x = groundPoints.getX(i),
      z = -groundPoints.getY(i);
    groundPoints.setZ(
      i,
      landElevation(x, z) * (venue.theme === "royal" ? 0.18 : 1),
    );
  }
  groundGeometry.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeometry, terrainMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.15;
  ground.receiveShadow = true;
  world.add(ground);
  const shape = new THREE.Shape(ovalShape(54));
  shape.holes.push(new THREE.Path(ovalShape(32).reverse()));
  const track = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 180),
    turf
      ? turfMaterial([0.56, 0.56], "#e2e9c8")
      : racingDirtMaterial(venue.theme === "desert"),
  );
  track.rotation.x = -Math.PI / 2;
  track.receiveShadow = true;
  world.add(track);
  if (venue.theme === "royal") {
    // Sand exercise lane outside the turf, as seen beyond broadcast rail cameras.
    const trainingShape = new THREE.Shape(ovalShape(65));
    trainingShape.holes.push(new THREE.Path(ovalShape(56).reverse()));
    const training = new THREE.Mesh(
      new THREE.ShapeGeometry(trainingShape, 180),
      surfaceMaterial("raked_dirt", [0.24, 0.24], "#d3bb88"),
    );
    training.rotation.x = -Math.PI / 2;
    training.position.y = -0.025;
    training.receiveShadow = true;
    world.add(training);
  }
  if (venue.theme === "royal") {
    world.userData.stadium = {
      revision: "royal-park-broadcast-v1",
      spectatorCount: 0,
      audienceSections: 0,
    };
    const straw = document.createElement("canvas");
    straw.width = straw.height = 256;
    const ctx = straw.getContext("2d")!;
    ctx.fillStyle = "#ad8547";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3600; i++) {
      const x = random() * 256,
        y = random() * 256;
      ctx.strokeStyle = i % 3 ? "#d0ad6a" : "#715326";
      ctx.lineWidth = 0.5 + random();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 6 + random() * 24, y + random() * 5 - 2.5);
      ctx.stroke();
    }
    const strawMap = new THREE.CanvasTexture(straw);
    strawMap.colorSpace = THREE.SRGBColorSpace;
    const strawMaterial = new THREE.MeshStandardMaterial({
      map: strawMap,
      bumpMap: strawMap,
      bumpScale: 0.07,
      roughness: 1,
      color: "#d2b17c",
    });
    const bales: Placement[] = [];
    for (const z of [-72, 72])
      for (const x of [-78, -35, 6, 48, 88]) {
        for (let row = 0; row < 3; row++)
          for (let column = 0; column < 3 - row; column++) {
            bales.push({
              p: [x + column * 2.6 + row * 1.3, 0.72 + row * 1.43, z],
              s: [2.55, 1.4, 1.8],
              r: (random() - 0.5) * 0.08,
            });
          }
      }
    instances(world, new THREE.BoxGeometry(1, 1, 1), strawMaterial, bales);
    for (const [x, z] of [
      [58, -64],
      [-58, 64],
    ]) {
      const signGroup = new THREE.Group();
      signGroup.position.set(x, 0, z);
      signGroup.rotation.y = z > 0 ? Math.PI : 0;
      box(signGroup, [0, 2.2, 0], [13, 4, 0.22], material("#143e50"));
      for (const [text, y, width] of [
        ["WORLD RACING", 2.7, 11.5],
        ["ROYAL PARK", 1.35, 7],
      ] as const) {
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(width, width / 8),
          new THREE.MeshBasicMaterial({
            map: labelTexture(text, "#143e50", "#eef3de"),
          }),
        );
        face.position.set(0, y, 0.12);
        signGroup.add(face);
      }
      world.add(signGroup);
    }
  } else {
    const stadium = buildStadium(venue.theme, world.userData.wind, phone);
    world.add(stadium);
    world.userData.stadium = stadium.userData;
  }
  if (!turf) world.add(racingDirtDetails(phone));
  world.userData.trackDetail = turf ? "maintained-turf" : "granular-loam-v1";
  if (venue.theme !== "desert" && venue.theme !== "night") {
    const grassGeometry = new THREE.BufferGeometry();
    const vertices: number[] = [],
      colors: number[] = [];
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI) / 3;
      const x = Math.cos(angle) * 0.021,
        z = Math.sin(angle) * 0.021;
      vertices.push(-x, 0, -z, x, 0, z, x * 1.6, 0.16, z * 1.6);
      colors.push(0.22, 0.3, 0.12, 0.22, 0.3, 0.12, 0.48, 0.59, 0.28);
    }
    grassGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    grassGeometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colors, 3),
    );
    grassGeometry.computeVertexNormals();
    const grassMaterial = material("#9ba767", {
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    grassMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.grassTime = world.userData.wind;
      shader.vertexShader =
        `uniform float grassTime;\n${shader.vertexShader}`.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
         vec3 anchor = instanceMatrix[3].xyz;
         transformed.x += sin(anchor.x * .7 + anchor.z * .43 + grassTime * 1.4) * .035 * position.y / .22;`,
        );
    };
    grassMaterial.customProgramCacheKey = () => "track-grass-v1";
    const tufts: Placement[][] = Array.from({ length: 8 }, () => []);
    const count = phone ? 6500 : 18000;
    for (let i = 0; i < count; i++) {
      const progress = random();
      const radius = (i % 2 ? 30.7 : 61.1) + (random() - 0.5) * 2.1;
      const p = trackPoint(progress, (radius - 35) / 2.15);
      const size = 0.65 + random() * 1.15;
      tufts[Math.floor(progress * 8)].push({
        p: [p.x, -0.015, p.z],
        s: [size, size, size],
        r: random() * Math.PI,
      });
    }
    // Independent octants let the GPU skip vegetation behind the camera.
    for (const batch of tufts)
      instances(world, grassGeometry, grassMaterial, batch);
  }
  for (let i = -6; i <= 6; i++)
    box(
      world,
      [i * 10, -0.07, 0],
      [10, 0.025, 55],
      turfMaterial([3, 15], i % 2 ? "#c5d6a5" : "#d4dfb5"),
    );
  // White rails follow the whole circuit, with no missing sections on bends.
  const posts: Placement[] = [],
    rails: Placement[] = [];
  for (const radius of [32, 54]) {
    for (let i = 0; i < 180; i++) {
      const a = trackPoint(i / 180, (radius - 35) / 2.15),
        b = trackPoint((i + 1) / 180, (radius - 35) / 2.15);
      posts.push({ p: [a.x, 0.7, a.z], s: [0.12, 1.4, 0.12] });
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      for (const y of [0.63, 1.31])
        rails.push({
          p: [(a.x + b.x) / 2, y, (a.z + b.z) / 2],
          s: [0.14, 0.13, length + 0.06],
          r: Math.atan2(b.x - a.x, b.z - a.z),
        });
    }
  }
  instances(world, new THREE.CylinderGeometry(0.5, 0.5, 1, 8), white, posts);
  instances(
    world,
    new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateX(Math.PI / 2),
    white,
    rails,
  );
  // Finish gantry, timing tower and painted chequered line.
  world.userData.finishPosts = [-32, -55].map((z) =>
    box(world, [0, 4, z], [0.4, 8, 0.4], white),
  );
  const gantry = box(world, [0, 7.8, -43.5], [0.42, 1.2, 23.5], dark);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(22.5, 1.05),
    new THREE.MeshBasicMaterial({
      map: labelTexture("F I N I S H"),
      side: THREE.DoubleSide,
    }),
  );
  sign.position.copy(gantry.position);
  sign.position.x = 0.23;
  sign.rotation.y = Math.PI / 2;
  world.add(sign);
  const checks: Placement[] = [];
  for (let x = 0; x < 3; x++)
    for (let z = 0; z < 30; z++)
      checks.push({
        p: [x * 0.4 - 0.4, 0.025, -32.7 - z * 0.7],
        s: [0.4, 0.03, 0.7],
        c: (x + z) % 2 ? "#f0eee0" : "#2c3932",
      });
  instances(world, new THREE.BoxGeometry(1, 1, 1), white, checks);
  const advertising = stadiumAdvertising(venue.id);
  world.add(advertising);
  world.userData.advertising = advertising.userData.advertising;
  // The perimeter woodland provides a low, irregular horizon. Keep the trees
  // close enough to form a believable backdrop instead of a few isolated props.
  const trunks: Placement[] = [],
    hills: Placement[] = [];
  const treeCount = phone ? 160 : 240;
  for (let i = 0; i < treeCount; i++) {
    const a = (i / treeCount) * Math.PI * 2 + (random() - 0.5) * 0.14,
      r = 110 + random() * 108,
      x = Math.cos(a) * r * 1.42,
      z = Math.sin(a) * r;
    if (venue.theme === "coast" && z > 100) continue;
    if (Math.abs(x) < 82 && Math.abs(z) > 107 && Math.abs(z) < 125) continue;
    const height = 7 + random() * 7;
    trunks.push({ p: [x, height / 2, z], s: [0.4, height, 0.4] });
  }
  if (venue.theme !== "desert" && venue.theme !== "night") {
    const trees = trunks.map((t) => ({
      p: [
        t.p[0],
        landElevation(t.p[0], t.p[2]) * (venue.theme === "royal" ? 0.18 : 1) -
          t.s![1] * 0.035 -
          0.15,
        t.p[2],
      ],
      s: [t.s![1] * 1.07, t.s![1] * 1.07, 1],
      r: 0,
    }));
    woodland(world, trees, phone);
  }
  if (venue.theme === "marathon" || venue.theme === "alpine") {
    const alpine = venue.theme === "alpine";
    // English and French courses have distant, gentle landforms. Large exposed
    // rock belongs only to the Alpine venue; avoid a wall of repeated peaks.
    for (let i = 0; i < (alpine ? 12 : 10); i++) {
      const a = (i / (alpine ? 12 : 10)) * Math.PI * 2 + random() * 0.16;
      hills.push({
        p: [
          Math.cos(a) * (alpine ? 505 : 355),
          alpine ? -45 : -17,
          Math.sin(a) * (alpine ? 460 : 315),
        ],
        s: [
          (alpine ? 110 : 125) + random() * 85,
          alpine ? 115 + random() * 100 : 26 + random() * 18,
          (alpine ? 95 : 115) + random() * 65,
        ],
        r: random() * Math.PI,
        c: alpine ? "#91a2a0" : "#acbd97",
      });
    }
    const terrainGeometry = new THREE.SphereGeometry(1, 40, 20);
    const terrainVertices = terrainGeometry.attributes.position;
    for (let i = 0; i < terrainVertices.count; i++) {
      const x = terrainVertices.getX(i),
        y = terrainVertices.getY(i),
        z = terrainVertices.getZ(i);
      const noise =
        1 +
        (alpine ? 0.14 : 0.05) * Math.sin(x * 5.5 + z * 4.2) +
        (alpine ? 0.045 : 0.02) * Math.sin(z * 10 - y * 7);
      terrainVertices.setXYZ(i, x, y * noise, z);
    }
    terrainGeometry.computeVertexNormals();
    instances(
      world,
      terrainGeometry,
      alpine
        ? surfaceMaterial("aerial_rocks_02", [11, 8])
        : turfMaterial([22, 15]),
      hills,
    );
  }
  if (venue.theme === "desert" || venue.theme === "night") {
    const buildings: Placement[] = [],
      windows: Placement[] = [];
    for (let i = 0; i < 45; i++) {
      const x = -250 + i * 12,
        height = 10 + random() * 65,
        z = 180 + random() * 60;
      buildings.push({
        p: [x, height / 2, z],
        s: [7 + random() * 5, height, 10],
        c: night ? "#27354b" : "#bfb8a5",
      });
      for (let y = 4; y < height; y += 4)
        windows.push({ p: [x, y, z - 5.1], s: [5, 1.3, 0.1] });
    }
    instances(world, new THREE.BoxGeometry(1, 1, 1), white, buildings);
    instances(world, new THREE.BoxGeometry(1, 1, 1), glass, windows);
    if (venue.theme === "desert") {
      for (let i = 0; i < 25; i++) {
        const x = -160 + i * 13,
          z = -112 - random() * 15;
        box(world, [x, 5, z], [0.6, 10, 0.6], material("#998463"));
        for (let leaf = 0; leaf < 6; leaf++) {
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(1, 6, 4),
            material("#637a43"),
          );
          mesh.position.set(x + Math.sin(leaf) * 2, 10, z + Math.cos(leaf) * 2);
          mesh.scale.set(0.8, 0.3, 4);
          mesh.rotation.y = leaf;
          world.add(mesh);
        }
      }
    }
  }
  if (venue.theme === "coast") {
    box(
      world,
      [0, -0.11, 560],
      [1800, 0.05, 860],
      material("#4f9aa8", { metalness: 0.4, roughness: 0.25 }),
    );
    box(world, [0, -0.08, 141], [1700, 0.03, 28], material("#dacba5"));
    for (let i = 0; i < 9; i++)
      box(
        world,
        [0, -0.03, 161 + i * 18],
        [1600, 0.02, 0.5],
        material("#b3d5ce"),
      );
  }
  return world;
}

export function disposeWorld(world: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    skeletons = new Set<THREE.Skeleton>();
  world.traverse((object) => {
    object.userData.dispose?.();
    if (object instanceof THREE.InstancedMesh) object.dispose();
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Sprite ||
      object instanceof THREE.Line
    ) {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line)
        geometries.add(object.geometry);
      for (const mat of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(mat);
    }
  });
  geometries.forEach((g) => g.dispose());
  skeletons.forEach((s) => s.dispose());
  materials.forEach((m) => {
    const mat = m as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.normalMap?.dispose();
    mat.bumpMap?.dispose();
    mat.roughnessMap?.dispose();
    mat.aoMap?.dispose();
    m.dispose();
  });
}
